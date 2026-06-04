# DART iQ Monitoring & Alerting

Centralized detection of automation failures, stuck jobs, and stale workers.

## Components

| Module | Role |
|--------|------|
| `alert-service.js` | `sendAlert()` — console (always), Supabase `system_alerts`, email/SMS stubs |
| `job-monitor.js` | Stuck jobs, failed runs, worker staleness queries + optional alert dispatch |
| `worker-heartbeat.js` | Workers record `last_poll_at` on each poll cycle |

## Alert severities & types

**Severity:** `critical` | `warning` | `info`

**Type:** `automation_failed` | `login_failed` | `integration_failed` | `worker_crashed` | `stuck_job` | `worker_stale`

## Thresholds

| Check | Threshold |
|-------|-----------|
| Stuck jobs | `job_status = automation_running` for > 2 hours |
| Failed runs | `run_status = error` in last 1 hour |
| Stale workers | No poll heartbeat in 10 minutes |

## HTTP health endpoint

`GET /api/internal/health`

```json
{
  "status": "ok",
  "workers": { "permit": true, "nocProof": true, "ops": true },
  "database": true,
  "lastRunAt": "2026-06-03T12:00:00.000Z",
  "stuckJobs": 0,
  "failedRunsLastHour": 0
}
```

- `ok` — database up, no stuck jobs / recent failures / stale workers
- `degraded` — database up but one or more checks failed
- `down` — database unreachable

Configure Railway health checks to hit this URL.

## Database tables (run in Supabase)

```sql
create table if not exists system_alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null,
  job_id uuid references jobs(id),
  company_id uuid references companies(id),
  message text not null,
  details jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists system_alerts_created_at_idx on system_alerts (created_at desc);

create table if not exists worker_heartbeats (
  worker_name text primary key,
  last_poll_at timestamptz not null,
  metadata jsonb default '{}'
);
```

Alerts and heartbeats degrade gracefully if tables are missing (console logging still works).

## Worker integration

- **Permit worker** (`worker/index.js`) — heartbeat `permit`, critical alert when `attempts >= 3` on failed run
- **NOC/Proof worker** (`worker/noc-proof-erecord-worker.js`) — heartbeat `nocProof`, same attempt threshold

## Notification channels (future)

| Channel | Env vars | Status |
|---------|----------|--------|
| Console | — | Active |
| Supabase | service role | Active when table exists |
| Email | `RESEND_API_KEY` / `SENDGRID_API_KEY`, `ALERT_EMAIL_TO` | Stub |
| SMS | `TWILIO_*` | Stub (A2P pending) |

## Scheduled monitoring

Call from a cron or ops worker:

```javascript
const { runScheduledMonitors } = require('./lib/monitoring/job-monitor')
await runScheduledMonitors() // runs checks and sends alerts
```
