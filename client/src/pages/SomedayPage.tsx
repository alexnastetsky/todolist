import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { api, type Task } from '../lib/api';
import { TaskRow } from '../components/TaskRow';
import { TaskDetail } from '../components/TaskDetail';
import { todayStr } from '../lib/format';

export function SomedayPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    api.get<Task[]>('/someday').then(setTasks).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  if (!tasks) return <Skeleton className="h-32 w-full" />;

  const activate = async (task: Task) => {
    await api.post('/tasks/reschedule', { taskIds: [task.id], dueDate: todayStr() });
    refresh();
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Someday / maybe</h2>
        <p className="text-xs text-muted-foreground">
          Parked ideas. They stay out of your day until you promote one — no reminders, no guilt.
        </p>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nothing parked. Add tasks here with “!someday” in quick-add.</p>
      ) : (
        tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-1">
            <div className="flex-1 min-w-0">
              <TaskRow task={t} showList onChanged={refresh} onOpen={(x) => setOpenTaskId(x.id)} />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs text-muted-foreground shrink-0"
              onClick={() => void activate(t)}
            >
              → today
            </Button>
          </div>
        ))
      )}
      <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={refresh} />
    </div>
  );
}
