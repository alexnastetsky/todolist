import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { api, type Task } from '../lib/api';
import { formatTimestamp } from '../lib/format';

export function ArchivePage() {
  const [params] = useSearchParams();
  const listFilter = params.get('list');
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const refresh = useCallback(() => {
    api
      .get<Task[]>(`/archive${listFilter ? `?list=${listFilter}` : ''}`)
      .then(setTasks)
      .catch(() => {});
  }, [listFilter]);
  useEffect(refresh, [refresh]);

  if (!tasks) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Archive</h2>
        <p className="text-xs text-muted-foreground">
          Tasks fade here when untouched for a while (or when you archive them). Restore anything, anytime.
        </p>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nothing archived.</p>
      ) : (
        tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-1.5 border-b last:border-b-0">
            <span className="flex-1 min-w-0">
              <span className="text-sm text-muted-foreground block truncate">{t.title}</span>
              <span className="text-xs text-muted-foreground/70">
                {t.list_name} · archived {t.archived_at ? formatTimestamp(t.archived_at) : ''}
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={() => {
                void api.post(`/tasks/${t.id}/restore`).then(refresh);
              }}
            >
              Restore
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
