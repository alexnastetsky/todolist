const API = '/todolist/api';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// When the Databricks OAuth session cookie expires, API fetches get a 302 to
// the login page on another origin — which fetch surfaces as an opaque
// failure. A full page navigation is allowed to follow that redirect and
// re-auth silently, so the fix is simply to reload once. The sessionStorage
// stamp keeps a genuinely broken session from reload-looping.
function reloadForFreshSession(): void {
  const KEY = 'todolist-auth-reload-at';
  const last = Number(sessionStorage.getItem(KEY) ?? 0);
  if (Date.now() - last > 60_000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      // Surface auth redirects as opaqueredirect instead of a CORS failure.
      redirect: 'manual',
      ...init,
    });
  } catch {
    // True network failure (offline, radio waking up) — retryable.
    throw new ApiError(0, 'Network hiccup — check your connection and retry.');
  }
  if (res.type === 'opaqueredirect' || res.status === 0) {
    reloadForFreshSession();
    throw new ApiError(401, 'Session expired — reloading…');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---- Types mirroring the server responses ----

export type Effort = '5m' | '20m' | '1h' | 'deep';
export type Energy = 'low' | 'medium' | 'high';
export type Role = 'owner' | 'edit' | 'complete' | 'view';
export type ShareLevel = 'view' | 'complete' | 'edit';

export interface Me {
  email: string;
  displayName: string | null;
  prefs: {
    email_assigned: boolean;
    email_shared: boolean;
    email_comment: boolean;
    email_completed: boolean;
    email_due_today: boolean;
    essential_only: boolean;
  };
  emailConfigured: boolean;
  unreadCount: number;
}

export interface ListSummary {
  id: number;
  owner_email: string;
  name: string;
  color: string | null;
  position: number;
  created_at: string;
  role: Role;
  open_count: number;
  done_count: number;
  share_count: number;
}

export interface Task {
  id: number;
  list_id: number;
  title: string;
  notes: string | null;
  status: 'open' | 'done' | 'archived';
  created_by: string;
  assigned_to: string | null;
  assigned_by: string | null;
  due_date: string | null;
  someday: boolean;
  starred: boolean;
  tags: string[];
  effort: Effort | null;
  energy: Energy | null;
  position: number;
  recur_kind: 'schedule' | 'after_done' | null;
  recur_interval: number | null;
  recur_unit: 'day' | 'week' | 'month' | null;
  recur_weekdays: number[] | null;
  recur_monthday: number | null;
  completed_at: string | null;
  completed_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // rollups / joins present on list views
  subtask_count?: number;
  subtask_done_count?: number;
  comment_count?: number;
  list_name?: string;
  pick_position?: number;
}

export interface Share {
  email: string;
  level: ShareLevel;
  display_name: string | null;
}

export interface ListDetail {
  list: { id: number; owner_email: string; name: string; color: string | null };
  role: Role;
  tasks: Task[];
  shares: Share[];
}

export interface Subtask {
  id: number;
  title: string;
  done: boolean;
  position: number;
}

export interface Comment {
  id: number;
  author_email: string;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface ActivityEntry {
  id?: number;
  list_id?: number;
  task_id: number | null;
  task_title?: string;
  actor_email: string;
  actor_name?: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  list_name?: string;
}

export interface Member {
  email: string;
  level: ShareLevel | 'owner';
  display_name: string | null;
}

export interface TaskDetailResponse {
  task: Task;
  role: Role;
  isAssignee: boolean;
  subtasks: Subtask[];
  comments: Comment[];
  activity: ActivityEntry[];
  members: Member[];
}

export interface TodayResponse {
  date: string;
  tomorrowDate: string;
  picks: Task[];
  tomorrowPicks: Task[];
  assignedToMe: Task[];
  dueToday: Task[];
  dueTomorrow: Task[];
  needsTriage: Task[];
  suggestions: Task[];
}

export type PlanDay = 'today' | 'tomorrow';

export interface Person {
  email: string;
  display_name: string | null;
}

export interface AiProposal {
  title: string;
  listId: number;
  dueDate?: string | null;
  someday?: boolean | null;
  starred?: boolean | null;
  tags?: string[] | null;
  effort?: Effort | null;
  energy?: Energy | null;
  assignedTo?: string | null;
  recurrence?: {
    kind: 'schedule' | 'after_done';
    interval: number;
    unit?: 'day' | 'week' | 'month' | null;
    weekdays?: number[] | null;
    monthday?: number | null;
  } | null;
  warnings?: string[] | null;
}

export interface Notification {
  id: number;
  type: 'assigned' | 'shared' | 'comment' | 'completed' | 'due_today';
  task_id: number | null;
  list_id: number | null;
  actor_email: string | null;
  actor_name: string | null;
  title: string;
  read_at: string | null;
  created_at: string;
}
