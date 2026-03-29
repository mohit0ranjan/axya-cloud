# Render Keep-Alive With Cron-job.org

Use Cron-job.org to send a `GET` request to your Render backend every 5 minutes.

This guide is optimized for Render free tier uptime behavior.

## 1) Verify Health Endpoint

Your backend health URL should be:

- `https://<your-render-service>.onrender.com/health`

Expected response:

- HTTP `200`
- JSON with `status`, `uptime`, and `timestamp`
- No authentication required
- Very fast response (target under `200ms` after warm start)

Example response:

```json
{
  "status": "ok",
  "uptime": 12345,
  "timestamp": "2026-03-29T12:34:56.000Z"
}
```

## 2) Create Cron-job.org Account

1. Open `https://cron-job.org`.
2. Sign up or log in.

## 3) Create The Keep-Alive Job

1. Click `Create cronjob`.
2. Configure the job:
  - Title: `Axya Render Keep Alive`
  - URL: `https://<your-render-service>.onrender.com/health`
  - Request method: `GET`
  - Schedule: `Every 5 minutes`
  - Timeout: `30 seconds`
  - Retries: `2`
  - Retry delay: `30s` (or nearest available)
3. Save the cron job.

## 4) Reliability Rules (Production)

1. Keep `/health` outside auth middleware.
2. Exclude `/health` from global rate limiting.
3. Avoid DB checks, Telegram calls, or any heavy logic in `/health`.
4. Log every `/health` ping with:
  - request timestamp
  - response status
  - response time
5. Return HTTP `200` even for internal health handler exceptions (degraded payload), so cron does not amplify failures.

## 5) Confirm It Is Working

1. Trigger `Run now` once from Cron-job.org.
2. Confirm the run result is HTTP `200`.
3. Open Render logs and verify repeated `/health` requests every 5 minutes.
4. Confirm `/health` p95 response time is below `200ms` after warm-up.

## 6) Deployment Verification Steps

1. Deploy backend to Render.
2. Open in browser:
  - `https://<your-render-service>.onrender.com/health`
3. Verify:
  - Status code is `200`
  - Response has `status`, `uptime`, `timestamp`
4. Test with Postman:
  - Method: `GET`
  - URL: `https://<your-render-service>.onrender.com/health`
  - Expect `200` and JSON body
5. In Render logs, verify recurring `backend.health ping` entries every 5 minutes.
6. After 30-60 minutes, confirm there are no cold-start gaps between cron intervals.

## 7) Troubleshooting (Render + Cron-job.org)

1. Cron shows timeout on first run:
  - Cause: Render cold start delay.
  - Fix: keep timeout at `30s`, retries `2`, run again.

2. Cron shows 429 responses:
  - Cause: health endpoint rate-limited.
  - Fix: ensure `/health` is excluded from global rate limiting.

3. Cron shows 401/403 responses:
  - Cause: auth or middleware protecting `/health`.
  - Fix: keep `/health` public and before auth-only route guards.

4. Cron is green but app still cold sometimes:
  - Cause: free-tier platform restarts or deploy cycles.
  - Fix: this is expected on free tiers; verify cron frequency and endpoint stability.

5. No health logs in Render:
  - Cause: wrong URL or wrong service target.
  - Fix: verify cron URL exactly matches your Render service domain and `/health` path.

## 8) Production Notes

- Keep `/health` public and lightweight (no DB calls, no heavy logic).
- Do not require auth for `/health`.
- A 5-minute ping helps reduce cold starts on free tiers, but does not guarantee zero cold starts.
