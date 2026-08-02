import { TodoAppKit, NotificationType } from './types';
import { EmailSender, taskLink, listLink } from './email';

export interface NotifyEvent {
  recipient: string;
  type: NotificationType;
  title: string; // pre-rendered display text, e.g. 'Ana assigned you "Buy stamps"'
  actor?: string | null; // who triggered it; never notified about their own action
  taskId?: number | null;
  listId?: number | null;
  dedupeKey?: string | null; // e.g. 'due_today:42:2026-07-03'
  // Invitation semantics: send email regardless of opt-in prefs. Used when
  // the recipient has never opened the app — they can't have opted in yet,
  // and without an email they'd never learn the share exists.
  forceEmail?: boolean;
}

const PREF_COLUMN: Record<NotificationType, string> = {
  assigned: 'email_assigned',
  shared: 'email_shared',
  comment: 'email_comment',
  completed: 'email_completed',
  due_today: 'email_due_today',
};

// Essential-only mode (per-recipient pref, default ON): a task notification
// fires only when someone else completed a task the recipient created, or
// the task was created by someone else and is assigned to the recipient.
// Everything else — reminders about your own tasks, activity on tasks that
// aren't on your plate — is suppressed before it ever reaches the bell.
async function passesEssentialFilter(appkit: TodoAppKit, recipient: string, ev: NotifyEvent): Promise<boolean> {
  if (!ev.taskId) return true; // list-level events (shares/invites) always flow
  const pref = await appkit.lakebase.query(
    'SELECT essential_only FROM todolist.notification_prefs WHERE email = $1',
    [recipient]
  );
  // No row = the default: essential-only is on.
  if (pref.rows.length > 0 && pref.rows[0].essential_only !== true) return true;
  const task = await appkit.lakebase.query('SELECT created_by, assigned_to FROM todolist.tasks WHERE id = $1', [
    ev.taskId,
  ]);
  if (task.rows.length === 0) return false;
  const { created_by, assigned_to } = task.rows[0] as { created_by: string; assigned_to: string | null };
  return (
    (ev.type === 'completed' && created_by === recipient) || (created_by !== recipient && assigned_to === recipient)
  );
}

// Insert an in-app notification (always), then send email when the recipient
// opted in and a sender is configured. Dedupe via the partial unique index:
// a conflicting insert is a no-op and sends nothing. Never throws — a failed
// notification must not fail the action that triggered it.
export async function notify(appkit: TodoAppKit, emailSender: EmailSender | null, ev: NotifyEvent): Promise<void> {
  try {
    const recipient = ev.recipient.toLowerCase();
    if (ev.actor && recipient === ev.actor.toLowerCase()) return;
    if (!(await passesEssentialFilter(appkit, recipient, ev))) return;

    const inserted = await appkit.lakebase.query(
      `INSERT INTO todolist.notifications (recipient_email, type, task_id, list_id, actor_email, title, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (recipient_email, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [recipient, ev.type, ev.taskId ?? null, ev.listId ?? null, ev.actor ?? null, ev.title, ev.dedupeKey ?? null]
    );
    if (inserted.rows.length === 0) return; // dedupe hit

    if (!emailSender) return;
    if (!ev.forceEmail) {
      const prefs = await appkit.lakebase.query(
        `SELECT ${PREF_COLUMN[ev.type]} AS enabled FROM todolist.notification_prefs WHERE email = $1`,
        [recipient]
      );
      // Email is on by default: no prefs row means the user never opted out.
      if (prefs.rows.length > 0 && prefs.rows[0].enabled !== true) return;
    }

    const notificationId = inserted.rows[0].id;
    const link = taskLink(ev.taskId ?? null) ?? listLink(ev.listId ?? null);
    try {
      await emailSender.send({
        to: recipient,
        subject: ev.title,
        text: link ? `${ev.title}\n\n${link}` : ev.title,
        html: link
          ? `<p>${escapeHtml(ev.title)}</p><p><a href="${link}">Open in Todos</a></p>`
          : `<p>${escapeHtml(ev.title)}</p>`,
      });
      await appkit.lakebase.query(`UPDATE todolist.notifications SET email_status = 'sent' WHERE id = $1`, [
        notificationId,
      ]);
    } catch (err) {
      console.warn('[todolist] email send failed:', (err as Error).message);
      await appkit.lakebase.query(`UPDATE todolist.notifications SET email_status = 'failed' WHERE id = $1`, [
        notificationId,
      ]);
    }
  } catch (err) {
    console.warn('[todolist] notify failed:', (err as Error).message);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
