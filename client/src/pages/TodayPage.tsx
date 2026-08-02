import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { api, type TodayResponse, type ListSummary, type Task, type Effort, type Energy, type PlanDay } from '../lib/api';
import { QuickAdd } from '../components/QuickAdd';
import { TaskRow } from '../components/TaskRow';
import { TriageBanner } from '../components/TriageBanner';
import { TaskDetail } from '../components/TaskDetail';
import { SortableList, SortableRow } from '../components/Sortable';
import { todayStr, EFFORT_LABELS } from '../lib/format';

const EFFORTS: Effort[] = ['5m', '20m', '1h', 'deep'];
const ENERGIES: Energy[] = ['low', 'medium', 'high'];

export function TodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [energy, setEnergy] = useState<Energy | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (effort) params.set('effort', effort);
    if (energy) params.set('energy', energy);
    if (tag) params.set('tag', tag);
    const qs = params.toString();
    api.get<TodayResponse>(`/today${qs ? `?${qs}` : ''}`).then(setData).catch(() => {});
    api.get<ListSummary[]>('/lists').then(setLists).catch(() => {});
    api.get<string[]>('/tags').then(setAllTags).catch(() => {});
  }, [effort, energy, tag]);

  useEffect(refresh, [refresh]);

  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const planIds = (day: PlanDay) => (day === 'today' ? data.picks : data.tomorrowPicks).map((t) => t.id);

  const addToPlan = async (task: Task, day: PlanDay) => {
    await api.put('/today', { taskIds: [...planIds(day), task.id], day });
    refresh();
  };
  const removeFromPlan = async (task: Task, day: PlanDay) => {
    await api.put('/today', { taskIds: planIds(day).filter((id) => id !== task.id), day });
    refresh();
  };
  const movePlan = async (task: Task, from: PlanDay, to: PlanDay) => {
    await api.put('/today', { taskIds: planIds(from).filter((id) => id !== task.id), day: from });
    await api.put('/today', { taskIds: [...planIds(to), task.id], day: to });
    refresh();
  };
  const reorderPicks = (ids: number[], day: PlanDay) => {
    const key = day === 'today' ? 'picks' : 'tomorrowPicks';
    setData((d) => {
      if (!d) return d;
      const byId = new Map(d[key].map((t) => [t.id, t]));
      return { ...d, [key]: ids.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined) };
    });
    void api.put('/today', { taskIds: ids, day }).then(refresh);
  };

  const openDone = data.picks.filter((t) => t.status === 'done').length;

  // Plain render helpers (not components) so list identity stays stable.
  const planRows = (tasks: Task[], day: PlanDay) => (
    <SortableList ids={tasks.map((t) => t.id)} onReorder={(ids) => reorderPicks(ids, day)}>
      {tasks.map((t) => (
        <SortableRow key={t.id} id={t.id}>
          <div className="flex items-center gap-1">
            <div className="flex-1 min-w-0">
              <TaskRow task={t} showList onChanged={refresh} onOpen={(x) => setOpenTaskId(x.id)} />
            </div>
            {t.status === 'open' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs text-muted-foreground shrink-0"
                  title={day === 'today' ? "Move to tomorrow's plan" : "Move to today's plan"}
                  onClick={() => void movePlan(t, day, day === 'today' ? 'tomorrow' : 'today')}
                >
                  {day === 'today' ? '→ tmrw' : '→ today'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs text-muted-foreground shrink-0"
                  title={`Remove from ${day === 'today' ? "today's" : "tomorrow's"} plan`}
                  onClick={() => void removeFromPlan(t, day)}
                >
                  ✕
                </Button>
              </>
            )}
          </div>
        </SortableRow>
      ))}
    </SortableList>
  );

  const feederRow = (t: Task) => (
    <div key={t.id} className="flex items-center gap-1">
      <div className="flex-1 min-w-0">
        <TaskRow task={t} showList onChanged={refresh} onOpen={(x) => setOpenTaskId(x.id)} />
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs text-muted-foreground shrink-0"
        onClick={() => void addToPlan(t, 'today')}
      >
        + today
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs text-muted-foreground shrink-0"
        onClick={() => void addToPlan(t, 'tomorrow')}
      >
        + tmrw
      </Button>
    </div>
  );

  return (
    <div className="space-y-5">
      <QuickAdd lists={lists} defaultDue={todayStr()} onAdded={refresh} />

      <TriageBanner
        tasks={data.needsTriage}
        onChanged={refresh}
        onOpen={(t) => setOpenTaskId(t.id)}
        onPlan={(t, day) => void addToPlan(t, day)}
      />

      <section>
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-sm font-semibold">Today&apos;s plan</h2>
          {data.picks.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {openDone}/{data.picks.length} done
            </span>
          )}
        </div>
        {data.picks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Nothing planned yet. Pick a few things below — a short list you&apos;ll actually finish beats a long one.
          </p>
        ) : (
          planRows(data.picks, 'today')
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-1">Tomorrow&apos;s plan</h2>
        {data.tomorrowPicks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Nothing planned for tomorrow yet — use <span className="font-medium">+ tmrw</span> below to set up your day
            tonight.
          </p>
        ) : (
          planRows(data.tomorrowPicks, 'tomorrow')
        )}
      </section>

      {data.assignedToMe.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-1">Assigned to me</h2>
          {data.assignedToMe.map(feederRow)}
        </section>
      )}

      {data.dueToday.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-1">Due today</h2>
          {data.dueToday.map(feederRow)}
        </section>
      )}

      {data.dueTomorrow.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-1">Due tomorrow</h2>
          {data.dueTomorrow.map(feederRow)}
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <h2 className="text-sm font-semibold mr-1">From your backlog</h2>
          {EFFORTS.map((e) => (
            <button
              key={e}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                effort === e ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
              }`}
              onClick={() => setEffort(effort === e ? null : e)}
            >
              {EFFORT_LABELS[e]}
            </button>
          ))}
          {ENERGIES.map((e) => (
            <button
              key={e}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                energy === e ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
              }`}
              onClick={() => setEnergy(energy === e ? null : e)}
            >
              {e} energy
            </button>
          ))}
          {allTags.map((x) => (
            <button
              key={x}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                tag === x ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
              }`}
              onClick={() => setTag(tag === x ? null : x)}
            >
              +{x}
            </button>
          ))}
        </div>
        {data.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {effort || energy || tag ? 'Nothing matches that filter right now.' : 'Backlog is clear. Nice.'}
          </p>
        ) : (
          data.suggestions.map(feederRow)
        )}
      </section>

      <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={refresh} />
    </div>
  );
}
