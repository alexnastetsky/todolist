import { z } from 'zod';
import { Application } from 'express';
import { TodoContext } from '../types';
import { handleError } from '../auth';
import { accessibleListsSql } from '../permissions';
import { parseTask, AiUnavailableError, ParseContext } from '../ai';

const ParseBody = z.object({
  text: z.string().trim().min(1).max(500),
});

export function registerAiRoutes(app: Application, ctx: TodoContext) {
  const { appkit } = ctx;

  // Turn a natural-language sentence into a structured task PROPOSAL. The
  // client confirms and then creates via the normal POST /lists/:id/tasks, so
  // permissions, member validation, activity, and notifications reuse the
  // proven path — the model never writes to the database.
  app.post('/todolist/api/ai/parse', async (req, res) => {
    try {
      const parsed = ParseBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid parse request' });
        return;
      }
      const email = res.locals.email as string;

      // Lists the caller can add tasks to (owner or edit share), with members.
      const listRows = await appkit.lakebase.query(
        `SELECT l.id::int AS id, l.name
         FROM todolist.lists l
         LEFT JOIN todolist.list_shares s ON s.list_id = l.id AND s.email = $1
         WHERE (l.owner_email = $1 OR s.level = 'edit') AND l.archived_at IS NULL
         ORDER BY (l.owner_email <> $1), l.position, l.id`,
        [email]
      );
      if (listRows.rows.length === 0) {
        res.status(400).json({ error: 'Create a list first' });
        return;
      }
      const listIds = listRows.rows.map((r) => Number(r.id));
      const memberRows = await appkit.lakebase.query(
        `SELECT l.id::int AS list_id, l.owner_email AS email, u.display_name
         FROM todolist.lists l LEFT JOIN todolist.users u ON u.email = l.owner_email
         WHERE l.id = ANY($1::bigint[])
         UNION ALL
         SELECT s.list_id::int AS list_id, s.email, u.display_name
         FROM todolist.list_shares s LEFT JOIN todolist.users u ON u.email = s.email
         WHERE s.list_id = ANY($1::bigint[])`,
        [listIds]
      );
      const tagRows = await appkit.lakebase.query(
        `SELECT DISTINCT unnest(tags) AS tag FROM todolist.tasks
         WHERE list_id IN ${accessibleListsSql('$1')} AND status <> 'archived' ORDER BY 1`,
        [email]
      );

      const parseCtx: ParseContext = {
        lists: listRows.rows.map((l) => ({
          id: Number(l.id),
          name: String(l.name),
          members: memberRows.rows
            .filter((m) => Number(m.list_id) === Number(l.id))
            .map((m) => ({ email: String(m.email), name: (m.display_name as string | null) ?? null })),
        })),
        tags: tagRows.rows.map((r) => String(r.tag)),
      };

      const proposal = await parseTask(parsed.data.text, parseCtx);
      res.json(proposal);
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        res.status(503).json({ error: err.message });
        return;
      }
      handleError(res, 'AI could not parse that — plain quick-add still works', err);
    }
  });
}
