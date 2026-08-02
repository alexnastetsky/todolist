import { TodoAppKit } from './types';

export type ActivityAction =
  | 'created'
  | 'completed'
  | 'reopened'
  | 'assigned'
  | 'commented'
  | 'archived'
  | 'restored'
  | 'due_changed'
  | 'shared'
  | 'recurred';

// The permanent record — accomplishment history reads from this. task_title
// is denormalized so the log survives task deletion. Never throws.
export async function logActivity(
  appkit: TodoAppKit,
  entry: {
    listId: number;
    taskId?: number | null;
    taskTitle: string;
    actor: string;
    action: ActivityAction;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await appkit.lakebase.query(
      `INSERT INTO todolist.activity (list_id, task_id, task_title, actor_email, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.listId,
        entry.taskId ?? null,
        entry.taskTitle,
        entry.actor,
        entry.action,
        entry.detail ? JSON.stringify(entry.detail) : null,
      ]
    );
  } catch (err) {
    console.warn('[todolist] activity log failed:', (err as Error).message);
  }
}

// Short human name for notification titles: display name if the user set one,
// otherwise the part before the @.
export async function displayName(appkit: TodoAppKit, email: string): Promise<string> {
  try {
    const { rows } = await appkit.lakebase.query('SELECT display_name FROM todolist.users WHERE email = $1', [email]);
    const name = rows[0]?.display_name;
    if (typeof name === 'string' && name.trim().length > 0) return name.trim();
  } catch {
    // fall through to email local part
  }
  return email.split('@')[0];
}
