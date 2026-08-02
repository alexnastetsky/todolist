import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Input, Skeleton, Badge } from '@databricks/appkit-ui/react';
import { api, type ListSummary } from '../lib/api';
import { useApp } from '../AppContext';

export function ListsPage() {
  const { me } = useApp();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(() => {
    api.get<ListSummary[]>('/lists').then(setLists).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    await api.post('/lists', { name });
    setNewName('');
    refresh();
  };

  if (!lists) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const mine = lists.filter((l) => l.role === 'owner');
  const shared = lists.filter((l) => l.role !== 'owner');

  const ListCard = ({ list }: { list: ListSummary }) => (
    <Link
      to={`/list/${list.id}`}
      className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: list.color ?? 'var(--muted-foreground)' }}
      />
      <span className="flex-1 min-w-0">
        <span className="text-sm font-medium block truncate">{list.name}</span>
        <span className="text-xs text-muted-foreground">
          {list.open_count} open
          {list.done_count > 0 ? ` · ${list.done_count} done` : ''}
          {list.role !== 'owner' ? ` · shared by ${list.owner_email.split('@')[0]}` : ''}
          {list.role === 'owner' && list.share_count > 0
            ? ` · shared with ${list.share_count} ${list.share_count === 1 ? 'person' : 'people'}`
            : ''}
        </span>
      </span>
      {list.role !== 'owner' && (
        <Badge variant="outline" className="text-[10px] shrink-0">
          {list.role}
        </Badge>
      )}
    </Link>
  );

  return (
    <div className="space-y-5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Input placeholder="New list name…" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit">Create</Button>
      </form>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">My lists</h2>
        {mine.length === 0 && <p className="text-sm text-muted-foreground">No lists yet — create one above.</p>}
        {mine.map((l) => (
          <ListCard key={l.id} list={l} />
        ))}
      </section>

      {shared.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Shared with me ({me.email})</h2>
          {shared.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
        </section>
      )}
    </div>
  );
}
