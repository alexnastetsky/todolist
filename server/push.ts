// Web Push delivery for the installed PWA. Mirrors email.ts in spirit: the
// whole channel is optional, and without VAPID keys it disables itself rather
// than erroring. That also makes it the fastest rollback — clear
// VAPID_PRIVATE_KEY and push stops, leaving the bell and email untouched.
import webpush from 'web-push';
import { TodoAppKit } from './types';

export interface PushPayload {
  title: string;
  // Deep link into the SPA; the service worker opens it on notification click.
  url?: string;
  // Collapses repeat notifications about the same thing in the Android tray.
  tag?: string;
}

// Resolved once. null means "configured off" — checked before every send so a
// missing key is a no-op rather than a thrown error inside notify().
let vapid: { publicKey: string } | null = null;
let initialised = false;

function init(): boolean {
  if (initialised) return vapid !== null;
  initialised = true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.log('[todolist] web push disabled (no VAPID keys)');
    return false;
  }
  // Push services require a contact for the key owner; they use it to reach
  // out before blocking a misbehaving sender.
  const subject = process.env.VAPID_SUBJECT ?? `mailto:${process.env.ADMIN_EMAIL ?? 'admin@example.com'}`;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapid = { publicKey };
    return true;
  } catch (err) {
    console.warn('[todolist] web push disabled (bad VAPID config):', (err as Error).message);
    return false;
  }
}

// Handed to the client so it can subscribe. Null when push is switched off,
// which the settings UI reads as "not available".
export function pushPublicKey(): string | null {
  return init() ? vapid!.publicKey : null;
}

// Fan out to every device this person has registered. Never throws: a push
// failure must not fail the action that triggered the notification.
export async function sendPush(appkit: TodoAppKit, recipient: string, payload: PushPayload): Promise<void> {
  if (!init()) return;
  try {
    const { rows } = await appkit.lakebase.query(
      'SELECT endpoint, p256dh, auth FROM todolist.push_subscriptions WHERE email = $1',
      [recipient]
    );
    if (rows.length === 0) return;

    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      rows.map((r) =>
        webpush.sendNotification(
          {
            endpoint: r.endpoint as string,
            keys: { p256dh: r.p256dh as string, auth: r.auth as string },
          },
          body
        )
      )
    );

    // 404/410 is the push service saying this subscription is permanently
    // gone (app uninstalled, permission revoked, browser data cleared).
    // Anything else — including a transient 5xx — is left alone to retry on
    // the next notification.
    const dead: string[] = [];
    results.forEach((res, i) => {
      if (res.status !== 'rejected') return;
      const status = (res.reason as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) dead.push(rows[i].endpoint as string);
      else console.warn('[todolist] push send failed:', status, (res.reason as Error).message);
    });
    if (dead.length > 0) {
      await appkit.lakebase.query('DELETE FROM todolist.push_subscriptions WHERE endpoint = ANY($1::text[])', [dead]);
      console.log(`[todolist] pruned ${dead.length} expired push subscription(s)`);
    }
  } catch (err) {
    console.warn('[todolist] push failed:', (err as Error).message);
  }
}
