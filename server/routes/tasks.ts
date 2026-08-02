import { z } from 'zod';
import { Application, Response } from 'express';
import { TodoContext, TodoAppKit } from '../types';
import { handleError } from '../auth';
import { effectiveRole, taskAccess, atLeast, TaskAccess } from '../permissions';
import { logActivity, displayName } from '../activity';
import { notify } from '../notify';
import { nextOccurrence, RecurrenceFields } from '../recurrence';
import { TASK_COLS, TODAY_SQL, TOMORROW_SQL, localToday, localTomorrow } from '../sql';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RecurrenceBody = z.object({
  kind: z.enum(['schedule', 'after_done']),
  interval: z.number().int().min(1).max(365).default(1),
  unit: z.enum(['day', 'week', 'month']).nullish(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
  monthday: z.number().int().min(1).max(31).nullish(),
});

const CreateTaskBody = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(10000).nullish(),
  dueDate: z.string().regex(DATE_RE).nullish(),
  someday: z.boolean().optional(),
  starred: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  effort: z.enum(['5m', '20m', '1h', 'deep']).nullish(),
  energy: z.enum(['low', 'medium', 'high']).nullish(),
  assignedTo: z.string().trim().toLowerCase().email().nullish(),
  recurrence: RecurrenceBody.nullish(),
});

// A date change makes upcoming plan picks stale: drop any user's pick from
// today onward that no longer matches the task's new date ("moved off today
// means off today's plan"). null (someday / cleared date) drops them all;
// a pick for the exact new date survives.
async function dropStalePicks(appkit: TodoAppKit, taskId: number, newDue: string | null): Promise<void> {
  await appkit.lakebase.query(
    `DELETE FROM todolist.today_picks
     WHERE task_id = $1 AND pick_date >= ${TODAY_SQL}
       AND ($2::date IS NULL OR pick_date <> $2::date)`,
    [taskId, newDue]
  );
}

// A due date on the plan horizon maps to the day plan it belongs on.
function planDayFor(due: string | null | undefined): 'today' | 'tomorrow' | null {
  if (due === localToday()) return 'today';
  if (due === localTomorrow()) return 'tomorrow';
  return null;
}

// Inverse of dropStalePicks: a task dated today/tomorrow belongs on the
// acting user's plan for that day. Appended at the end; no-op if picked.
async function addDayPick(
  appkit: TodoAppKit,
  email: string,
  taskId: number,
  day: 'today' | 'tomorrow'
): Promise<void> {
  const daySql = day === 'tomorrow' ? TOMORROW_SQL : TODAY_SQL;
  await appkit.lakebase.query(
    `INSERT INTO todolist.today_picks (email, task_id, pick_date, position)
     SELECT $1, $2, ${daySql},
            COALESCE((SELECT MAX(position) + 1 FROM todolist.today_picks
                      WHERE email = $1 AND pick_date = ${daySql}), 0)
     ON CONFLICT DO NOTHING`,
    [email, taskId]
  );
}

// Lowercase, strip a leading +/# capture prefix, dedupe.
function normalizeTags(tags: string[] | undefined): string[] | null {
  if (tags === undefined) return null;
  const clean = tags.map((t) => t.toLowerCase().replace(/^[+#]/, '').trim()).filter((t) => t.length > 0);
  return [...new Set(clean)];
}

const PatchTaskBody = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(10000).nullable().optional(),
  dueDate: z.string().regex(DATE_RE).nullable().optional(),
  someday: z.boolean().optional(),
  starred: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  effort: z.enum(['5m', '20m', '1h', 'deep']).nullable().optional(),
  energy: z.enum(['low', 'medium', 'high']).nullable().optional(),
  position: z.number().int().optional(),
  listId: z.number().int().optional(),
  assignedTo: z.string().trim().toLowerCase().email().nullable().optional(),
  recurrence: RecurrenceBody.nullable().optional(),
});

const RescheduleBody = z.object({
  taskIds: z.array(z.number().int()).min(1).max(200),
  // A date string moves the intention; null clears it; 'someday' parks it.
  dueDate: z.union([z.string().regex(DATE_RE), z.literal('someday'), z.null()]),
});

const ReorderBody = z.object({ taskIds: z.array(z.number().int()).min(1).max(500) });

const SubtaskBody = z.object({ title: z.string().trim().min(1).max(500) });
const PatchSubtaskBody = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  done: z.boolean().optional(),
  position: z.number().int().optional(),
});
const CommentBody = z.object({ body: z.string().trim().min(1).max(10000) });

