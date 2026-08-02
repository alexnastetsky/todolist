import { z } from 'zod';
import { Application } from 'express';
import { TodoContext } from '../types';
import { handleError } from '../auth';

const ReadBody = z.object({
  ids: z.array(z.number().int()).max(500).optional(),
  all: z.boolean().optional(),
});

export function registerNotificationRoutes(app: Application, ctx: TodoContext) {
  const { appkit } = ctx;

  app.get('/todolist/api/notifications', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const beforeRaw = typeof req.query.before === 'string' ? req.query.before : null;
      const before = beforeRaw ? parseInt(beforeRaw, 10) : null;
      const { rows } = await appkit.lakebase.query(
        `SELECT n.id::int AS id, n.type, n.task_id::int AS task_id, n.list_id::int AS list_id,
                n.actor_email, n.title, n.read_at, n.created_at,
                u.display_name AS actor_name
         FROM todolist.notifications n
         LEFT JOIN todolist.users u ON u.email = n.actor_email
         WHERE n.recipient_email = $1 AND ($2::bigint IS NULL OR n.id < $2)
         ORDER BY n.id DESC
         LIMIT 50`,
        [email, before !== null && !isNaN(before) ? before : null]
      );
      res.json(rows);
    } catch (err) {
      handleError(res, 'Failed to load notifications', err);
    }
  });

  app.post('/todolist/api/notifications/read', async (req, res) => {
    try {
      const parsed = ReadBody.safeParse(req.body);
      if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
        res.status(400).json({ error: 'Invalid read payload' });
        return;
      }
      const email = res.locals.email as string;
      if (parsed.data.all) {
        await appkit.lakebase.query(
          'UPDATE todolist.notifications SET read_at = NOW() WHERE recipient_email = $1 AND read_at IS NULL',
          [email]
        );
      } else {
        await appkit.lakebase.query(
          `UPDATE todolist.notifications SET read_at = NOW()
           WHERE recipient_email = $1 AND read_at IS NULL AND id = ANY($2::bigint[])`,
          [email, parsed.data.ids]
        );
      }
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to mark notifications read', err);
    }
  });
}
