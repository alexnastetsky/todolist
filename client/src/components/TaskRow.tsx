import { Checkbox, Badge } from '@databricks/appkit-ui/react';
import { api, type Task } from '../lib/api';
import { useApp } from '../AppContext';
import { formatDue, personName, EFFORT_LABELS, ENERGY_LABELS, recurrenceLabel } from '../lib/format';

// One task line, used across Today / list / someday views. Completing is
// optimistic-free: we just await and let the parent refresh.
export function TaskRow({
  task,
  onChanged,
  onOpen,
  onCompleted,
  showList = false,
  canComplete = true,
}: {
  task: Task;
  onChanged: () => void;
  onOpen: (task: Task) => void;
  // Fired only when ticking a task off (never on reopen). The daily plan uses
  // it to hold the row in place for a beat before it sinks below the open ones.
  onCompleted?: (taskId: number) => void;
  showList?: boolean;
  canComplete?: boolean;
}) {
  const { me, people } = useApp();
  const done = task.status === 'done';
  const recur = recurrenceLabel(task);

  const toggle = async () => {
    try {
      if (done) await api.post(`/tasks/${task.id}/reopen`);
      else {
        await api.post(`/tasks/${task.id}/complete`);
        onCompleted?.(task.id);
      }
      onChanged();
    } catch {
      onChanged();
    }
  };

  const toggleStar = async () => {
    try {
      await api.patch(`/tasks/${task.id}`, { starred: !task.starred });
    } catch {
      // Server enforces edit role; refresh below reverts a rejected toggle.
    }
    onChanged();
  };

  return (
    <div className="flex items-start gap-2.5 py-2 px-1 border-b last:border-b-0 group min-h-11">
      <Checkbox
        checked={done}
        disabled={!canComplete}
        onCheckedChange={() => void toggle()}
        className="mt-0.5"
        aria-label={done ? 'Reopen task' : 'Complete task'}
      />
      <button
        className={`mt-0.5 shrink-0 text-sm leading-none ${
          task.starred ? 'text-amber-500' : 'text-muted-foreground/40 hover:text-amber-500'
        }`}
        onClick={() => void toggleStar()}
        aria-label={task.starred ? 'Unstar task' : 'Star task'}
        title={task.starred ? 'Unstar task' : 'Star task'}
      >
        {task.starred ? '★' : '☆'}
      </button>
      <button className="flex-1 text-left min-w-0" onClick={() => onOpen(task)}>
        <span className={`text-sm break-words ${done ? 'line-through text-muted-foreground' : ''}`}>
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {showList && task.list_name && (
            <span className="text-xs text-muted-foreground">{task.list_name}</span>
          )}
          {task.due_date && !done && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {formatDue(task.due_date)}
            </Badge>
          )}
          {recur && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              ↻ {recur}
            </Badge>
          )}
          {task.effort && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {EFFORT_LABELS[task.effort]}
            </Badge>
          )}
          {task.energy && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              ⚡ {ENERGY_LABELS[task.energy]}
            </Badge>
          )}
          {task.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
              +{tag}
            </Badge>
          ))}
          {task.assigned_to && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              → {personName(task.assigned_to, people, me.email)}
            </Badge>
          )}
          {(task.subtask_count ?? 0) > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {task.subtask_done_count}/{task.subtask_count}
            </span>
          )}
          {(task.comment_count ?? 0) > 0 && (
            <span className="text-[10px] text-muted-foreground">💬 {task.comment_count}</span>
          )}
        </span>
      </button>
    </div>
  );
}