async function isMember(appkit: TodoAppKit, listId: number, email: string): Promise<boolean> {
  const { rows } = await appkit.lakebase.query(
    `SELECT 1 FROM todolist.lists l
     LEFT JOIN todolist.list_shares s ON s.list_id = l.id AND s.email = $2
     WHERE l.id = $1 AND (l.owner_email = $2 OR s.email IS NOT NULL)`,
    [listId, email]
  );
  return rows.length > 0;
}

function touchSql(): string {
  return 'last_activity_at = NOW(), updated_at = NOW()';
}

// Explicit field-by-field mapping from a raw task row; keeps the recurrence
// module's input honest without type assertions.
function toRecurrenceFields(task: Record<string, unknown>): RecurrenceFields {
  return {
    recur_kind: task.recur_kind === 'schedule' || task.recur_kind === 'after_done' ? task.recur_kind : null,
    recur_interval: typeof task.recur_interval === 'number' ? task.recur_interval : null,
    recur_unit:
      task.recur_unit === 'day' || task.recur_unit === 'week' || task.recur_unit === 'month' ? task.recur_unit : null,
    recur_weekdays: Array.isArray(task.recur_weekdays)
      ? task.recur_weekdays.filter((d): d is number => typeof d === 'number')
      : null,
    recur_monthday: typeof task.recur_monthday === 'number' ? task.recur_monthday : null,
    due_date: typeof task.due_date === 'string' ? task.due_date : null,
  };
}

// Load a task, resolving the caller's access. Writes the 404/400 response
// itself and returns null when the caller can't proceed.
async function requireTask(
  appkit: TodoAppKit,
  res: Response,
  rawId: unknown,
  email: string
): Promise<TaskAccess | null> {
  const taskId = parseInt(String(rawId), 10);
  if (isNaN(taskId)) {
    res.status(400).json({ error: 'Invalid task id' });
    return null;
  }
  const access = await taskAccess(appkit, email, taskId);
  if (!access) {
    res.status(404).json({ error: 'Task not found' });
    return null;
  }
  return access;
}

