// Web Push subscription management for the installed PWA.
//
// Two independent switches decide whether a notification reaches the tray:
// this device having a push subscription, and the account-level push_enabled
// pref. This module owns the first; SettingsPage owns the second.
import { api } from './api';

export type PushState =
  | 'unsupported' // browser has no Push API (or no service worker)
  | 'unavailable' // server has no VAPID keys configured
  | 'denied' // user blocked notifications; Android never re-prompts
  | 'off' // supported and allowed, just not subscribed on this device
  | 'on';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// The VAPID key travels as base64url; subscribe() wants raw bytes.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function serverKey(): Promise<string | null> {
  const { key } = await api.get<{ key: string | null }>('/push/key');
  return key;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/todolist/');
  return reg ? await reg.pushManager.getSubscription() : null;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!(await serverKey())) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSubscription()) ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const key = await serverKey();
  if (!key) return 'unavailable';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  // Waits for the worker to be active — subscribing against a registration
  // that is still installing throws.
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      // Required by Chrome: every push must result in a visible notification.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));

  await api.post('/push/subscribe', sub.toJSON());
  return 'on';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  // Drop the server row first: if unsubscribe() succeeded but the request
  // failed, the server would keep pushing to a dead endpoint until it 410s.
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
