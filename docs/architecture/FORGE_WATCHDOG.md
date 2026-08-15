# Forge Watchdog — the jobs ledger never goes stale (build plan, 2026-08-15)

**The problem (Joe):** forge jobs (site provisions + revisions) can fail or silently stall, and
nothing notices. A routine must check the ledger of recent jobs, make sure they're being worked
on, and — when a job failed or was never picked up — re-engage the AI to continue the project.

**The ledger already exists** — `store_revisions` (status building/failed/…, error_msg,
updated_at, branch; provisions ride it with branch `__provision__`) drained by the single systemd
worker on the droplet (5s poll, one job at a time, global lock). Today's failure modes:
1. Worker dead (systemd/droplet down) → jobs sit `building` forever, nobody knows.
2. Job killed mid-run (OOM, reboot) → stuck `building`, no status write.
3. Job wrote `failed` → terminal; no retry, no AI re-engagement.
4. Deploy/preview polling hangs inside a job.

## Design (reuse-first: the ledger stays the source of truth)

### 1. Heartbeats (worker + job)
- `forge_heartbeats` table: one row per worker (`worker_id, beat_at`) touched every poll loop.
- While RUNNING a job, the worker also bumps `store_revisions.heartbeat_at` (new column) every
  60s. Distinguishes "being worked on" from "stuck" without guessing from `updated_at`.
- Schema: `store_revisions` + `heartbeat_at timestamptz`, `attempts int not null default 0`;
  new `forge_heartbeats`. platform-api schema copy synced; DATABASE_PLAN updated.

### 2. The watchdog routine (runs OFF the droplet — it must survive the droplet dying)
- A **Vercel cron on platform-api** (`/api/cron/forge-watchdog`, every 5 min, CRON_SECRET-gated).
  Logic, in order:
  1. **Stalled:** `building` AND `heartbeat_at` (or created_at) older than 15 min → mark
     `failed`, `error_msg='stalled: no heartbeat'`.
  2. **Retry:** `failed` AND `attempts < 3` → `attempts++`, reset to `building` — the worker
     picks it up again. This is the re-engagement (below).
  3. **Abandoned:** `failed` AND `attempts >= 3` → `abandoned` (new status), roll the store to a
     sane state (`draft`/`ready` per job kind), push-notify the admin + surface to the creator.
  4. **Worker down:** no fresh `forge_heartbeats` row AND queued jobs exist → admin push alert
     ("forge worker down — systemctl restart nanocrew-forge-worker"). (Auto-restart later via a
     droplet-local systemd watchdog timer; the cron can only alert.)

### 3. Re-engaging the AI to CONTINUE (not restart)
- The worker keeps persistent clones; a retried job runs in the SAME working branch. On retry the
  brief gains a `RETRY CONTEXT` block: previous `error_msg`, the failing step, and `git status`
  of the branch — the robot continues/repairs instead of starting over. Provision retries are
  already idempotent (repo/Vercel creates tolerate 409s).

### 4. Observability
- `GET /api/platform/forge-jobs` (admin-gated): last 50 jobs w/ status, attempts, timings.
- The brand console's site card shows "revision retrying (attempt 2/3)" instead of silence.

### Sequencing
1. Migration (columns + heartbeats table) + worker heartbeat writes + RETRY CONTEXT in the brief.
2. platform-api cron route + Vercel cron config + admin alerts (push route exists).
3. Console/admin surfacing. Docs: STOREFRONT_ENGINE + DATABASE_PLAN in the same changes.
