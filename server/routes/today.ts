import { z } from 'zod';
import { Application } from 'express';
import { TodoContext } from '../types';
import { handleError } from '../auth';
import { accessibleListsSql, taskAccess } from '../permissions';
import { TASK_COLS, TASK_ROLLUPS, TODAY_SQL, TOMORROW_SQL } from '../sql';

const PutTodayBody = z.object({
  taskIds: z.array(z.number().int()).max(50),
  day: z.enum(['today', 'tomorrow']).default('today'),
});

const EFFORTS = ['5m', '20m', '1h', 'deep'] as const;
const ENERGIES = ['low', 'medium', 'high'] as const;

export function registerTodayRoutes(app: Application, ctx: TodoContext) {
  const { appkit } = ctx;

  // The daily plan: a deliberately small set picked each day, distinct from
  // the master lists. Overdue soft dates come back as a separate triage
  // bucket — never mixed into the plan as a guilt pile.
  app.get('/todolist/api/today', async (req, res) => {
    try {
      const email = res.locals.email as string;
      const lists = accessibleListsSql('$1');

      const effort = EFFORTS.includes(req.query.effort as (typeof EFFORTS)[number])
        ? (req.query.effort as string)
        : null;
      const energy = ENERGIES.includes(req.query.energy as (typeof ENERGIES)[number])
        ? (req.query.energy as string)
        : null;
      const tag = typeof req.query.tag === 'string' && req.query.tag.length > 0 ? req.query.tag.toLowerCase() : null;

      // Picks keep their row even after completion so the plan shows
      // checked-off items for the rest of the day (satisfying, not vanishing).
      const picksSql = `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}, l.name AS list_name, p.position AS pick_position
         FROM todolist.today_picks p
         JOIN todolist.tasks t ON t.id = p.task_id
         JOIN todolist.lists l ON l.id = t.list_id
         WHERE p.email = $1 AND p.pick_date = %DAY% AND t.status <> 'archived'
         ORDER BY p.position, t.id`;
      const picks = await appkit.lakebase.query(picksSql.replace('%DAY%', TODAY_SQL), [email]);
      const tomorrowPicks = await appkit.lakebase.query(picksSql.replace('%DAY%', TOMORROW_SQL), [email]);

      // Anything already planned — for today OR tomorrow — leaves the
      // candidate pools below: it's handled, no need to offer or nag it.
      const planned = `t.id NOT IN (SELECT task_id FROM todolist.today_picks WHERE email = $1 AND pick_date >= ${TODAY_SQL})`;

      // Delegated work, priority (star) first — the view that answers "what
      // did someone put on my plate, and what do they want first?"
      const assignedToMe = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}, l.name AS list_name
         FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
         WHERE t.list_id IN ${lists} AND t.status = 'open' AND NOT t.someday
           AND t.assigned_to = $1
           AND ${planned}
         ORDER BY t.starred DESC, t.due_date ASC NULLS LAST, t.position, t.id`,
        [email]
      );

      const dueToday = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}, l.name AS list_name
         FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
         WHERE t.list_id IN ${lists} AND t.status = 'open' AND NOT t.someday
           AND t.due_date = ${TODAY_SQL}
           AND ${planned}
           AND (t.assigned_to IS NULL OR t.assigned_to <> $1)
         ORDER BY t.starred DESC, t.position, t.id`,
        [email]
      );

      // Candidates for tomorrow's plan; only my own or unassigned work —
      // tasks on someone else's plate are not candidates for my day.
      const dueTomorrow = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}, l.name AS list_name
         FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
         WHERE t.list_id IN ${lists} AND t.status = 'open' AND NOT t.someday
           AND t.due_date = ${TOMORROW_SQL}
           AND ${planned}
           AND (t.assigned_to IS NULL OR t.assigned_to = $1)
         ORDER BY t.starred DESC, t.position, t.id`,
        [email]
      );

      const needsTriage = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}, l.name AS list_name
         FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
         WHERE t.list_id IN ${lists} AND t.status = 'open' AND NOT t.someday
           AND t.due_date < ${TODAY_SQL}
           AND ${planned}
         ORDER BY t.due_date, t.id`,
        [email]
      );

      // Backlog candidates for "add to today": no date pressure, filterable
      // by effort/energy ("what can I do in 20 minutes"). Only unassigned
      // tasks — my own assignments have their own section, and work on
      // someone else's plate is not a candidate for my day.
      const suggestions = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}, l.name AS list_name
         FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
         WHERE t.list_id IN ${lists} AND t.status = 'open' AND NOT t.someday
           AND (t.due_date IS NULL OR t.due_date > ${TOMORROW_SQL})
           AND ${planned}
           AND t.assigned_to IS NULL
           AND ($2::text IS NULL OR t.effort = $2)
           AND ($3::text IS NULL OR t.energy = $3)
           AND ($4::text IS NULL OR $4 = ANY(t.tags))
         ORDER BY t.starred DESC, t.due_date ASC NULLS LAST, t.last_activity_at DESC
         LIMIT 30`,
        [email, effort, energy, tag]
      );

      const dates = await appkit.lakebase.query(
        `SELECT TO_CHAR(${TODAY_SQL}, 'YYYY-MM-DD') AS d, TO_CHAR(${TOMORROW_SQL}, 'YYYY-MM-DD') AS t`
      );
      res.json({
        date: dates.rows[0].d,
        tomorrowDate: dates.rows[0].t,
        picks: picks.rows,
        tomorrowPicks: tomorrowPicks.rows,
        assignedToMe: assignedToMe.rows,
        dueToday: dueToday.rows,
        dueTomorrow: dueTomorrow.rows,
        needsTriage: needsTriage.rows,
        suggestions: suggestions.rows,
      });
    } catch (err) {
      handleError(res, 'Failed to load today', err);
    }
  });

  // Someday/maybe: parked aspirations, out of the daily view by design.
  app.get('/todolist/api/someday', async (_req, res) => {
    try {
      const email = res.locals.email as string;
      const { rows } = await appkit.lakebase.query(
        `SELECT ${TASK_COLS}, ${TASK_ROLLUPS}, l.name AS list_name
         FROM todolist.tasks t JOIN todolist.lists l ON l.id = t.list_id
         WHERE t.list_id IN ${accessibleListsSql('$1')} AND t.status = 'open' AND t.someday
         ORDER BY t.last_activity_at DESC`,
        [email]
      );
      res.json(rows);
    } catch (err) {
      handleError(res, 'Failed to load someday tasks', err);
    }
  });

  // Replace the plan for today or tomorrow. Any task you can see may go on
  // your own plan. Tomorrow's picks become today's automatically at midnight.
  app.put('/todolist/api/today', async (req, res) => {
    try {
      const parsed = PutTodayBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid today payload' });
        return;
      }
      const daySql = parsed.data.day === 'tomorrow' ? TOMORROW_SQL : TODAY_SQL;
      const email = res.locals.email as string;
      const allowed: number[] = [];
      for (const taskId of parsed.data.taskIds) {
        if (await taskAccess(appkit, email, taskId)) allowed.push(taskId);
      }
      await appkit.lakebase.query(
        `DELETE FROM todolist.today_picks WHERE email = $1 AND pick_date = ${daySql}`,
        [email]
      );
      for (let i = 0; i < allowed.length; i++) {
        await appkit.lakebase.query(
          `INSERT INTO todolist.today_picks (email, task_id, pick_date, position)
           VALUES ($1, $2, ${daySql}, $3) ON CONFLICT DO NOTHING`,
          [email, allowed[i], i]
        );
      }
      res.json({ ok: true, count: allowed.length });
    } catch (err) {
      handleError(res, 'Failed to save today plan', err);
    }
  });
}
