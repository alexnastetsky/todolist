import { useState } from 'react';
import { Button, Input, Switch, Label } from '@databricks/appkit-ui/react';
import { api } from '../lib/api';
import { useApp } from '../AppContext';

const EMAIL_PREFS: { key: string; field: string; label: string }[] = [
  { key: 'email_assigned', field: 'emailAssigned', label: 'Someone assigns me a task' },
  { key: 'email_shared', field: 'emailShared', label: 'Someone shares a list with me' },
  { key: 'email_comment', field: 'emailComment', label: 'Comments on my tasks' },
  { key: 'email_completed', field: 'emailCompleted', label: 'A task I created or assigned gets completed' },
  { key: 'email_due_today', field: 'emailDueToday', label: "A task of mine comes due" },
];

export function SettingsPage() {
  const { me, refreshMe } = useApp();
  const [name, setName] = useState(me.displayName ?? '');
  const [saved, setSaved] = useState(false);

  const saveName = async () => {
    if (name.trim()) {
      await api.put('/me/prefs', { displayName: name.trim() });
      refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  const togglePref = async (field: string, value: boolean) => {
    await api.put('/me/prefs', { [field]: value });
    refreshMe();
  };

  return (
    <div className="space-y-6 max-w-md">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Profile</h2>
        <p className="text-xs text-muted-foreground">Signed in as {me.email}</p>
        <div className="flex gap-2">
          <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="outline" onClick={() => void saveName()}>
            {saved ? 'Saved ✓' : 'Save'}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Notifications</h2>
          <p className="text-xs text-muted-foreground">
            Notify me only when someone completes a task I created, or someone else puts a task on my plate. Applies to
            the bell and email; switch off to get every event (reminders about your own tasks, all comments and
            completions).
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="essential_only" className="text-sm font-normal">
            Essential only
          </Label>
          <Switch
            id="essential_only"
            checked={Boolean(me.prefs.essential_only)}
            onCheckedChange={(v) => void togglePref('essentialOnly', v === true)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Email notifications</h2>
          <p className="text-xs text-muted-foreground">
            In-app notifications (the bell) are always on.{' '}
            {me.emailConfigured
              ? 'Email is on by default — switch off anything you don’t want in your inbox:'
              : 'Email delivery is not configured on this server yet — these switches will take effect once it is.'}
          </p>
        </div>
        {EMAIL_PREFS.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3">
            <Label htmlFor={p.key} className="text-sm font-normal">
              {p.label}
            </Label>
            <Switch
              id={p.key}
              checked={Boolean(me.prefs[p.key as keyof typeof me.prefs])}
              onCheckedChange={(v) => void togglePref(p.field, v === true)}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
