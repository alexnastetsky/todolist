import { z } from 'zod';
import { Application } from 'express';
import { TodoContext } from '../types';
import { handleError } from '../auth';
import { effectiveRole } from '../permissions';
import { logActivity, displayName } from '../activity';
import { notify } from '../notify';
import { TASK_COLS, TASK_ROLLUPS } from '../sql';

const CreateListBody = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().max(30).nullish(),
});

const PatchListBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().max(30).nullable().optional(),
  position: z.number().int().optional(),
});

const ShareBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  level: z.enum(['view', 'complete', 'edit']),
});

export function registerListRoutes(app: Application, ctx: TodoContext) {
  const { appkit, emailSender } = ctx;

  app.get('/todolist/api/lists', async (_req, res) => {
    try {
      const email = res.locals.email as string;
      const { rows } = await appkit.lakebase.query(
        `SELECT l.id::int AS id, l.owner_email, l.name, l.color, l.position, l.created_at,
                CASE WHEN l.owner_email = $1 THEN 'owner' ELSE s.level END AS role,
                (SELECT COUNT(*) FROM todolist.tasks t WHERE t.list_id = l.id AND t.status = 'open')::int AS open_count,
                (SELECT COUNT(*) FROM todolist.tasks t WHERE t.list_id = l.id AND t.status = 'done')::int AS done_count,
                (SELECT COUNT(*) FROM todolist.list_shares sh WHERE sh.list_id = l.id)::int AS share_count
         FROM todolist.lists l
         LEFT JOIN todolist.list_shares s ON s.list_id = l.id AND s.email = $1
         WHERE (l.owner_email = $1 OR s.email IS NOT NULL) AND l.archived_at IS NULL
         ORDER BY (l.owner_email <> $1), l.position, l.id`,
        [email]
      );
      res.json(rows);
    } catch (err) {
      handleError(res, 'Failed to load lists', err);
    }
  });

  app.post('/todolist/api/lists', async (req, res) => {
    try {
      const parsed = CreateListBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid list payload' });
        return;
      }
      const email = res.locals.email as string;
      const { rows } = await appkit.lakebase.query(
        `INSERT INTO todolist.lists (owner_email, name, color, position)
         VALUES ($1, $2, $3, COALESCE((SELECT MAX(position) + 1 FROM todolist.lists WHERE owner_email = $1), 0))
         RETURNING id::int AS id, owner_email, name, color, position, created_at`,
        [email, parsed.data.name, parsed.data.color ?? null]
      );
      res.status(201).json({ ...rows[0], role: 'owner', open_count: 0, done_count: 0, share_count: 0 });
    } catch (err) {
      handleError(res, 'Failed to create list', err);
    }
  });

  app.patch('/todolist/api/lists/:id', async (req, res) => {
    try {
      const listId = parseInt(String(req.params.id), 10);
      const parsed = PatchListBody.safeParse(req.body);
      if (isNaN(listId) || !parsed.success) {
        res.status(400).json({ error: 'Invalid list update' });
        return;
      }
      const email = res.locals.email as string;
      if ((await effectiveRole(appkit, email, listId)) !== 'owner') {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      const { name, color, position } = parsed.data;
      await appkit.lakebase.query(
        `UPDATE todolist.lists SET
           name = COALESCE($2, name),
           color = CASE WHEN $4 THEN $3 ELSE color END,
           position = COALESCE($5, position)
         WHERE id = $1`,
        [listId, name ?? null, color ?? null, color !== undefined, position ?? null]
      );
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to update list', err);
    }
  });

  app.delete('/todolist/api/lists/:id', async (req, res) => {
    try {
      const listId = parseInt(String(req.params.id), 10);
      const email = res.locals.email as string;
      if (isNaN(listId) || (await effectiveRole(appkit, email, listId)) !== 'owner') {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      await appkit.lakebase.query('DELETE FROM todolist.lists WHERE id = $1', [listId]);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to delete list', err);
    }
  });

  app.get('/todolist/api/lists/:id', async (req, res) => {
    try {
      const listId = parseInt(String(req.params.id), 10);
      const email = res.locals.email as string;
      const role = isNaN(listId) ? 'none' : await effectiveRole(appkit, email, listId);
      if (role === 'none') {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      const list = await appkit.lakebase.query(
        'SELECT id::int AS id, owner_email, name, color, position, created_at FROM todolist.lists WHERE id = $1',
        [listId]
      );
      const tasks = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}
         FROM todolist.tasks t
         WHERE t.list_id = $1 AND t.status <> 'archived'
         ORDER BY (t.status = 'done'), t.position, t.id`,
        [listId]
      );
      // Membership is visible to every member — you should know who can see
      // a list you're part of.
      const shares = await appkit.lakebase.query(
        `SELECT s.email, s.level, u.display_name
         FROM todolist.list_shares s LEFT JOIN todolist.users u ON u.email = s.email
         WHERE s.list_id = $1 ORDER BY s.created_at`,
        [listId]
      );
      res.json({ list: list.rows[0], role, tasks: tasks.rows, shares: shares.rows });
    } catch (err) {
      handleError(res, 'Failed to load list', err);
    }
  });

  app.put('/todolist/api/lists/:id/shares', async (req, res) => {
    try {
      const listId = parseInt(String(req.params.id), 10);
      const parsed = ShareBody.safeParse(req.body);
      if (isNaN(listId) || !parsed.success) {
        res.status(400).json({ error: 'Invalid share payload' });
        return;
      }
      const email = res.locals.email as string;
      if ((await effectiveRole(appkit, email, listId)) !== 'owner') {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      const target = parsed.data.email;
      if (target === email) {
        res.status(400).json({ error: 'You already own this list' });
        return;
      }
      const existing = await appkit.lakebase.query(
        'SELECT level FROM todolist.list_shares WHERE list_id = $1 AND email = $2',
        [listId, target]
      );
      await appkit.lakebase.query(
        `INSERT INTO todolist.list_shares (list_id, email, level, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (list_id, email) DO UPDATE SET level = $3`,
        [listId, target, parsed.data.level, email]
      );
      let invited = false;
      if (existing.rows.length === 0) {
        const listRow = await appkit.lakebase.query('SELECT name FROM todolist.lists WHERE id = $1', [listId]);
        const rawName = listRow.rows[0]?.name;
        const listName = typeof rawName === 'string' ? rawName : 'a list';
        await logActivity(appkit, {
          listId,
          taskTitle: listName,
          actor: email,
          action: 'shared',
          detail: { email: target, level: parsed.data.level },
        });
        // Someone who has never opened the app can't have opted in to email —
        // treat their first share as an invitation and email it regardless.
        const seen = await appkit.lakebase.query('SELECT 1 FROM todolist.users WHERE email = $1', [target]);
        invited = seen.rows.length === 0;
        await notify(appkit, emailSender, {
          recipient: target,
          type: 'shared',
          actor: email,
          listId,
          forceEmail: invited,
          title: `${await displayName(appkit, email)} shared the list "${listName}" with you`,
        });
      }
      res.json({ ok: true, invited, emailConfigured: emailSender !== null });
    } catch (err) {
      handleError(res, 'Failed to share list', err);
    }
  });

  app.delete('/todolist/api/lists/:id/shares/:email', async (req, res) => {
    try {
      const listId = parseInt(String(req.params.id), 10);
      const target = String(req.params.email).toLowerCase();
      const email = res.locals.email as string;
      if (isNaN(listId)) {
        res.status(400).json({ error: 'Invalid list id' });
        return;
      }
      const role = await effectiveRole(appkit, email, listId);
      // Owner can revoke anyone; anyone can remove themselves (leave).
      if (role !== 'owner' && target !== email) {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      if (role === 'none') {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      await appkit.lakebase.query('DELETE FROM todolist.list_shares WHERE list_id = $1 AND email = $2', [
        listId,
        target,
      ]);
      // Unassign the departing user's tasks so nothing points at a non-member.
      await appkit.lakebase.query(
        `UPDATE todolist.tasks SET assigned_to = NULL, assigned_by = NULL, updated_at = NOW()
         WHERE list_id = $1 AND assigned_to = $2`,
        [listId, target]
      );
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to remove share', err);
    }
  });
}
