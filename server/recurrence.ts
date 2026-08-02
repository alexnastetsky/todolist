// Pure date math for recurring tasks. All dates are calendar dates
// (YYYY-MM-DD strings); computed in UTC so no timezone can shift the day.

export interface RecurrenceFields {
  recur_kind: 'schedule' | 'after_done' | null;
  recur_interval: number | null;
  recur_unit: 'day' | 'week' | 'month' | null;
  recur_weekdays: number[] | null; // 0=Sun .. 6=Sat
  recur_monthday: number | null; // 1..31, clamped to month length
  due_date: string | null; // anchor for 'schedule'
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parse(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function clampedMonthday(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

// Next occurrence strictly after fromDate (the completion day), or null when
// the task isn't recurring / fields are incomplete.
export function nextOccurrence(r: RecurrenceFields, fromDate: string): string | null {
  if (!r.recur_kind) return null;
  const interval = Math.max(1, r.recur_interval ?? 1);
  const from = parse(fromDate);

  if (r.recur_kind === 'after_done') {
    // "N days after last completion" — the cadence most apps get wrong.
    return fmt(addDays(from, interval));
  }

  const anchor = parse(r.due_date ?? fromDate);
  const unit = r.recur_unit ?? 'day';

  if (unit === 'day') {
    // Smallest anchor + k*interval strictly after fromDate.
    let candidate = anchor;
    if (candidate.getTime() <= from.getTime()) {
      const diff = Math.floor((from.getTime() - anchor.getTime()) / DAY_MS);
      candidate = addDays(anchor, (Math.floor(diff / interval) + 1) * interval);
    }
    return fmt(candidate);
  }

  if (unit === 'week') {
    const weekdays = r.recur_weekdays && r.recur_weekdays.length > 0 ? r.recur_weekdays : [anchor.getUTCDay()];
    // Anchor week starts on the Sunday of the anchor's week; a date matches
    // when its weekday is selected and its week is a multiple of `interval`
    // weeks from the anchor week. Bounded scan keeps the logic obvious.
    const anchorWeekStart = addDays(anchor, -anchor.getUTCDay());
    for (let i = 1; i <= 7 * interval + 7; i++) {
      const d = addDays(from, i);
      if (!weekdays.includes(d.getUTCDay())) continue;
      const weekStart = addDays(d, -d.getUTCDay());
      const weeksApart = Math.round((weekStart.getTime() - anchorWeekStart.getTime()) / (7 * DAY_MS));
      if (((weeksApart % interval) + interval) % interval === 0) return fmt(d);
    }
    return null; // unreachable with valid inputs
  }

  // unit === 'month'
  const monthday = r.recur_monthday ?? anchor.getUTCDate();
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  for (let i = 0; i < 24; i++) {
    const candidate = clampedMonthday(year, month, monthday);
    if (candidate.getTime() > from.getTime()) {
      // Honor the interval relative to the anchor month.
      const monthsApart =
        (candidate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - anchor.getUTCMonth());
      if (((monthsApart % interval) + interval) % interval === 0) return fmt(candidate);
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return null; // unreachable with valid inputs
}
