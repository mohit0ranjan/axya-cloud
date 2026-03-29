# Render + UptimeRobot (Free Plan) Setup

Use this to keep a free Render web service warm as much as possible.

## Why This Is Needed

- Free Render services can sleep after inactivity.
- App-side keep-alive only works while the app is foregrounded.
- UptimeRobot runs independently 24/7 and is the most reliable free option.

## Prerequisites

- Your backend has a fast health route, for example:
  - `https://<your-render-service>.onrender.com/health`
- This route should return `200` quickly and not require auth.

## UptimeRobot Setup

1. Create/sign in to UptimeRobot.
2. Click `Add New Monitor`.
3. Configure:
   - Monitor Type: `HTTP(s)`
   - Friendly Name: `Axya Render API`
   - URL: `https://<your-render-service>.onrender.com/health`
   - Monitoring Interval: `5 minutes`
   - Timeout: `30 seconds`
4. Save monitor.

## Recommended Alerting

1. Add one email channel.
2. Add one optional Telegram/Slack channel.
3. Trigger alert after 2 failed checks to reduce noise.

## Validation Checklist

1. Open monitor details and confirm first check is `Up`.
2. Confirm endpoint returns JSON and `200`.
3. Check Render logs to see periodic `/health` hits.
4. Verify no auth/rate-limit blocks this route.

## Notes

- This improves warm availability but does not guarantee zero cold starts.
- If Render policy changes, external pings may become less effective.
- Keep your app's existing `useServerKeepAlive` as a secondary helper while users are active.
