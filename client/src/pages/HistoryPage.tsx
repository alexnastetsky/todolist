import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input, Skeleton } from '@databricks/appkit-ui/react';
import { api, type ActivityEntry, type ListSummary } from '../lib/api';
import { useApp } from '../AppContext';
import { dayHeading, formatTimestamp, personName } from '../lib/format';
import { TaskDetail } from '../components/TaskDetail';

// "What did I get done, and when?" — and the same for anyone whose lists you
// can see. This page is the payoff of the activity log.
export function HistoryPage() {
  const { me, people } = useApp();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [person, setPerson] = useState<string>('anyone');
  const [listId, setListId] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (person !== 'anyone') params.set('person', person);
    if (listId !== 'all') params.set('list', listId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    api.get<ActivityEntry[]>(`/history${qs ? `?${qs}` : ''}`).then(setEntries).catch(() => {});
    api.get<ListSummary[]>('/lists').then(setLists).catch(() => {});
  }, [person, listId, from, to]);
  useEffect(refresh, [refresh]);

  const grouped: { day: string; items: ActivityEntry[] }[] = [];
  for (const e of entries ?? []) {
    const day = dayHeading(e.created_at);
    const last = grouped[grouped.length - 1];
    if (last && last.day === day) last.items.push(e);
    else grouped.push({ day, items: [e] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={person} onValueChange={setPerson}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anyone">Anyone</SelectItem>
            <SelectItem value={me.email}>Me</SelectItem>
            {people.map((p) => (
              <SelectItem key={p.email} value={p.email}>
                {p.display_name ?? p.email.split('@')[0]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={listId} onValueChange={setListId}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lists</SelectItem>
            {lists.map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 h-9" aria-label="From" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 h-9" aria-label="To" />
      </div>

      {!entries ? (
        <Skeleton className="h-32 w-full" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Nothing completed in this view yet. Done tasks land here the moment the checkbox is ticked.
        </p>
      ) : (
        grouped.map((g) => (
          <section key={g.day}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{g.day}</h3>
            {g.items.map((e, i) => (
              <div key={e.id ?? i} className="flex items-baseline gap-2 py-1 text-sm border-b last:border-b-0">
                <span className="text-muted-foreground shrink-0">✓</span>
                {e.task_id ? (
                  <button className="text-left hover:underline min-w-0 truncate" onClick={() => setOpenTaskId(e.task_id)}>
                    {e.task_title}
                  </button>
                ) : (
                  <span className="min-w-0 truncate">{e.task_title}</span>
                )}
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {personName(e.actor_email, people, me.email)}
                  {e.list_name ? ` · ${e.list_name}` : ''} · {formatTimestamp(e.created_at)}
                </span>
              </div>
            ))}
          </section>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        Looking for faded-out tasks? They&apos;re in the <Link to="/archive" className="underline">archive</Link>.
      </p>

      <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={refresh} />
    </div>
  );
}
