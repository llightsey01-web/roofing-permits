# Local dev stability

Use these commands to keep the Next.js dev server running reliably during automation and visual test runs.

## Start the stable dev server

```bash
npm run dev:stable
```

This script:

- Validates required environment variables (via `npm run dev`) and prints warnings if any are missing
- Starts `npm run dev` on port 3000 (override with `PORT`)
- Polls `/api/health` every 10 seconds
- Restarts the server if it crashes or stops responding
- Refuses to start a duplicate if a healthy server is already running

For a one-off dev session without auto-restart, use:

```bash
npm run dev
```

## Health check

Verify the app is up:

```bash
npm run health
```

Expected output when healthy:

```json
{
  "ok": true,
  "service": "roofing-permits",
  "timestamp": "...",
  "env": "development"
}
```

Exit code `0` means healthy. Exit code `1` means the server is down or unresponsive.

You can also curl the endpoint directly:

```bash
curl http://127.0.0.1:3000/api/health
```

## Required environment variables

On startup, `npm run dev` (used by the stable wrapper) checks for:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

If any are missing, a warning is printed. Add them to `.env.local` in the project root.

## If port 3000 is stuck

Symptoms: `npm run dev:stable` reports the port is in use, or health checks fail while something still holds the port.

1. Find what is using the port:

   ```bash
   lsof -i :3000
   ```

2. Stop the process gracefully (replace `PID` with the process id from step 1):

   ```bash
   kill PID
   ```

3. If it does not exit within a few seconds:

   ```bash
   kill -9 PID
   ```

4. Confirm the port is free:

   ```bash
   lsof -i :3000
   ```

5. Start again:

   ```bash
   npm run dev:stable
   ```

## Stop old Node processes safely

Before killing processes, identify them so you do not stop unrelated work.

List Node processes tied to this project:

```bash
ps aux | grep -E 'next dev|start-dev-stable'
```

Stop the stable dev server with `Ctrl+C` in the terminal where it is running. That sends `SIGTERM` and shuts down the child `next dev` process.

If a stray dev server remains:

```bash
pkill -f "next dev"
```

Use `kill -9` only when a normal `kill` does not work.

## Useful environment overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Dev server port |
| `HEALTH_INTERVAL_MS` | `10000` | Health poll interval |
| `HEALTH_TIMEOUT_MS` | `5000` | Health request timeout |
| `HEALTH_MAX_FAILURES` | `3` | Failed checks before restart |
| `RESTART_DELAY_MS` | `2000` | Delay before restart after crash |
