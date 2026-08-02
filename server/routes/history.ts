import { Application } from 'express';
import { TodoContext } from '../types';
import { handleError } from '../auth';
import { accessibleListsSql } from '../permissions';
import { TASK_COLS } from '../sql';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const qstr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function registerHistoryRoutes(app: Application, ctx: TodoContext) {
  const { appkit } = ctx;

  // Accomplishment log: what got done, when, and by whom — across every list
  // the caller can see. That scoping is exactly "others' accomplishments
  // where I have access". Defaults to completions; ?action=all shows the
  // full activity stream.
  app.get('/todolist/api/history', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const person = qstr(req.query.person)?.toLowerCase() ?? null;
      const listRaw = qstr(req.query.list);
      const listId = listRaw ? parseInt(listRaw, 10) : null;
      const from = DATE_RE.test(qstr(req.query.from) ?? '') ? qstr(req.query.from) : null;
      const to = DATE_RE.test(qstr(req.query.to) ?? '') ? qstr(req.query.to) : null;
      const action = req.query.action === 'all' ? null : 'completed';

      const { rows } = await appkit.lakebase.query(
        `SELECT a.id::int AS id, a.list_id::int AS list_id, a.task_id::int AS task_id,
                a.task_title, a.actor_email, a.action, a.detail, a.created_at,
                l.name AS list_name, u.display_name AS actor_name
         FROM todolist.activity a
         LEFT JOIN todolist.lists l ON l.id = a.list_id
         LEFT JOIN todolist.users u ON u.email = a.actor_email
         WHERE a.list_id IN ${accessibleListsSql('$1')}
           AND ($2::text IS NULL OR a.action = $2)
           AND ($3::text IS NULL OR a.actor_email = $3)
           AND ($4::bigint IS NULL OR a.list_id = $4)
           AND ($5::date IS NULL OR a.created_at >= $5::date)
           AND ($6::date IS NULL OR a.created_at < ($6::date + INTERVAL '1 day'))
         ORDER BY a.created_at DESC
         LIMIT 300`,
        [email, action, person, listId !== null && !isNaN(listId) ? listId : null, from, to]
      );
      res.json(rows);
    } catch (err) {
      handleError(res, 'Failed to load history', err);
    }
  });

  // The graceful-decay destination: everything auto- or manually archived,
  // recoverable, so deletion is never scary and lists never rot.
  app.get('/todolist/api/archive', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const listRaw = qstr(req.query.list);
      const listId = listRaw ? parseInt(listRaw, 10) : null;
      const { rows } = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, l.name AS list_name
         FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
         WHERE t.list_id IN ${accessibleListsSql('$1')} AND t.status = 'archived'
           AND ($2::bigint IS NULL OR t.list_id = $2)
         ORDER BY t.archived_at DESC
         LIMIT 300`,
        [email, listId !== null && !isNaN(listId) ? listId : null]
      );
      res.json(rows);
    } catch (err) {
      handleError(res, 'Failed to load archive', err);
    }
  });
}
