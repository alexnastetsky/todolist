import { TodoAppKit } from './types';
import { EmailSender } from './email';
import { notify } from './notify';
import { logActivity } from './activity';
import { TODAY_SQL } from './sql';

const JOB_INTERVAL_MS = 5 * 60 * 1000;

// Same single-process assumption as the pool's ESPN sync; every step is
// idempotent (notification dedupe index, status-guarded updates) so re-runs
// and restarts are harmless.
export function startJobs(appkit: TodoAppKit, emailSender: EmailSender | null) {
  const run = async () => {
    try {
      await dueTodayNotifications(appkit, emailSender);
      await autoArchiveStale(appkit);
    } catch (err) {
      console.warn('[todolist] background job failed:', (err as Error).message);
    }
  };
  void run();
  setInterval(() => void run(), JOB_INTERVAL_MS);
}

async function dueTodayNotifications(appkit: TodoAppKit, emailSender: EmailSender | null) {
  const { rows } = await appkit.lakebase.query(
    `SELECT t.id, t.title, t.list_id, t.assigned_to, l.owner_email,
            TO_CHAR(t.due_date, 'YYYY-MM-DD') AS due
     FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
     WHERE t.status = 'open' AND NOT t.someday AND t.due_date = ${TODAY_SQL}`
  );
  for (const t of rows) {
    const recipient = (t.assigned_to as string | null) ?? (t.owner_email as string);
    // The dedupe key makes this at-most-once per task per day no matter how
    // often the job runs.
    await notify(appkit, emailSender, {
      recipient,
      type: 'due_today',
      taskId: Number(t.id),
      listId: Number(t.list_id),
      dedupeKey: `due_today:${Number(t.id)}:${t.due as string}`,
      title: `"${t.title as string}" is on your plate today`,
    });
  }
}

// Graceful decay: stale tasks fade to the (recoverable) archive instead of
// rotting on the list. Someday items get a much longer leash.
async function autoArchiveStale(appkit: TodoAppKit) {
  const days = parseInt(process.env.TODOLIST_AUTOARCHIVE_DAYS ?? '60', 10);
  const somedayDays = days * 3;
  const { rows } = await appkit.lakebase.query(
    `UPDATE todolist.tasks
     SET status = 'archived', archived_at = NOW(), updated_at = NOW()
     WHERE status = 'open'
       AND last_activity_at < NOW() - ($1 || ' days')::interval
       AND (NOT someday OR last_activity_at < NOW() - ($2 || ' days')::interval)
       AND recur_kind IS NULL
     RETURNING id, list_id, title`,
    [String(days), String(somedayDays)]
  );
  for (const t of rows) {
    await logActivity(appkit, {
      listId: Number(t.list_id),
      taskId: Number(t.id),
      taskTitle: String(t.title),
      actor: 'system',
      action: 'archived',
      detail: { auto: true },
    });
  }
  if (rows.length > 0) console.log(`[todolist] auto-archived ${rows.length} stale task(s)`);
}
