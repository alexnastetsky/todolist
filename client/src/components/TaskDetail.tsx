import { useCallback, useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  Input,
  Textarea,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Badge,
} from '@databricks/appkit-ui/react';
import { api, type TaskDetailResponse, type Effort, type Energy } from '../lib/api';
import { useApp } from '../AppContext';
import { RecurrenceEditor, type RecurrenceValue } from './RecurrenceEditor';
import { formatTimestamp, personName, todayStr, addDaysStr } from '../lib/format';

const ACTION_LABELS: Record<string, string> = {
  created: 'created this',
  completed: 'completed this',
  reopened: 'reopened this',
  assigned: 'assigned this',
  commented: 'commented',
  archived: 'archived this',
  restored: 'restored this',
  due_changed: 'moved the date',
  shared: 'shared the list',
  recurred: 'rolled forward',
};

export function TaskDetail({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { me, people } = useApp();
  // Loaded data is keyed by its task id so switching tasks never shows stale
  // content and no state reset is needed on prop change.
  const [loaded, setLoaded] = useState<{ id: number; data: TaskDetailResponse } | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [newTag, setNewTag] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (taskId !== null) {
      api
        .get<string[]>('/tags')
        .then(setAllTags)
        .catch(() => {});
    }
  }, [taskId]);

  const load = useCallback(() => {
    if (taskId === null) return;
    api
      .get<TaskDetailResponse>(`/tasks/${taskId}`)
      .then((d) => {
        setLoaded({ id: taskId, data: d });
        setTitle(d.task.title);
        setNotes(d.task.notes ?? '');
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  if (taskId === null) return null;

  const detail = loaded && loaded.id === taskId ? loaded.data : null;
  const t = detail?.task;
  const canEdit = detail ? detail.role === 'owner' || detail.role === 'edit' : false;
  const canComplete = detail ? canEdit || detail.role === 'complete' || detail.isAssignee : false;
  const canSnooze = detail ? canEdit || detail.isAssignee : false;

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/tasks/${taskId}`, body);
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const recurrence: RecurrenceValue | null = t?.recur_kind
    ? {
        kind: t.recur_kind,
        interval: t.recur_interval ?? 1,
        unit: t.recur_unit,
        weekdays: t.recur_weekdays,
        monthday: t.recur_monthday,
      }
    : null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-4 sm:p-6">
        {!detail || !t ? (
          <SheetHeader className="p-0">
            <SheetTitle>{error ?? 'Loading…'}</SheetTitle>
          </SheetHeader>
        ) : (
          <div className="space-y-4">
            <SheetHeader className="p-0 space-y-2">
              <SheetTitle className="sr-only">Task detail</SheetTitle>
              <Input
                value={title}
                disabled={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== t.title && void patch({ title: title.trim() })}
                className="text-base font-medium"
              />
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{t.list_name ?? ''}</span>
                {t.status === 'done' && <Badge variant="secondary">done</Badge>}
                {t.status === 'archived' && <Badge variant="secondary">archived</Badge>}
                {t.someday && <Badge variant="outline">someday</Badge>}
              </div>
            </SheetHeader>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap gap-2">
              {t.status === 'open' && (
                <Button size="sm" disabled={!canComplete} onClick={() => void act(() => api.post(`/tasks/${taskId}/complete`))}>
                  ✓ Complete
                </Button>
              )}
              {t.status === 'done' && (
                <Button size="sm" variant="outline" disabled={!canComplete} onClick={() => void act(() => api.post(`/tasks/${taskId}/reopen`))}>
                  Reopen
                </Button>
              )}
              <Button
                size="sm"
                variant={t.starred ? 'default' : 'outline'}
                disabled={!canEdit}
                className={t.starred ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}
                onClick={() => void patch({ starred: !t.starred })}
              >
                {t.starred ? '★ Starred' : '☆ Star'}
              </Button>
              {canSnooze && t.status === 'open' && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void patch({ dueDate: addDaysStr(todayStr(), 1) })}>
                    +1d
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void patch({ dueDate: addDaysStr(todayStr(), 7) })}>
                    +1w
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void patch({ dueDate: null, someday: true })}>
                    Someday
                  </Button>
                </>
              )}
              {canEdit && t.status !== 'archived' && (
                <Button size="sm" variant="ghost" onClick={() => void act(() => api.post(`/tasks/${taskId}/archive`))}>
                  Archive
                </Button>
              )}
              {canEdit && t.status === 'archived' && (
                <Button size="sm" variant="ghost" onClick={() => void act(() => api.post(`/tasks/${taskId}/restore`))}>
                  Restore
                </Button>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    if (window.confirm('Delete this task? Its history stays in the activity log.')) {
                      void act(async () => {
                        await api.delete(`/tasks/${taskId}`);
                        onClose();
                      });
                    }
                  }}
                >
                  Delete
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground space-y-1">
                <span>When (soft — it can slide)</span>
                <Input
                  type="date"
                  disabled={!canSnooze}
                  value={t.due_date ?? ''}
                  onChange={(e) => void patch({ dueDate: e.target.value || null, someday: false })}
                />
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Assigned to</span>
                <Select
                  disabled={!canEdit}
                  value={t.assigned_to ?? 'nobody'}
                  onValueChange={(v) => void patch({ assignedTo: v === 'nobody' ? null : v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nobody">Nobody</SelectItem>
                    {detail.members.map((m) => (
                      <SelectItem key={m.email} value={m.email}>
                        {m.email === me.email ? 'Me' : (m.display_name ?? m.email)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Effort</span>
                <Select
                  disabled={!canEdit}
                  value={t.effort ?? 'unset'}
                  onValueChange={(v) => void patch({ effort: v === 'unset' ? null : (v as Effort) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">—</SelectItem>
                    <SelectItem value="5m">5 minutes</SelectItem>
                    <SelectItem value="20m">20 minutes</SelectItem>
                    <SelectItem value="1h">About an hour</SelectItem>
                    <SelectItem value="deep">Deep work</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Energy</span>
                <Select
                  disabled={!canEdit}
                  value={t.energy ?? 'unset'}
                  onValueChange={(v) => void patch({ energy: v === 'unset' ? null : (v as Energy) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">—</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Tags</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {t.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5"
                  >
                    +{tag}
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag}`}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => void patch({ tags: t.tags.filter((x) => x !== tag) })}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
                {canEdit && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = newTag.trim().toLowerCase().replace(/^[+#]/, '');
                      if (!v || t.tags.includes(v)) return;
                      setNewTag('');
                      void patch({ tags: [...t.tags, v] });
                    }}
                  >
                    <Input
                      list="tl-tag-suggestions"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="+ add tag"
                      className="h-7 w-32 text-xs"
                    />
                    <datalist id="tl-tag-suggestions">
                      {allTags
                        .filter((x) => !t.tags.includes(x))
                        .map((x) => (
                          <option key={x} value={x} />
                        ))}
                    </datalist>
                  </form>
                )}
                {!canEdit && t.tags.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Repeats</span>
              <RecurrenceEditor
                disabled={!canEdit}
                value={recurrence}
                onChange={(v) => void patch({ recurrence: v })}
              />
            </div>

            <Textarea
              placeholder="Notes"
              disabled={!canEdit}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (t.notes ?? '') && void patch({ notes: notes || null })}
              rows={3}
            />

            <Separator />

            <div className="space-y-2">
              <span className="text-sm font-medium">Checklist</span>
              {detail.subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={s.done}
                    disabled={!canComplete}
                    onCheckedChange={(v) => void act(() => api.patch(`/subtasks/${s.id}`, { done: v === true }))}
                  />
                  <span className={`text-sm flex-1 ${s.done ? 'line-through text-muted-foreground' : ''}`}>{s.title}</span>
                  {canEdit && (
                    <button
                      className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100"
                      onClick={() => void act(() => api.delete(`/subtasks/${s.id}`))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = newSubtask.trim();
                    if (!v) return;
                    setNewSubtask('');
                    void act(() => api.post(`/tasks/${taskId}/subtasks`, { title: v }));
                  }}
                >
                  <Input
                    placeholder="Add a step…"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Add
                  </Button>
                </form>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <span className="text-sm font-medium">Comments</span>
              {detail.comments.map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium">{personName(c.author_email, people, me.email)}</span>{' '}
                  <span className="text-xs text-muted-foreground">{formatTimestamp(c.created_at)}</span>
                  <p className="whitespace-pre-wrap break-words">{c.body}</p>
                </div>
              ))}
              {canComplete && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = newComment.trim();
                    if (!v) return;
                    setNewComment('');
                    void act(() => api.post(`/tasks/${taskId}/comments`, { body: v }));
                  }}
                >
                  <Input
                    placeholder="Add a comment…"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Post
                  </Button>
                </form>
              )}
            </div>

            {detail.activity.length > 0 && (
              <>
                <Separator />
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Activity</span>
                  {detail.activity.map((a, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {personName(a.actor_email, people, me.email)} {ACTION_LABELS[a.action] ?? a.action}
                      {a.action === 'due_changed' && typeof a.detail?.to === 'string' ? ` → ${a.detail.to}` : ''}
                      {' · '}
                      {formatTimestamp(a.created_at)}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
