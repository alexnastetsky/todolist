import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Button,
  Skeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { api, type ListDetail, type ListSummary, type Task } from '../lib/api';
import { useApp } from '../AppContext';
import { QuickAdd } from '../components/QuickAdd';
import { TaskRow } from '../components/TaskRow';
import { TaskDetail } from '../components/TaskDetail';
import { ShareDialog } from '../components/ShareDialog';
import { SortableList, SortableRow } from '../components/Sortable';

type SortMode = 'my' | 'priority' | 'date' | 'newest' | 'effort';

const EFFORT_RANK: Record<string, number> = { '5m': 0, '20m': 1, '1h': 2, deep: 3 };

function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const t = [...tasks];
  switch (mode) {
    case 'priority':
      return t.sort((a, b) => Number(b.starred) - Number(a.starred) || a.position - b.position);
    case 'date':
      return t.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
    case 'newest':
      return t.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'effort':
      return t.sort((a, b) => (EFFORT_RANK[a.effort ?? ''] ?? 9) - (EFFORT_RANK[b.effort ?? ''] ?? 9));
    default:
      return t; // server order = manual position
  }
}

export function ListPage() {
  const { id } = useParams();
  const listId = parseInt(id ?? '', 10);
  const navigate = useNavigate();
  const { me } = useApp();
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('my');
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const refresh = useCallback(() => {
    api
      .get<ListDetail>(`/lists/${listId}`)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    api.get<ListSummary[]>('/lists').then(setLists).catch(() => {});
  }, [listId]);
  useEffect(refresh, [refresh]);

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        {error} — <Link to="/lists" className="underline">back to lists</Link>
      </p>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const isOwner = detail.role === 'owner';
  const canEdit = isOwner || detail.role === 'edit';
  const canComplete = canEdit || detail.role === 'complete';
  const openAll = sortTasks(
    detail.tasks.filter((t) => t.status === 'open'),
    sortMode
  );
  const listTags = [...new Set(openAll.flatMap((t) => t.tags))].sort();
  const open =
    tagFilter.length > 0 ? openAll.filter((t) => tagFilter.every((tag) => t.tags.includes(tag))) : openAll;
  const done = detail.tasks.filter((t) => t.status === 'done');
  // Reordering a filtered subset is ambiguous, so drag needs the full list.
  const dragEnabled = canEdit && sortMode === 'my' && tagFilter.length === 0;

  const reorder = (ids: number[]) => {
    // Optimistic: apply the new order locally, then persist and reconcile.
    setDetail((d) => {
      if (!d) return d;
      const byId = new Map(d.tasks.map((t) => [t.id, t]));
      const reordered = ids.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined);
      return { ...d, tasks: [...reordered, ...d.tasks.filter((t) => t.status !== 'open')] };
    });
    void api.post(`/lists/${listId}/tasks/reorder`, { taskIds: ids }).then(refresh);
  };

  const rename = async () => {
    const name = window.prompt('Rename list', detail.list.name)?.trim();
    if (name && name !== detail.list.name) {
      await api.patch(`/lists/${listId}`, { name });
      refresh();
    }
  };

  const deleteList = async () => {
    if (window.confirm(`Delete "${detail.list.name}" and all its tasks? This cannot be undone.`)) {
      await api.delete(`/lists/${listId}`);
      void navigate('/lists');
    }
  };

  const leave = async () => {
    if (window.confirm('Leave this list?')) {
      await api.delete(`/lists/${listId}/shares/${encodeURIComponent(me.email)}`);
      void navigate('/lists');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{detail.list.name}</h2>
        {!isOwner && (
          <span className="text-xs text-muted-foreground">
            {detail.list.owner_email.split('@')[0]}&apos;s list · you can {detail.role}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          {isOwner && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                Share{detail.shares.length > 0 ? ` (${detail.shares.length})` : ''}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void rename()}>
                Rename
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void deleteList()}>
                Delete
              </Button>
            </>
          )}
          {!isOwner && (
            <Button size="sm" variant="ghost" onClick={() => void leave()}>
              Leave
            </Button>
          )}
        </span>
      </div>

      {canEdit && <QuickAdd lists={lists} defaultListId={listId} onAdded={refresh} />}

      {(openAll.length > 1 || tagFilter.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {listTags.map((tag) => {
            const active = tagFilter.includes(tag);
            return (
              <button
                key={tag}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
                }`}
                onClick={() => setTagFilter(active ? tagFilter.filter((x) => x !== tag) : [...tagFilter, tag])}
              >
                +{tag}
              </button>
            );
          })}
          <span className="ml-auto">
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="my">My order</SelectItem>
                <SelectItem value="priority">Priority first</SelectItem>
                <SelectItem value="date">By date</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="effort">Quick wins first</SelectItem>
              </SelectContent>
            </Select>
          </span>
        </div>
      )}

      <section>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">
            {tagFilter.length > 0
              ? 'Nothing matches those tags.'
              : `All clear. ${canEdit ? 'Add something above, or enjoy the moment.' : 'Nothing open right now.'}`}
          </p>
        ) : dragEnabled ? (
          <SortableList ids={open.map((t) => t.id)} onReorder={reorder}>
            {open.map((t) => (
              <SortableRow key={t.id} id={t.id}>
                <TaskRow task={t} canComplete={canComplete} onChanged={refresh} onOpen={(x) => setOpenTaskId(x.id)} />
              </SortableRow>
            ))}
          </SortableList>
        ) : (
          open.map((t) => (
            <TaskRow key={t.id} task={t} canComplete={canComplete} onChanged={refresh} onOpen={(x) => setOpenTaskId(x.id)} />
          ))
        )}
      </section>

      {done.length > 0 && (
        <section>
          <button
            className="text-xs text-muted-foreground hover:text-foreground mb-1"
            onClick={() => setShowDone(!showDone)}
          >
            {showDone ? '▾' : '▸'} {done.length} completed
          </button>
          {showDone &&
            done.map((t) => (
              <TaskRow key={t.id} task={t} canComplete={canComplete} onChanged={refresh} onOpen={(x) => setOpenTaskId(x.id)} />
            ))}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Untouched tasks fade to the <Link to={`/archive?list=${listId}`} className="underline">archive</Link> after a
        couple of months — nothing is ever lost.
      </p>

      <ShareDialog
        listId={listId}
        listName={detail.list.name}
        shares={detail.shares}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onChanged={refresh}
      />
      <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={refresh} />
    </div>
  );
}
