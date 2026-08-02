// Date boundaries follow US Eastern, matching the pool app's convention.
// (Per-user timezones are a possible follow-up.)
export const TODAY_SQL = "(NOW() AT TIME ZONE 'America/New_York')::date";
export const TOMORROW_SQL = `(${TODAY_SQL} + 1)`;

export function localToday(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

export function localTomorrow(): string {
  // Calendar math on the date string keeps this immune to DST-day lengths.
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Explicit task column list. due_date is TO_CHAR'd so it reaches the client
// as a plain YYYY-MM-DD string — node-postgres would otherwise return a Date
// at server-local midnight, which can shift a calendar day across timezones.
// Ids are ::int-cast because pg serializes BIGINT as a string, and the client
// (and the zod body schemas ids round-trip through) expect numbers.
export const TASK_COLS = `
  t.id::int AS id, t.list_id::int AS list_id, t.title, t.notes, t.status, t.created_by, t.assigned_to, t.assigned_by,
  TO_CHAR(t.due_date, 'YYYY-MM-DD') AS due_date, t.someday, t.starred, t.tags, t.effort, t.energy, t.position,
  t.recur_kind, t.recur_interval, t.recur_unit, t.recur_weekdays, t.recur_monthday,
  t.completed_at, t.completed_by, t.archived_at, t.last_activity_at, t.created_at, t.updated_at`;

// Per-task rollups the list views show.
export const TASK_ROLLUPS = `
  (SELECT COUNT(*) FROM todolist.subtasks st WHERE st.task_id = t.id)::int AS subtask_count,
  (SELECT COUNT(*) FROM todolist.subtasks st WHERE st.task_id = t.id AND st.done)::int AS subtask_done_count,
  (SELECT COUNT(*) FROM todolist.comments c WHERE c.task_id = t.id)::int AS comment_count`;
