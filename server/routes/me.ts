import { z } from 'zod';
import { Application } from 'express';
import { TodoContext } from '../types';
import { handleError } from '../auth';
import { accessibleListsSql } from '../permissions';

const PrefsBody = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  emailAssigned: z.boolean().optional(),
  emailShared: z.boolean().optional(),
  emailComment: z.boolean().optional(),
  emailCompleted: z.boolean().optional(),
  emailDueToday: z.boolean().optional(),
  essentialOnly: z.boolean().optional(),
});

export function registerMeRoutes(app: Application, ctx: TodoContext) {
  const { appkit } = ctx;

  app.get('/todolist/api/me', async (_req, res) => {
    try {
      const email = res.locals.email as string;
      await appkit.lakebase.query(
        `INSERT INTO todolist.users (email, last_seen_at) VALUES ($1, NOW())
         ON CONFLICT (email) DO UPDATE SET last_seen_at = NOW()`,
        [email]
      );
      const user = await appkit.lakebase.query('SELECT display_name FROM todolist.users WHERE email = $1', [email]);
      const prefs = await appkit.lakebase.query(
        `SELECT email_assigned, email_shared, email_comment, email_completed, email_due_today, essential_only
         FROM todolist.notification_prefs WHERE email = $1`,
        [email]
      );
      const unread = await appkit.lakebase.query(
        'SELECT COUNT(*)::int AS n FROM todolist.notifications WHERE recipient_email = $1 AND read_at IS NULL',
        [email]
      );
      res.json({
        email,
        displayName: user.rows[0]?.display_name ?? null,
        prefs: prefs.rows[0] ?? {
          email_assigned: true,
          email_shared: true,
          email_comment: true,
          email_completed: true,
          email_due_today: true,
          essential_only: true,
        },
        emailConfigured: ctx.emailSender !== null,
        unreadCount: (unread.rows[0] as { n: number }).n,
      });
    } catch (err) {
      handleError(res, 'Failed to load user info', err);
    }
  });

  app.put('/todolist/api/me/prefs', async (req, res) => {
    try {
      const parsed = PrefsBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid preferences' });
        return;
      }
      const email = res.locals.email as string;
      const b = parsed.data;
      if (b.displayName !== undefined) {
        await appkit.lakebase.query(
          `INSERT INTO todolist.users (email, display_name) VALUES ($1, $2)
           ON CONFLICT (email) DO UPDATE SET display_name = $2`,
          [email, b.displayName]
        );
      }
      await appkit.lakebase.query(
        `INSERT INTO todolist.notification_prefs
           (email, email_assigned, email_shared, email_comment, email_completed, email_due_today, essential_only)
         VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE), COALESCE($5, TRUE), COALESCE($6, TRUE), COALESCE($7, TRUE))
         ON CONFLICT (email) DO UPDATE SET
           email_assigned  = COALESCE($2, todolist.notification_prefs.email_assigned),
           email_shared    = COALESCE($3, todolist.notification_prefs.email_shared),
           email_comment   = COALESCE($4, todolist.notification_prefs.email_comment),
           email_completed = COALESCE($5, todolist.notification_prefs.email_completed),
           email_due_today = COALESCE($6, todolist.notification_prefs.email_due_today),
           essential_only  = COALESCE($7, todolist.notification_prefs.essential_only),
           updated_at = NOW()`,
        [
          email,
          b.emailAssigned ?? null,
          b.emailShared ?? null,
          b.emailComment ?? null,
          b.emailCompleted ?? null,
          b.emailDueToday ?? null,
          b.essentialOnly ?? null,
        ]
      );
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to save preferences', err);
    }
  });

  // Every tag in use across lists the caller can see — feeds the tag editor's
  // suggestions and the Today filter chips.
  app.get('/todolist/api/tags', async (_req, res) => {
    try {
      const email = res.locals.email as string;
      const { rows } = await appkit.lakebase.query(
        `SELECT DISTINCT unnest(tags) AS tag FROM todolist.tasks
         WHERE list_id IN ${accessibleListsSql('$1')} AND status <> 'archived'
         ORDER BY 1`,
        [email]
      );
      res.json(rows.map((r) => r.tag));
    } catch (err) {
      handleError(res, 'Failed to load tags', err);
    }
  });

  // People you could assign/share to: anyone who shares a list with you plus
  // anyone who has used the app (small workspace — this is the whole point).
  app.get('/todolist/api/people', async (_req, res) => {
    try {
      const email = res.locals.email as string;
      const { rows } = await appkit.lakebase.query(
        `SELECT email, display_name FROM todolist.users WHERE email <> $1 ORDER BY COALESCE(display_name, email)`,
        [email]
      );
      res.json(rows);
    } catch (err) {
      handleError(res, 'Failed to load people', err);
    }
  });
}
