import { useState } from 'react';
import { Input, Button, Badge, Popover, PopoverContent, PopoverTrigger } from '@databricks/appkit-ui/react';
import { api, type ListSummary, type Effort, type AiProposal } from '../lib/api';
import { useApp } from '../AppContext';
import { todayStr, addDaysStr, formatDue, recurrenceLabel, personName, EFFORT_LABELS } from '../lib/format';

function Token({ children }: { children: string }) {
  return <code className="bg-muted rounded px-1 py-0.5 text-[11px] font-mono whitespace-nowrap">{children}</code>;
}

const SYNTAX_ROWS: { tokens: string[]; desc: string }[] = [
  { tokens: ['!today', '!tomorrow'], desc: 'set the (soft) date' },
  { tokens: ['!someday'], desc: 'park it in Someday' },
  { tokens: ['!star'], desc: 'mark as priority (★)' },
  { tokens: ['~5m', '~20m', '~1h', '~deep'], desc: 'tag the effort' },
  { tokens: ['+tag'], desc: 'add a label (repeatable)' },
  { tokens: ['#name'], desc: 'choose a list by name prefix' },
  { tokens: ['@name'], desc: 'assign by name or email prefix' },
];

function SyntaxHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Quick-add syntax help"
          className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm"
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm space-y-2">
        <p className="font-medium">Quick-add tokens</p>
        <div className="space-y-1.5">
          {SYNTAX_ROWS.map((row) => (
            <div key={row.desc} className="flex items-baseline gap-2">
              <span className="flex flex-wrap gap-1 shrink-0">
                {row.tokens.map((t) => (
                  <Token key={t}>{t}</Token>
                ))}
              </span>
              <span className="text-xs text-muted-foreground">{row.desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground border-t pt-2">
          Example: <Token>Buy stamps !tomorrow ~5m #errands @ana</Token>
        </p>
        <p className="text-xs text-muted-foreground">
          Tokens are stripped from the title. A <Token>#…</Token> or <Token>@…</Token> that matches nothing stays as
          plain text.
        </p>
        <p className="text-xs text-muted-foreground">
          Or click ✨ (⌘⏎) to parse a full sentence — dates, repeats, people, and tags — with a preview before saving.
        </p>
      </PopoverContent>
    </Popover>
  );
}

// Fast capture: one input, Enter to add. Tokens (stripped from the title):
//   !today !tomorrow !someday   ~5m ~20m ~1h ~deep   #list   @person
export function QuickAdd({
  lists,
  defaultListId,
  defaultDue = null,
  onAdded,
}: {
  lists: ListSummary[];
  defaultListId?: number;
  defaultDue?: string | null;
  onAdded: () => void;
}) {
  const { me, people } = useApp();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [proposal, setProposal] = useState<AiProposal | null>(null);

  const editable = lists.filter((l) => l.role === 'owner' || l.role === 'edit');

  const aiParse = async () => {
    const text = value.trim();
    if (!text || aiLoading) return;
    setAiLoading(true);
    setError(null);
    try {
      setProposal(await api.post<AiProposal>('/ai/parse', { text }));
    } catch (e) {
      setError(`${(e as Error).message} — plain Enter still works.`);
    } finally {
      setAiLoading(false);
    }
  };

  const confirmProposal = async () => {
    if (!proposal) return;
    try {
      await api.post(`/lists/${proposal.listId}/tasks`, {
        title: proposal.title,
        dueDate: proposal.dueDate ?? null,
        someday: proposal.someday ?? false,
        starred: proposal.starred ?? false,
        tags: proposal.tags ?? [],
        effort: proposal.effort ?? null,
        energy: proposal.energy ?? null,
        assignedTo: proposal.assignedTo ?? null,
        recurrence: proposal.recurrence ?? null,
      });
      setProposal(null);
      setValue('');
      setError(null);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    const raw = value.trim();
    if (!raw) return;

    let dueDate: string | null = defaultDue;
    let someday = false;
    let starred = false;
    let effort: Effort | null = null;
    let assignedTo: string | null = null;
    let listId = defaultListId ?? editable[0]?.id;
    const tags: string[] = [];

    const words: string[] = [];
    for (const word of raw.split(/\s+/)) {
      if (word === '!today') dueDate = todayStr();
      else if (word === '!tomorrow') dueDate = addDaysStr(todayStr(), 1);
      else if (word === '!star') starred = true;
      else if (word.startsWith('+') && word.length > 1) tags.push(word.slice(1).toLowerCase());
      else if (word === '!someday') {
        someday = true;
        dueDate = null;
      } else if (/^~(5m|20m|1h|deep)$/.test(word)) effort = word.slice(1) as Effort;
      else if (word.startsWith('#') && word.length > 1) {
        const q = word.slice(1).toLowerCase();
        const match = editable.find((l) => l.name.toLowerCase().startsWith(q));
        if (match) listId = match.id;
        else words.push(word);
      } else if (word.startsWith('@') && word.length > 1) {
        const q = word.slice(1).toLowerCase();
        const match = people.find(
          (p) => p.email.toLowerCase().startsWith(q) || (p.display_name ?? '').toLowerCase().startsWith(q)
        );
        if (match) assignedTo = match.email;
        else words.push(word);
      } else words.push(word);
    }

    const title = words.join(' ').trim();
    if (!title || !listId) {
      setError(!listId ? 'Create a list first' : null);
      return;
    }
    try {
      await api.post(`/lists/${listId}/tasks`, { title, dueDate, someday, starred, tags, effort, assignedTo });
      setValue('');
      setError(null);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="relative">
          <Input
            placeholder="Add a task…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void aiParse();
              }
            }}
            className="h-10 pr-16"
          />
          <button
            type="button"
            aria-label="Parse with AI"
            title="AI parse (⌘⏎) — full sentences: dates, repeats, people, tags"
            disabled={aiLoading}
            onClick={() => void aiParse()}
            className={`absolute right-9 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md transition-colors text-sm ${
              aiLoading ? 'animate-pulse text-amber-500' : 'text-muted-foreground hover:text-amber-500 hover:bg-muted'
            }`}
          >
            ✨
          </button>
          <SyntaxHelp />
        </div>
      </form>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      {proposal && (
        <div className="mt-2 rounded-lg border bg-muted/40 p-3 space-y-2">
          <p className="text-sm font-medium">
            {proposal.starred && <span className="text-amber-500 mr-1">★</span>}
            {proposal.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {editable.find((l) => l.id === proposal.listId)?.name ?? `list ${proposal.listId}`}
            </Badge>
            {proposal.dueDate && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {formatDue(proposal.dueDate)}
              </Badge>
            )}
            {proposal.someday && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                someday
              </Badge>
            )}
            {proposal.recurrence && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                ↻{' '}
                {recurrenceLabel({
                  recur_kind: proposal.recurrence.kind,
                  recur_interval: proposal.recurrence.interval,
                  recur_unit: proposal.recurrence.unit ?? null,
                  recur_weekdays: proposal.recurrence.weekdays ?? null,
                  recur_monthday: proposal.recurrence.monthday ?? null,
                })}
              </Badge>
            )}
            {proposal.effort && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {EFFORT_LABELS[proposal.effort]}
              </Badge>
            )}
            {proposal.energy && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {proposal.energy} energy
              </Badge>
            )}
            {proposal.assignedTo && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                → {personName(proposal.assignedTo, people, me.email)}
              </Badge>
            )}
            {(proposal.tags ?? []).map((t) => (
              <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                +{t}
              </Badge>
            ))}
          </div>
          {(proposal.warnings ?? []).map((w, i) => (
            <p key={i} className="text-xs text-amber-600">
              ⚠ {w}
            </p>
          ))}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void confirmProposal()}>
              Add task
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