export function registerTaskRoutes(app: Application, ctx: TodoContext) {
  const { appkit, emailSender } = ctx;

  async function notifyAssigned(
    actor: string,
    target: string,
    taskId: number,
    listId: number,
    title: string,
    starred: boolean
  ) {
    await logActivity(appkit, { listId, taskId, taskTitle: title, actor, action: 'assigned', detail: { to: target } });
    await notify(appkit, emailSender, {
      recipient: target,
      type: 'assigned',
      actor,
      taskId,
      listId,
      title: `${await displayName(appkit, actor)} assigned you "${title}"${starred ? ' (priority)' : ''}`,
    });
  }

  app.post('/todolist/api/lists/:id/tasks', async (req, res) => {
    try {
      const listId = parseInt(String(req.params.id), 10);
      const parsed = CreateTaskBody.safeParse(req.body);
      if (isNaN(listId) || !parsed.success) {
        res.status(400).json({ error: 'Invalid task payload' });
        return;
      }
      const email = res.locals.email as string;
      const role = await effectiveRole(appkit, email, listId);
      if (role === 'none') {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      if (!atLeast(role, 'edit')) {
        res.status(403).json({ error: 'You cannot add tasks to this list' });
        return;
      }
      const b = parsed.data;
      if (b.assignedTo && !(await isMember(appkit, listId, b.assignedTo))) {
        res.status(400).json({ error: 'Assignee must be a member of the list', code: 'not_a_member' });
        return;
      }
      const r = b.recurrence;
      const { rows } = await appkit.lakebase.query(
        `INSERT INTO todolist.tasks
           (list_id, title, notes, created_by, assigned_to, assigned_by, due_date, someday, starred, tags, effort, energy,
            recur_kind, recur_interval, recur_unit, recur_weekdays, recur_monthday, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 COALESCE((SELECT MAX(position) + 1 FROM todolist.tasks WHERE list_id = $1), 0))
         RETURNING id`,
        [
          listId,
          b.title,
          b.notes ?? null,
          email,
          b.assignedTo ?? null,
          b.assignedTo ? email : null,
          b.dueDate ?? null,
          b.someday ?? false,
          b.starred ?? false,
          normalizeTags(b.tags) ?? [],
          b.effort ?? null,
          b.energy ?? null,
          r?.kind ?? null,
          r?.interval ?? null,
          r?.unit ?? null,
          r?.weekdays ?? null,
          r?.monthday ?? null,
        ]
      );
      const taskId = Number(rows[0].id);
      const planDay = planDayFor(b.dueDate);
      if (!(b.someday ?? false) && planDay) await addDayPick(appkit, email, taskId, planDay);
      await logActivity(appkit, { listId, taskId, taskTitle: b.title, actor: email, action: 'created' });
      if (b.assignedTo && b.assignedTo !== email) {
        await notifyAssigned(email, b.assignedTo, taskId, listId, b.title, b.starred ?? false);
      }
      const task = await appkit.lakebase.query(`SELECT ${TASK_COLS} FROM todolist.tasks t WHERE t.id = $1`, [taskId]);
      res.status(201).json(task.rows[0]);
    } catch (err) {
      handleError(res, 'Failed to create task', err);
    }
  });

  app.get('/todolist/api/tasks/:id', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const access = await requireTask(appkit, res, req.params.id, email);
      if (!access) return;
      const taskId = Number(access.task.id);
      const subtasks = await appkit.lakebase.query(
        'SELECT id::int AS id, title, done, position FROM todolist.subtasks WHERE task_id = $1 ORDER BY position, id',
        [taskId]
      );
      const comments = await appkit.lakebase.query(
        `SELECT c.id::int AS id, c.author_email, c.body, c.created_at, u.display_name AS author_name
         FROM todolist.comments c LEFT JOIN todolist.users u ON u.email = c.author_email
         WHERE c.task_id = $1 ORDER BY c.created_at`,
        [taskId]
      );
      const activity = await appkit.lakebase.query(
        `SELECT actor_email, action, detail, created_at FROM todolist.activity
         WHERE task_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [taskId]
      );
      // Owner + sharees = the valid assignee pool for this task's list.
      const members = await appkit.lakebase.query(
        `SELECT l.owner_email AS email, 'owner' AS level, u.display_name
         FROM todolist.lists l LEFT JOIN todolist.users u ON u.email = l.owner_email WHERE l.id = $1
         UNION ALL
         SELECT s.email, s.level, u.display_name
         FROM todolist.list_shares s LEFT JOIN todolist.users u ON u.email = s.email WHERE s.list_id = $1`,
        [access.listId]
      );
      res.json({
        task: access.task,
        role: access.role,
        isAssignee: access.isAssignee,
        subtasks: subtasks.rows,
        comments: comments.rows,
        activity: activity.rows,
        members: members.rows,
      });
    } catch (err) {
      handleError(res, 'Failed to load task', err);
    }
  });

  app.patch('/todolist/api/tasks/:id', async (req, res) => {
    try {
      const parsed = PatchTaskBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid task update' });
        return;
      }
      const email = res.locals.email as string;
      const access = await requireTask(appkit, res, req.params.id, email);
      if (!access) return;
      const b = parsed.data;
      const taskId = Number(access.task.id);

      const canEdit = atLeast(access.role, 'edit');
      if (!canEdit) {
        // Assignee override: the person a task is assigned to may snooze it
        // (change its date / park it in someday) even on a view-only share.
        const keys = Object.keys(b);
        const snoozeOnly = keys.every((k) => k === 'dueDate' || k === 'someday');
        if (!access.isAssignee || !snoozeOnly) {
          res.status(403).json({ error: 'You cannot edit this task' });
          return;
        }
      }

      let targetList = access.listId;
      if (b.listId !== undefined && b.listId !== access.listId) {
        const destRole = await effectiveRole(appkit, email, b.listId);
        if (!atLeast(destRole, 'edit')) {
          res.status(403).json({ error: 'You cannot move tasks to that list' });
          return;
        }
        targetList = b.listId;
      }
      if (b.assignedTo !== undefined && b.assignedTo !== null) {
        if (!(await isMember(appkit, targetList, b.assignedTo))) {
          res.status(400).json({ error: 'Assignee must be a member of the list', code: 'not_a_member' });
          return;
        }
      }

      const r = b.recurrence;
      await appkit.lakebase.query(
        `UPDATE todolist.tasks SET
           title = COALESCE($2, title),
           notes = CASE WHEN $3 THEN $4 ELSE notes END,
           due_date = CASE WHEN $5 THEN $6::date ELSE due_date END,
           someday = COALESCE($7, someday),
           starred = COALESCE($8, starred),
           tags = CASE WHEN $9 THEN $10 ELSE tags END,
           effort = CASE WHEN $11 THEN $12 ELSE effort END,
           energy = CASE WHEN $13 THEN $14 ELSE energy END,
           position = COALESCE($15, position),
           list_id = $16,
           assigned_to = CASE WHEN $17 THEN $18 ELSE assigned_to END,
           assigned_by = CASE WHEN $17 THEN (CASE WHEN $18 IS NULL THEN NULL ELSE $19 END) ELSE assigned_by END,
           recur_kind = CASE WHEN $20 THEN $21 ELSE recur_kind END,
           recur_interval = CASE WHEN $20 THEN $22 ELSE recur_interval END,
           recur_unit = CASE WHEN $20 THEN $23 ELSE recur_unit END,
           recur_weekdays = CASE WHEN $20 THEN $24 ELSE recur_weekdays END,
           recur_monthday = CASE WHEN $20 THEN $25 ELSE recur_monthday END,
           ${touchSql()}
         WHERE id = $1`,
        [
          taskId,
          b.title ?? null,
          b.notes !== undefined,
          b.notes ?? null,
          b.dueDate !== undefined,
          b.dueDate ?? null,
          b.someday ?? null,
          b.starred ?? null,
          b.tags !== undefined,
          normalizeTags(b.tags),
          b.effort !== undefined,
          b.effort ?? null,
          b.energy !== undefined,
          b.energy ?? null,
          b.position ?? null,
          targetList,
          b.assignedTo !== undefined,
          b.assignedTo ?? null,
          email,
          b.recurrence !== undefined,
          r?.kind ?? null,
          r?.interval ?? null,
          r?.unit ?? null,
          r?.weekdays ?? null,
          r?.monthday ?? null,
        ]
      );

      const title = String(b.title ?? access.task.title);
      if (b.dueDate !== undefined && b.dueDate !== access.task.due_date) {
        await dropStalePicks(appkit, taskId, b.dueDate);
        const planDay = planDayFor(b.dueDate);
        if (planDay && (b.someday ?? access.task.someday) !== true && access.task.status === 'open') {
          await addDayPick(appkit, email, taskId, planDay);
        }
        await logActivity(appkit, {
          listId: targetList,
          taskId,
          taskTitle: title,
          actor: email,
          action: 'due_changed',
          detail: { from: access.task.due_date ?? null, to: b.dueDate },
        });
      } else if (b.someday === true && access.task.someday !== true) {
        // Parked in someday: it has no business on anyone's day plan.
        await dropStalePicks(appkit, taskId, null);
      }
      if (b.assignedTo !== undefined && b.assignedTo !== null && b.assignedTo !== access.task.assigned_to) {
        await notifyAssigned(email, b.assignedTo, taskId, targetList, title, b.starred ?? access.task.starred === true);
      }
      const task = await appkit.lakebase.query(`SELECT ${TASK_COLS} FROM todolist.tasks t WHERE t.id = $1`, [taskId]);
      res.json(task.rows[0]);
    } catch (err) {
      handleError(res, 'Failed to update task', err);
    }
  });

  app.post('/todolist/api/tasks/:id/complete', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const access = await requireTask(appkit, res, req.params.id, email);
      if (!access) return;
      if (!atLeast(access.role, 'complete') && !access.isAssignee) {
        res.status(403).json({ error: 'You cannot complete tasks on this list' });
        return;
      }
      const taskId = Number(access.task.id);
      const title = String(access.task.title);
      if (access.task.status !== 'open') {
        res.status(409).json({ error: 'Task is not open' });
        return;
      }

      // The activity row IS the accomplishment record — written for both
      // one-off and recurring completions.
      await logActivity(appkit, { listId: access.listId, taskId, taskTitle: title, actor: email, action: 'completed' });

      let recurredTo: string | null = null;
      if (access.task.recur_kind) {
        // Recurring: single-row roll-forward. The task stays open with the
        // next due date; nothing piles up and history lives in activity.
        recurredTo = nextOccurrence(toRecurrenceFields(access.task), localToday());
        await appkit.lakebase.query(
          `UPDATE todolist.tasks SET due_date = $2::date, someday = FALSE, completed_at = NULL, completed_by = NULL,
             ${touchSql()} WHERE id = $1`,
          [taskId, recurredTo]
        );
        await appkit.lakebase.query('UPDATE todolist.subtasks SET done = FALSE WHERE task_id = $1', [taskId]);
        // Done for today: drop it from everyone's plan (today's and any
        // pre-made tomorrow plan) so it doesn't reappear unchecked; it comes
        // back naturally when the next date arrives.
        await appkit.lakebase.query(
          `DELETE FROM todolist.today_picks WHERE task_id = $1 AND pick_date >= ${TODAY_SQL}`,
          [taskId]
        );
        await logActivity(appkit, {
          listId: access.listId,
          taskId,
          taskTitle: title,
          actor: email,
          action: 'recurred',
          detail: { next: recurredTo },
        });
      } else {
        await appkit.lakebase.query(
          `UPDATE todolist.tasks SET status = 'done', completed_at = NOW(), completed_by = $2, ${touchSql()}
           WHERE id = $1`,
          [taskId, email]
        );
        // Today's pick stays (shows checked-off for the rest of the day), but
        // a finished task has no business opening anyone's tomorrow plan.
        await appkit.lakebase.query(
          `DELETE FROM todolist.today_picks WHERE task_id = $1 AND pick_date > ${TODAY_SQL}`,
          [taskId]
        );
      }

      const who = await displayName(appkit, email);
      for (const recipient of new Set(
        [access.task.created_by, access.task.assigned_by].filter((e): e is string => typeof e === 'string' && !!e)
      )) {
        await notify(appkit, emailSender, {
          recipient,
          type: 'completed',
          actor: email,
          taskId,
          listId: access.listId,
          title: `${who} completed "${title}"`,
        });
      }
      const task = await appkit.lakebase.query(`SELECT ${TASK_COLS} FROM todolist.tasks t WHERE t.id = $1`, [taskId]);
      res.json({ task: task.rows[0], recurredTo });
    } catch (err) {
      handleError(res, 'Failed to complete task', err);
    }
  });

  app.post('/todolist/api/tasks/:id/reopen', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const access = await requireTask(appkit, res, req.params.id, email);
      if (!access) return;
      if (!atLeast(access.role, 'complete') && !access.isAssignee) {
        res.status(403).json({ error: 'You cannot reopen tasks on this list' });
        return;
      }
      const taskId = Number(access.task.id);
      await appkit.lakebase.query(
        `UPDATE todolist.tasks SET status = 'open', completed_at = NULL, completed_by = NULL, ${touchSql()}
         WHERE id = $1 AND status = 'done'`,
        [taskId]
      );
      await logActivity(appkit, {
        listId: access.listId,
        taskId,
        taskTitle: String(access.task.title),
        actor: email,
        action: 'reopened',
      });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to reopen task', err);
    }
  });

  for (const [verb, action, newStatus] of [
    ['archive', 'archived', 'archived'],
    ['restore', 'restored', 'open'],
  ] as const) {
    app.post(`/todolist/api/tasks/:id/${verb}`, async (req, res) => {
      try {
        const email = res.locals.email as string;
        const access = await requireTask(appkit, res, req.params.id, email);
        if (!access) return;
        if (!atLeast(access.role, 'edit')) {
          res.status(403).json({ error: `You cannot ${verb} tasks on this list` });
          return;
        }
        const taskId = Number(access.task.id);
        await appkit.lakebase.query(
          `UPDATE todolist.tasks
           SET status = $2, archived_at = CASE WHEN $2 = 'archived' THEN NOW() ELSE NULL END, ${touchSql()}
           WHERE id = $1`,
          [taskId, newStatus]
        );
        await logActivity(appkit, {
          listId: access.listId,
          taskId,
          taskTitle: String(access.task.title),
          actor: email,
          action,
        });
        res.json({ ok: true });
      } catch (err) {
        handleError(res, `Failed to ${verb} task`, err);
      }
    });
  }

  app.delete('/todolist/api/tasks/:id', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const access = await requireTask(appkit, res, req.params.id, email);
      if (!access) return;
      if (!atLeast(access.role, 'edit')) {
        res.status(403).json({ error: 'You cannot delete tasks on this list' });
        return;
      }
      // Deleting must be guilt-free and easy; the activity log keeps the
      // record (task_id nulls out, title survives).
      await appkit.lakebase.query('DELETE FROM todolist.tasks WHERE id = $1', [Number(access.task.id)]);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to delete task', err);
    }
  });

  // Bulk triage: move a set of soft due dates at once ("reschedule all").
  app.post('/todolist/api/tasks/reschedule', async (req, res) => {
    try {
      const parsed = RescheduleBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid reschedule payload' });
        return;
      }
      const email = res.locals.email as string;
      const { taskIds, dueDate } = parsed.data;
      let updated = 0;
      for (const taskId of taskIds) {
        const access = await taskAccess(appkit, email, taskId);
        if (!access) continue;
        if (!atLeast(access.role, 'edit') && !access.isAssignee) continue;
        if (dueDate === 'someday') {
          await appkit.lakebase.query(
            `UPDATE todolist.tasks SET someday = TRUE, due_date = NULL, ${touchSql()} WHERE id = $1`,
            [taskId]
          );
        } else {
          await appkit.lakebase.query(
            `UPDATE todolist.tasks SET due_date = $2::date, someday = FALSE, ${touchSql()} WHERE id = $1`,
            [taskId, dueDate]
          );
        }
        await dropStalePicks(appkit, taskId, dueDate === 'someday' ? null : dueDate);
        const planDay = dueDate === 'someday' ? null : planDayFor(dueDate);
        if (planDay && access.task.status === 'open') await addDayPick(appkit, email, taskId, planDay);
        await logActivity(appkit, {
          listId: access.listId,
          taskId,
          taskTitle: String(access.task.title),
          actor: email,
          action: 'due_changed',
          detail: { from: access.task.due_date ?? null, to: dueDate },
        });
        updated++;
      }
      res.json({ ok: true, updated });
    } catch (err) {
      handleError(res, 'Failed to reschedule tasks', err);
    }
  });

  // Persist a drag-reorder: position = index in the given order. Only tasks
  // actually in the list move; ids from other lists are ignored by the WHERE.
  app.post('/todolist/api/lists/:id/tasks/reorder', async (req, res) => {
    try {
      const listId = parseInt(String(req.params.id), 10);
      const parsed = ReorderBody.safeParse(req.body);
      if (isNaN(listId) || !parsed.success) {
        res.status(400).json({ error: 'Invalid reorder payload' });
        return;
      }
      const email = res.locals.email as string;
      const role = await effectiveRole(appkit, email, listId);
      if (role === 'none') {
        res.status(404).json({ error: 'List not found' });
        return;
      }
      if (!atLeast(role, 'edit')) {
        res.status(403).json({ error: 'You cannot reorder tasks on this list' });
        return;
      }
      for (let i = 0; i < parsed.data.taskIds.length; i++) {
        await appkit.lakebase.query(
          'UPDATE todolist.tasks SET position = $3, updated_at = NOW() WHERE id = $1 AND list_id = $2',
          [parsed.data.taskIds[i], listId, i]
        );
      }
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to reorder tasks', err);
    }
  });

  // ---- Subtasks ----

  app.post('/todolist/api/tasks/:id/subtasks', async (req, res) => {
    try {
      const parsed = SubtaskBody.safeParse(req.body);
      const email = res.locals.email as string;
      const access = await requireTask(appkit, res, req.params.id, email);
      if (!access) return;
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid subtask payload' });
        return;
      }
      if (!atLeast(access.role, 'edit')) {
        res.status(403).json({ error: 'You cannot edit tasks on this list' });
        return;
      }
      const taskId = Number(access.task.id);
      const { rows } = await appkit.lakebase.query(
        `INSERT INTO todolist.subtasks (task_id, title, position)
         VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM todolist.subtasks WHERE task_id = $1), 0))
         RETURNING id::int AS id, title, done, position`,
        [taskId, parsed.data.title]
      );
      await appkit.lakebase.query(`UPDATE todolist.tasks SET ${touchSql()} WHERE id = $1`, [taskId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      handleError(res, 'Failed to add subtask', err);
    }
  });

  async function subtaskParent(rawId: unknown, res: Response, email: string): Promise<TaskAccess | null> {
    const subtaskId = parseInt(String(rawId), 10);
    if (isNaN(subtaskId)) {
      res.status(400).json({ error: 'Invalid subtask id' });
      return null;
    }
    const { rows } = await appkit.lakebase.query('SELECT task_id FROM todolist.subtasks WHERE id = $1', [subtaskId]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Subtask not found' });
      return null;
    }
    const access = await taskAccess(appkit, email, Number(rows[0].task_id));
    if (!access) {
      res.status(404).json({ error: 'Subtask not found' });
      return null;
    }
    return access;
  }

  app.patch('/todolist/api/subtasks/:id', async (req, res) => {
    try {
      const parsed = PatchSubtaskBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid subtask update' });
        return;
      }
      const email = res.locals.email as string;
      const access = await subtaskParent(req.params.id, res, email);
      if (!access) return;
      const b = parsed.data;
      const togglesOnly = Object.keys(b).every((k) => k === 'done');
      const allowed = togglesOnly
        ? atLeast(access.role, 'complete') || access.isAssignee
        : atLeast(access.role, 'edit');
      if (!allowed) {
        res.status(403).json({ error: 'You cannot change this subtask' });
        return;
      }
      await appkit.lakebase.query(
        `UPDATE todolist.subtasks SET
           title = COALESCE($2, title), done = COALESCE($3, done), position = COALESCE($4, position)
         WHERE id = $1`,
        [parseInt(String(req.params.id), 10), b.title ?? null, b.done ?? null, b.position ?? null]
      );
      await appkit.lakebase.query(`UPDATE todolist.tasks SET ${touchSql()} WHERE id = $1`, [Number(access.task.id)]);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to update subtask', err);
    }
  });

  app.delete('/todolist/api/subtasks/:id', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const access = await subtaskParent(req.params.id, res, email);
      if (!access) return;
      if (!atLeast(access.role, 'edit')) {
        res.status(403).json({ error: 'You cannot edit tasks on this list' });
        return;
      }
      await appkit.lakebase.query('DELETE FROM todolist.subtasks WHERE id = $1', [parseInt(String(req.params.id), 10)]);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to delete subtask', err);
    }
  });

  // ---- Comments ----

  app.post('/todolist/api/tasks/:id/comments', async (req, res) => {
    try {
      const parsed = CommentBody.safeParse(req.body);
      const email = res.locals.email as string;
      const access = await requireTask(appkit, res, req.params.id, email);
      if (!access) return;
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid comment' });
        return;
      }
      if (!atLeast(access.role, 'complete') && !access.isAssignee) {
        res.status(403).json({ error: 'You cannot comment on this list' });
        return;
      }
      const taskId = Number(access.task.id);
      const title = String(access.task.title);
      const { rows } = await appkit.lakebase.query(
        `INSERT INTO todolist.comments (task_id, author_email, body) VALUES ($1, $2, $3)
         RETURNING id::int AS id, author_email, body, created_at`,
        [taskId, email, parsed.data.body]
      );
      await appkit.lakebase.query(`UPDATE todolist.tasks SET ${touchSql()} WHERE id = $1`, [taskId]);
      await logActivity(appkit, { listId: access.listId, taskId, taskTitle: title, actor: email, action: 'commented' });

      // Notify everyone in the task's conversation: creator, assignee, and
      // prior commenters — minus the author.
      const others = await appkit.lakebase.query(
        'SELECT DISTINCT author_email FROM todolist.comments WHERE task_id = $1 AND author_email <> $2',
        [taskId, email]
      );
      const recipients = new Set<string>(others.rows.map((r) => String(r.author_email)));
      for (const e of [access.task.created_by, access.task.assigned_to]) {
        if (typeof e === 'string' && e && e !== email) recipients.add(e);
      }
      const who = await displayName(appkit, email);
      for (const recipient of recipients) {
        await notify(appkit, emailSender, {
          recipient,
          type: 'comment',
          actor: email,
          taskId,
          listId: access.listId,
          title: `${who} commented on "${title}"`,
        });
      }
      res.status(201).json(rows[0]);
    } catch (err) {
      handleError(res, 'Failed to add comment', err);
    }
  });

  app.delete('/todolist/api/comments/:id', async (req, res) => {
    try {
      const commentId = parseInt(String(req.params.id), 10);
      const email = res.locals.email as string;
      if (isNaN(commentId)) {
        res.status(400).json({ error: 'Invalid comment id' });
        return;
      }
      const { rows } = await appkit.lakebase.query(
        `SELECT c.author_email, t.list_id FROM todolist.comments c
         JOIN todolist.tasks t ON t.id = c.task_id WHERE c.id = $1`,
        [commentId]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      const isAuthor = rows[0].author_email === email;
      const role = await effectiveRole(appkit, email, Number(rows[0].list_id));
      if (!isAuthor && role !== 'owner') {
        res.status(403).json({ error: 'Only the author or the list owner can delete a comment' });
        return;
      }
      if (role === 'none') {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      await appkit.lakebase.query('DELETE FROM todolist.comments WHERE id = $1', [commentId]);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, 'Failed to delete comment', err);
    }
  });
}
