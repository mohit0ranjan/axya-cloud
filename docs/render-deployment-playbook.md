# Render Deployment Playbook

This setup covers:
- automatic deploy on GitHub push
- health check wiring
- request/error logging visibility
- free-tier keep-alive

## 1) Prerequisites

- GitHub repo connected to Render
- Neon/Postgres `DATABASE_URL`
- Telegram API/session credentials
- Secrets configured in Render for the backend service

## 2) Blueprint deploy

Use the root [render.yaml](../render.yaml) blueprint.

It creates:
- `axya-server` (Node + Express backend)
- `axya-web` (Next.js web app)

Both services have `autoDeploy: true`, so new commits to the connected branch trigger deployment automatically.

## 3) Backend health and logs

- Health endpoint: `/health`
- Deep check (optional): `/health?deep=1`
- Request tracing: `x-request-id` header is returned in responses and added to logs

Expected `GET /health` response fields:
- `status`
- `uptime`
- `timestamp`
- `request_id`
- `checks.schema`
- `checks.db`
- `checks.telegramWarmup`

## 4) Keep-alive to reduce free-tier sleep

Use either:
- Cron-job.org
- UptimeRobot

Target:
- `https://axya-server.onrender.com/health`

Recommended schedule:
- every 5 minutes
- timeout 30 seconds
- retries 2

If using UptimeRobot:
- monitor type: HTTP(s)
- method: GET
- interval: 5 minutes
- URL: backend `/health`

## 5) GitHub auto deploy behavior

Render redeploys on push to configured branch automatically when:
- service is connected to GitHub
- `autoDeploy` is enabled (already true in blueprint)

Recommended policy:
- protect `main`
- merge only after CI build passes (`server` + `web`)

## 6) Post-deploy verification checklist

1. Open backend `/health`
2. Open backend `/health?deep=1`
3. Open web shared page and verify:
   - unlock flow
   - item listing
   - preview ticket + preview
   - download-all flow
4. Inspect Render logs for request/error entries with `requestId`
5. Confirm keep-alive pings every 5 minutes

## 7) Rollback plan

If latest deploy is unhealthy:
1. Use Render dashboard to rollback to previous deploy
2. Keep keep-alive monitor enabled
3. Compare failing deploy logs by `requestId`
4. Re-deploy after fix
