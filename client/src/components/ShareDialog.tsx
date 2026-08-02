import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { api, type Share, type ShareLevel } from '../lib/api';
import { useApp } from '../AppContext';

const LEVEL_LABELS: Record<ShareLevel, string> = {
  view: 'Can view',
  complete: 'Can complete',
  edit: 'Can edit',
};

export function ShareDialog({
  listId,
  listName,
  shares,
  open,
  onOpenChange,
  onChanged,
}: {
  listId: number;
  listName: string;
  shares: Share[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { people } = useApp();
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<ShareLevel>('complete');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const add = async () => {
    const target = email.trim().toLowerCase();
    if (!target) return;
    try {
      const res = await api.put<{ ok: boolean; invited: boolean; emailConfigured: boolean }>(
        `/lists/${listId}/shares`,
        { email: target, level }
      );
      setEmail('');
      setError(null);
      if (res.invited) {
        setNotice(
          res.emailConfigured
            ? `${target} hasn't used Todos yet — we emailed them an invite link. If they can't sign in, they may also need access to this Databricks app.`
            : `${target} hasn't used Todos yet and email isn't configured — send them the link yourself, and make sure they have access to this Databricks app.`
        );
      } else {
        setNotice(null);
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setShareLevel = async (target: string, newLevel: ShareLevel) => {
    await api.put(`/lists/${listId}/shares`, { email: target, level: newLevel });
    onChanged();
  };

  const remove = async (target: string) => {
    await api.delete(`/lists/${listId}/shares/${encodeURIComponent(target)}`);
    onChanged();
  };

  const suggestions = people.filter(
    (p) => email.length > 0 && !shares.some((s) => s.email === p.email) && p.email.startsWith(email.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{listName}”</DialogTitle>
          <DialogDescription>
            People sign in with their own account; what they can do depends on the level you pick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="email@example.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Select value={level} onValueChange={(v) => setLevel(v as ShareLevel)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">Can view</SelectItem>
                <SelectItem value="complete">Can complete</SelectItem>
                <SelectItem value="edit">Can edit</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => void add()}>Share</Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.slice(0, 5).map((p) => (
                <button
                  key={p.email}
                  className="text-xs px-2 py-0.5 rounded-full border hover:bg-muted"
                  onClick={() => setEmail(p.email)}
                >
                  {p.display_name ? `${p.display_name} (${p.email})` : p.email}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {notice && <p className="text-xs text-muted-foreground rounded-md bg-muted/60 p-2">{notice}</p>}
        </div>

        <div className="space-y-2">
          {shares.length === 0 && <p className="text-sm text-muted-foreground">Not shared with anyone yet.</p>}
          {shares.map((s) => (
            <div key={s.email} className="flex items-center gap-2">
              <span className="flex-1 text-sm truncate">{s.display_name ?? s.email}</span>
              <Select value={s.level} onValueChange={(v) => void setShareLevel(s.email, v as ShareLevel)}>
                <SelectTrigger className="w-36 h-8">
                  <SelectValue>{LEVEL_LABELS[s.level]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">Can view</SelectItem>
                  <SelectItem value="complete">Can complete</SelectItem>
                  <SelectItem value="edit">Can edit</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => void remove(s.email)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
