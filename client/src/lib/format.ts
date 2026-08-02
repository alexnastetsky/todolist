import type { Task, Person } from './api';

export function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

export function addDaysStr(base: string, days: number): string {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA').format(d);
}

// Calm, human phrasing for soft dates: "today", "tomorrow", "Mon", "Jun 3".
export function formatDue(due: string | null): string | null {
  if (!due) return null;
  const today = todayStr();
  if (due === today) return 'today';
  if (due === addDaysStr(today, 1)) return 'tomorrow';
  const d = new Date(`${due}T12:00:00`);
  const diffDays = Math.round((d.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dayHeading(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function personName(email: string | null, people: Person[], me?: string): string {
  if (!email) return '';
  if (me && email === me) return 'you';
  const p = people.find((x) => x.email === email);
  return p?.display_name ?? email.split('@')[0];
}

export const EFFORT_LABELS: Record<string, string> = {
  '5m': '5 min',
  '20m': '20 min',
  '1h': '1 hour',
  deep: 'deep work',
};

export const ENERGY_LABELS: Record<string, string> = {
  low: 'low',
  medium: 'med',
  high: 'high',
};

export function recurrenceLabel(
  t: Pick<Task, 'recur_kind' | 'recur_interval' | 'recur_unit' | 'recur_weekdays' | 'recur_monthday'>
): string | null {
  if (!t.recur_kind) return null;
  const n = t.recur_interval ?? 1;
  if (t.recur_kind === 'after_done') return `${n}d after done`;
  const unit = t.recur_unit ?? 'day';
  if (unit === 'week' && t.recur_weekdays?.length) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = t.recur_weekdays.map((d) => names[d]).join(', ');
    return n === 1 ? `every ${days}` : `every ${n} wks: ${days}`;
  }
  const unitLabel = n === 1 ? unit : `${n} ${unit}s`;
  return `every ${unitLabel}${unit === 'month' && t.recur_monthday ? ` (day ${t.recur_monthday})` : ''}`;
}
