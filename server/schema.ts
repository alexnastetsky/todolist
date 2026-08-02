// Todolist schema — fully isolated from the world cup pool app: its own
// Postgres schema, every table fully qualified. Runs at startup, pool-style
// (CREATE IF NOT EXISTS + idempotent migrations appended over time).

export const SETUP_SQL = `
  CREATE SCHEMA IF NOT EXISTS todolist;

  -- Everyone who has ever hit the todo API. Drives assign/share autocomplete.
  CREATE TABLE IF NOT EXISTS todolist.users (
    email        TEXT PRIMARY KEY,
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS todolist.lists (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_email TEXT NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT,
    position    INT NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_tl_lists_owner ON todolist.lists(owner_email);

  CREATE TABLE IF NOT EXISTS todolist.list_shares (
    list_id    BIGINT NOT NULL REFERENCES todolist.lists(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    level      TEXT NOT NULL CHECK (level IN ('view','complete','edit')),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (list_id, email)
  );
  CREATE INDEX IF NOT EXISTS idx_tl_shares_email ON todolist.list_shares(email);

  CREATE TABLE IF NOT EXISTS todolist.tasks (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    list_id       BIGINT NOT NULL REFERENCES todolist.lists(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    notes         TEXT,
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','archived')),
    created_by    TEXT NOT NULL,
    assigned_to   TEXT,
    assigned_by   TEXT,
    -- A due date is a soft intention, never a deadline. The UI never renders
    -- "overdue" as red; past-dated open tasks surface in a triage bucket.
    due_date      DATE,
    someday       BOOLEAN NOT NULL DEFAULT FALSE,
    effort        TEXT CHECK (effort IN ('5m','20m','1h','deep')),
    energy        TEXT CHECK (energy IN ('low','medium','high')),
    position      INT NOT NULL DEFAULT 0,
    -- Recurrence: 'schedule' = fixed cadence (every N day/week/month, with
    -- optional weekday/monthday anchors); 'after_done' = N days after the last
    -- completion. A recurring task is a single row rolled forward on complete.
    recur_kind     TEXT CHECK (recur_kind IN ('schedule','after_done')),
    recur_interval INT,
    recur_unit     TEXT CHECK (recur_unit IN ('day','week','month')),
    recur_weekdays SMALLINT[],
    recur_monthday SMALLINT,
    completed_at   TIMESTAMPTZ,
    completed_by   TEXT,
    archived_at    TIMESTAMPTZ,
    -- Touched-at: any meaningful interaction bumps this; drives auto-archive.
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  -- Migration (July 2026): single-level priority flag. A star set by the
  -- assigner tells the assignee "this one first" — deliberately binary so it
  -- can't inflate the way P1/P2/P3 tiers do.
  ALTER TABLE todolist.tasks ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT FALSE;

  -- Migration (July 2026): free-form tags. Deliberately just strings on the
  -- task (no tags table, no colors) so labeling never becomes its own chore.
  ALTER TABLE todolist.tasks ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
  CREATE INDEX IF NOT EXISTS idx_tl_tasks_tags ON todolist.tasks USING GIN (tags);

  CREATE INDEX IF NOT EXISTS idx_tl_tasks_list     ON todolist.tasks(list_id) WHERE status <> 'archived';
  CREATE INDEX IF NOT EXISTS idx_tl_tasks_assignee ON todolist.tasks(assigned_to) WHERE status = 'open';
  CREATE INDEX IF NOT EXISTS idx_tl_tasks_due      ON todolist.tasks(due_date) WHERE status = 'open';
  CREATE INDEX IF NOT EXISTS idx_tl_tasks_stale    ON todolist.tasks(last_activity_at) WHERE status = 'open';

  -- Personal daily plan. Picking a task into "Today" is per-user metadata so
  -- it never mutates a shared task, and it resets daily by definition
  -- (queries always filter pick_date = today).
  CREATE TABLE IF NOT EXISTS todolist.today_picks (
    email     TEXT NOT NULL,
    task_id   BIGINT NOT NULL REFERENCES todolist.tasks(id) ON DELETE CASCADE,
    pick_date DATE NOT NULL,
    position  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (email, task_id, pick_date)
  );

  CREATE TABLE IF NOT EXISTS todolist.subtasks (
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id  BIGINT NOT NULL REFERENCES todolist.tasks(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    done     BOOLEAN NOT NULL DEFAULT FALSE,
    position INT NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tl_subtasks_task ON todolist.subtasks(task_id);

  CREATE TABLE IF NOT EXISTS todolist.comments (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id      BIGINT NOT NULL REFERENCES todolist.tasks(id) ON DELETE CASCADE,
    author_email TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_tl_comments_task ON todolist.comments(task_id);

  -- Accomplishment/activity log. task_title is denormalized so history
  -- survives task deletion; task_id nulls out but the record remains.
  CREATE TABLE IF NOT EXISTS todolist.activity (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    list_id     BIGINT NOT NULL,
    task_id     BIGINT REFERENCES todolist.tasks(id) ON DELETE SET NULL,
    task_title  TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN
      ('created','completed','reopened','assigned','commented','archived','restored','due_changed','shared','recurred')),
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_tl_activity_list  ON todolist.activity(list_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tl_activity_actor ON todolist.activity(actor_email, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tl_activity_done  ON todolist.activity(created_at DESC) WHERE action = 'completed';

  CREATE TABLE IF NOT EXISTS todolist.notifications (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_email TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('assigned','shared','comment','completed','due_today')),
    task_id         BIGINT,
    list_id         BIGINT,
    actor_email     TEXT,
    title           TEXT NOT NULL,
    dedupe_key      TEXT,
    read_at         TIMESTAMPTZ,
    email_status    TEXT NOT NULL DEFAULT 'skipped' CHECK (email_status IN ('skipped','sent','failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_tl_notif_dedupe
    ON todolist.notifications(recipient_email, dedupe_key) WHERE dedupe_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_tl_notif_recipient ON todolist.notifications(recipient_email, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tl_notif_unread    ON todolist.notifications(recipient_email) WHERE read_at IS NULL;

  -- In-app notifications are always on; email is ON by default, opt-out per
  -- event type (no row = all enabled).
  CREATE TABLE IF NOT EXISTS todolist.notification_prefs (
    email           TEXT PRIMARY KEY,
    email_assigned  BOOLEAN NOT NULL DEFAULT TRUE,
    email_shared    BOOLEAN NOT NULL DEFAULT TRUE,
    email_comment   BOOLEAN NOT NULL DEFAULT TRUE,
    email_completed BOOLEAN NOT NULL DEFAULT TRUE,
    email_due_today BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Migration (July 2026): email prefs switched from opt-in to opt-out.
  ALTER TABLE todolist.notification_prefs ALTER COLUMN email_assigned  SET DEFAULT TRUE;
  ALTER TABLE todolist.notification_prefs ALTER COLUMN email_shared    SET DEFAULT TRUE;
  ALTER TABLE todolist.notification_prefs ALTER COLUMN email_comment   SET DEFAULT TRUE;
  ALTER TABLE todolist.notification_prefs ALTER COLUMN email_completed SET DEFAULT TRUE;
  ALTER TABLE todolist.notification_prefs ALTER COLUMN email_due_today SET DEFAULT TRUE;

  -- Essential-only mode (default ON): task notifications fire only when
  -- someone else completed a task you created, or someone else created a
  -- task assigned to you. Applies to bell AND email; per-type email switches
  -- above still gate email for events that pass.
  ALTER TABLE todolist.notification_prefs ADD COLUMN IF NOT EXISTS essential_only BOOLEAN NOT NULL DEFAULT TRUE;

  -- One-shot migration bookkeeping.
  CREATE TABLE IF NOT EXISTS todolist.app_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Written once per boot, as the last step of schema setup. A stale row means
  -- this module could not reach its schema — which is invisible otherwise,
  -- because the app still serves HTTP and starts "successfully". Each module
  -- writes into its OWN schema on purpose: grants are per-schema, so one
  -- combined heartbeat could go green while the other schema was unreachable.
  CREATE TABLE IF NOT EXISTS todolist.app_heartbeat (
    id INT PRIMARY KEY CHECK (id = 1),
    beat_at TIMESTAMPTZ NOT NULL,
    service_principal TEXT
  );
`;

// Runs after SETUP_SQL; each entry executes exactly once per database (the
// app_meta marker gates it), so future user choices are never clobbered.
export const ONE_SHOT_MIGRATIONS: { key: string; sql: string }[] = [
  {
    // Pre-existing prefs rows were created as all-false by display-name saves
    // under the old opt-in scheme, not by deliberate opt-outs — flip them to
    // the new opt-out default.
    key: 'email_prefs_default_true',
    sql: `UPDATE todolist.notification_prefs SET
            email_assigned = TRUE, email_shared = TRUE, email_comment = TRUE,
            email_completed = TRUE, email_due_today = TRUE, updated_at = NOW()`,
  },
];
