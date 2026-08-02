import { Button, Badge } from '@databricks/appkit-ui/react';
import { api, type Task, type PlanDay } from '../lib/api';
import { formatDue, todayStr, addDaysStr } from '../lib/format';

// The anti-guilt-pile: past-dated tasks aren't "overdue in red", they're a
// calm "still want to?" list with one-tap ways to slide or park each one —
// or to put it straight on a plan (which also counts as triage: planned
// tasks leave this banner without their date changing).
export function TriageBanner({
  tasks,
  onChanged,
  onOpen,
  onPlan,
}: {
  tasks: Task[];
  onChanged: () => void;
  onOpen: (t: Task) => void;
  onPlan?: (t: Task, day: PlanDay) => void;
}) {
  if (tasks.length === 0) return null;

  const rescheduleAll = async (dueDate: string | null) => {
    await api.post('/tasks/reschedule', { taskIds: tasks.map((t) => t.id), dueDate });
    onChanged();
  };

  const snoozeOne = async (task: Task, dueDate: string | null) => {
    await api.post('/tasks/reschedule', { taskIds: [task.id], dueDate });
    onChanged();
  };

  return (
    <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} slid past their date
        </span>
        <span className="text-xs text-muted-foreground">— no big deal, just pick a new time:</span>
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void rescheduleAll(todayStr())}>
            All → today
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void rescheduleAll(null)}>
            Clear dates
          </Button>
        </span>
      </div>
      <div className="space-y-1">
        {tasks.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <button className="flex-1 min-w-32 text-left truncate hover:underline" onClick={() => onOpen(t)}>
              {t.title}
            </button>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
              was {formatDue(t.due_date)}
            </Badge>
            <span className="flex items-center gap-1 shrink-0 ml-auto">
              {onPlan && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-xs"
                    title="Add to today's plan (keeps its date)"
                    onClick={() => onPlan(t, 'today')}
                  >
                    + today
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-xs"
                    title="Add to tomorrow's plan (keeps its date)"
                    onClick={() => onPlan(t, 'tomorrow')}
                  >
                    + tmrw
                  </Button>
                  <span className="w-px h-4 bg-border mx-0.5" aria-hidden />
                </>
              )}
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => void snoozeOne(t, todayStr())}>
                today
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => void snoozeOne(t, addDaysStr(todayStr(), 7))}>
                +1w
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => void snoozeOne(t, 'someday')}>
                someday
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
