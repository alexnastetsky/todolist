// Provider-agnostic email sending. Resend is called with bare fetch so there
// is no npm dependency; swapping providers means editing only this file.
// Email is entirely optional: without RESEND_API_KEY the sender is null and
// every notification records email_status='skipped'.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export function createEmailSender(): EmailSender | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[todolist] email notifications disabled (no RESEND_API_KEY)');
    return null;
  }
  const from = process.env.TODOLIST_EMAIL_FROM ?? 'Todos <onboarding@resend.dev>';
  return {
    async send(msg: EmailMessage) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      });
      if (!res.ok) {
        throw new Error(`Resend API ${res.status}: ${await res.text()}`);
      }
    },
  };
}

// Deep links into the todo SPA; emails omit links when APP_BASE_URL is unset
// (job-generated emails have no request to infer a host from).
export function taskLink(taskId: number | null): string | null {
  const base = process.env.APP_BASE_URL;
  if (!base || !taskId) return null;
  return `${base.replace(/\/$/, '')}/todolist/task/${taskId}`;
}

export function listLink(listId: number | null): string | null {
  const base = process.env.APP_BASE_URL;
  if (!base || !listId) return null;
  return `${base.replace(/\/$/, '')}/todolist/list/${listId}`;
}
