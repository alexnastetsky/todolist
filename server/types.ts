import { Application } from 'express';
import type { EmailSender } from './email';

// Minimal AppKit surface the todolist module needs. Deliberately declared
// here (not imported from the pool code) so this module has zero coupling to
// the world cup app and can be lifted into its own app later.
export interface TodoAppKit {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

export type Role = 'owner' | 'edit' | 'complete' | 'view' | 'none';

export type NotificationType = 'assigned' | 'shared' | 'comment' | 'completed' | 'due_today';

// Shared dependencies threaded through every route registrar.
export interface TodoContext {
  appkit: TodoAppKit;
  emailSender: EmailSender | null;
}
