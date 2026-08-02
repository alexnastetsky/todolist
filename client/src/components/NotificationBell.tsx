import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@databricks/appkit-ui/react';
import { api, type Notification } from '../lib/api';
import { useApp } from '../AppContext';
import { formatTimestamp } from '../lib/format';

const TYPE_ICONS: Record<Notification['type'], string> = {
  assigned: '👤',
  shared: '🔗',
  comment: '💬',
  completed: '✅',
  due_today: '📅',
};

export function NotificationBell() {
  const { me, refreshMe } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = () => {
    api
      .get<Notification[]>('/notifications')
      .then(setItems)
      .catch(() => setItems([]));
  };

  const markAllRead = async () => {
    await api.post('/notifications/read', { all: true });
    refreshMe();
    load();
  };

  const openItem = async (n: Notification) => {
    if (!n.read_at) {
      await api.post('/notifications/read', { ids: [n.id] });
      refreshMe();
    }
    setOpen(false);
    if (n.task_id) void navigate(`/task/${n.task_id}`);
    else if (n.list_id) void navigate(`/list/${n.list_id}`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative" aria-label="Notifications">
          🔔
          {me.unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[10px] leading-none rounded-full px-1 py-0.5 min-w-4 text-center">
              {me.unreadCount > 99 ? '99+' : me.unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-medium">Notifications</span>
          {me.unreadCount > 0 && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void markAllRead()}>
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nothing yet. When someone assigns, shares, comments, or completes, it lands here.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => void openItem(n)}
                className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-muted transition-colors ${
                  n.read_at ? 'opacity-60' : ''
                }`}
              >
                <span className="mr-1.5">{TYPE_ICONS[n.type]}</span>
                <span className="text-sm">{n.title}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{formatTimestamp(n.created_at)}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
