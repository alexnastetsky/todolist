import { z } from 'zod';
import { Application } from 'express';
import { TodoContext } from '../types';
import { handleError } from '../auth';
import { pushPublicKey } from '../push';

const ReadBody = z.object({
  ids: z.array(z.number().int()).max(500).optional(),
  all: z.boolean().optional(),
});

// Shape produced by PushSubscription.toJSON() in the browser.
const SubscribeBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().max(200),
    auth: z.string().max(200),
  }),
});

const UnsubscribeBody = z.object({
  endpoint: z.string().url().max(2000),
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

  // The VAPID public key the browser needs to subscribe. Null when push is not
  // configured, which the settings UI shows as "unavailable" rather than
  // offering a switch that cannot work.
  app.get('/todolist/api/push/key', (_req, res) => {
    res.json({ key: pushPublicKey() });
  });

  app.post('/todolist/api/push/subscribe', async (req, res) => {
    try {
      const parsed = SubscribeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid subscription' });
        return;
      }
      const email = res.locals.email as string;
      const { endpoint, keys } = parsed.data;
      // Endpoints are re-issued by the push service over time, and the same
      // endpoint can move between accounts on a shared device — so upsert on
      // the endpoint and let the newest owner win.
      await appkit.lakebase.query(
        `INSERT INTO todolist.push_subscriptions (endpoint, email, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET
           email = EXCLUDED.email,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           last_seen_at = NOW()`,
        [endpoint, email, keys.p256dh, keys.auth, req.header('user-agent') ?? null]
      );
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to save push subscription', err);
    }
  });

  app.post('/todolist/api/push/unsubscribe', async (req, res) => {
    try {
      const parsed = UnsubscribeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid subscription' });
        return;
      }
      const email = res.locals.email as string;
      // Scoped to the caller so one account cannot drop another's device.
      await appkit.lakebase.query('DELETE FROM todolist.push_subscriptions WHERE endpoint = $1 AND email = $2', [
        parsed.data.endpoint,
        email,
      ]);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to remove push subscription', err);
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
