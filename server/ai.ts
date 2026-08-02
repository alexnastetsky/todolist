import { WorkspaceClient } from '@databricks/sdk-experimental';
import { z } from 'zod';
import { localToday } from './sql';

// Databricks Model Serving foundation-model endpoint (pay-per-token; free on
// this workspace within rate limits). Queried with the app's own service
// principal — no API keys. Swap models via env without code changes.
const ENDPOINT = process.env.TODOLIST_AI_ENDPOINT ?? 'databricks-llama-4-maverick';

let workspace: WorkspaceClient | null = null;
function getWorkspace(): WorkspaceClient {
  if (!workspace) workspace = new WorkspaceClient({});
  return workspace;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ProposalSchema = z.object({
  title: z.string().trim().min(1).max(500),
  listId: z.coerce.number().int(),
  dueDate: z.string().regex(DATE_RE).nullish(),
  someday: z.boolean().nullish(),
  starred: z.boolean().nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).nullish(),
  effort: z.enum(['5m', '20m', '1h', 'deep']).nullish(),
  energy: z.enum(['low', 'medium', 'high']).nullish(),
  assignedTo: z.string().trim().toLowerCase().email().nullish(),
  recurrence: z
    .object({
      kind: z.enum(['schedule', 'after_done']),
      interval: z.coerce.number().int().min(1).max(365).default(1),
      unit: z.enum(['day', 'week', 'month']).nullish(),
      weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).nullish(),
      monthday: z.coerce.number().int().min(1).max(31).nullish(),
    })
    .nullish(),
  warnings: z.array(z.string()).nullish(),
});

export type AiProposal = z.infer<typeof ProposalSchema>;

export interface ParseContext {
  lists: { id: number; name: string; members: { email: string; name: string | null }[] }[];
  tags: string[];
}

export class AiUnavailableError extends Error {}

function systemPrompt(ctx: ParseContext): string {
  const today = localToday();
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  const lists = ctx.lists
    .map(
      (l) =>
        `- id ${l.id}: "${l.name}" (members: ${l.members.map((m) => (m.name ? `${m.name} <${m.email}>` : m.email)).join(', ')})`
    )
    .join('\n');
  return `You convert a user's natural-language todo into strict JSON. Today is ${today} (${weekday}), US Eastern.

The user's lists (pick the best listId for the task; default to id ${ctx.lists[0].id}):
${lists}

Existing tags to reuse when they fit: ${ctx.tags.length > 0 ? ctx.tags.join(', ') : '(none yet)'}

Output ONLY a JSON object (no markdown, no commentary) with exactly this shape:
{
  "title": string,          // concise imperative title; remove dates/assignees/priority words that are captured in other fields
  "listId": number,
  "dueDate": "YYYY-MM-DD" or null,  // soft intention; resolve relative dates ("tomorrow", "friday") from today's date; for recurring tasks this is the first occurrence
  "someday": boolean,       // true only for aspirational "someday/maybe/eventually" items
  "starred": boolean,       // true if described as high priority / important / urgent
  "tags": string[],         // lowercase labels; empty array if none
  "effort": "5m" | "20m" | "1h" | "deep" or null,   // only if the text implies a size
  "energy": "low" | "medium" | "high" or null,
  "assignedTo": string or null,   // a member's email, only when the text clearly assigns the task to a person
  "recurrence": null
    or {"kind": "schedule", "interval": N, "unit": "day"|"week"|"month", "weekdays": [0-6] or null, "monthday": 1-31 or null}
    or {"kind": "after_done", "interval": N},   // N is ALWAYS in DAYS after completion — convert other units ("a week after I finish"=7, "3 months after I do it"=90)
  "warnings": string[]      // note anything ambiguous or that you could not map (unknown person, unclear date, etc.)
}

Rules: weekdays use 0=Sunday .. 6=Saturday. "every morning/day"=daily schedule. Never invent an assignee or a date the user didn't imply; leave effort/energy null unless the text implies them.`;
}

// Endpoint responses may carry content as a plain string or as an array of
// typed parts (reasoning models) — pull out the text either way.
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

function stripFences(s: string): string {
  const trimmed = s.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(trimmed);
  if (fenced) return fenced[1];
  // Some models prepend prose; grab the first {...} span as a fallback.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

async function chat(messages: { role: string; content: string }[]): Promise<string> {
  try {
    const response = await getWorkspace().servingEndpoints.query({
      name: ENDPOINT,
      messages,
      max_tokens: 800,
    } as Parameters<ReturnType<typeof getWorkspace>['servingEndpoints']['query']>[0]);
    const raw = (response as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    const text = extractText(raw);
    if (!text) throw new Error('empty model response');
    return text;
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (/rate limit|temporarily disabled|RESOURCE_EXHAUSTED|429/i.test(message)) {
      throw new AiUnavailableError('The AI model is at its usage limit right now — try again in a bit.');
    }
    throw err;
  }
}

export async function parseTask(text: string, ctx: ParseContext): Promise<AiProposal> {
  const messages = [
    { role: 'system', content: systemPrompt(ctx) },
    { role: 'user', content: text },
  ];

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await chat(
      attempt === 0
        ? messages
        : [...messages, { role: 'user', content: `Your previous output was invalid (${lastError}). Output ONLY the JSON object.` }]
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(output));
    } catch (err) {
      lastError = `not valid JSON: ${(err as Error).message}`;
      continue;
    }
    const result = ProposalSchema.safeParse(parsed);
    if (!result.success) {
      lastError = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      continue;
    }
    return normalize(result.data, ctx);
  }
  throw new Error(`AI produced unusable output (${lastError})`);
}

// Post-validate against the caller's actual lists/members so the proposal can
// never point at something the create-task API would reject.
function normalize(p: AiProposal, ctx: ParseContext): AiProposal {
  const warnings = [...(p.warnings ?? [])];
  let list = ctx.lists.find((l) => l.id === p.listId);
  if (!list) {
    list = ctx.lists[0];
    warnings.push('Picked your first list — the suggested list was not one of yours.');
  }
  let assignedTo = p.assignedTo ?? null;
  if (assignedTo && !list.members.some((m) => m.email === assignedTo)) {
    warnings.push(`${assignedTo} is not a member of "${list.name}" — share the list with them first, then assign.`);
    assignedTo = null;
  }
  const tags = [...new Set((p.tags ?? []).map((t) => t.toLowerCase().replace(/^[+#]/, '').trim()).filter(Boolean))];
  return { ...p, listId: list.id, assignedTo, tags, someday: p.someday ?? false, starred: p.starred ?? false, warnings };
}
