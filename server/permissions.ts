import { TodoAppKit, Role } from './types';
import { TASK_COLS } from './sql';

const ROLE_RANK: Record<Role, number> = { none: 0, view: 1, complete: 2, edit: 3, owner: 4 };

export function atLeast(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

// One round-trip: owner wins, else the share level, else none.
export async function effectiveRole(appkit: TodoAppKit, email: string, listId: number): Promise<Role> {
  const { rows } = await appkit.lakebase.query(
    `SELECT CASE
              WHEN l.owner_email = $2 THEN 'owner'
              ELSE COALESCE(s.level, 'none')
            END AS role
     FROM todolist.lists l
     LEFT JOIN todolist.list_shares s ON s.list_id = l.id AND s.email = $2
     WHERE l.id = $1`,
    [listId, email]
  );
  if (rows.length === 0) return 'none';
  return rows[0].role as Role;
}

export interface TaskAccess {
  role: Role;
  listId: number;
  isAssignee: boolean;
  task: Record<string, unknown>;
}

// Load a task plus the caller's role on its list. Returns null when the task
// doesn't exist or the caller has no access — callers 404 either way so list
// existence never leaks.
export async function taskAccess(appkit: TodoAppKit, email: string, taskId: number): Promise<TaskAccess | null> {
  const { rows } = await appkit.lakebase.query(
    `SELECT ${TASK_COLS}, l.name AS list_name,
            CASE WHEN l.owner_email = $2 THEN 'owner' ELSE COALESCE(s.level, 'none') END AS _role
     FROM todolist.tasks t
     JOIN todolist.lists l ON l.id = t.list_id
     LEFT JOIN todolist.list_shares s ON s.list_id = l.id AND s.email = $2
     WHERE t.id = $1`,
    [taskId, email]
  );
  if (rows.length === 0) return null;
  const task = rows[0];
  const role = task._role as Role;
  delete task._role;
  if (role === 'none') return null;
  return {
    role,
    listId: Number(task.list_id),
    isAssignee: task.assigned_to === email,
    task,
  };
}

// SQL fragment: lists the caller can see (owner or any share level).
// Interpolates a parameter placeholder index for the caller's email.
export function accessibleListsSql(emailParam: string): string {
  return `(
    SELECT l.id FROM todolist.lists l WHERE l.owner_email = ${emailParam}
    UNION
    SELECT s.list_id FROM todolist.list_shares s WHERE s.email = ${emailParam}
  )`;
}
