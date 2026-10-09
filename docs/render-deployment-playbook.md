# Axya on Render — deployment and recovery

This is prepared configuration, not evidence of a deployed release. The root render.yaml proposes paid Starter backend/web services and a 10 GB upload staging disk. Review the plans and cost in Render before provisioning.

## Confirmed architecture

| Component | Runs on | Role |
| --- | --- | --- |
| Axya Android app | User's phone, installed APK | Current Expo UI, native background transfers and previews |
| axya-server | Render Docker web service | Authentication, Telegram transfers, metadata API and media streaming |
| axya-web | Render Node web service | Next.js sharing/request pages and existing browser dashboard |
| PostgreSQL metadata | Existing Neon database | Users, folders, file pointers, durable jobs and access policies |
| File storage | Users' Telegram accounts | Completed original files |

The Android app is built separately with EAS; it is not installed or executed on Render. This configuration does not add an Expo static website or change the phone UI.

## Why persistent storage is required

Upload sessions are stored in Neon; acknowledged chunks are stored under UPLOAD_STORAGE_DIR. Both must survive restart. Configure /data/uploads on a persistent disk. Free Render instances have an ephemeral filesystem and cannot preserve those chunks across redeploys. Keep-alive pings do not replace a durable disk. Render disks permit one service instance; do not enable multiple API instances with this design.

Official references: [disks](https://render.com/docs/disks), [free instances](https://render.com/docs/free), [Blueprint specification](https://render.com/docs/blueprint-spec).

## Existing services

Use the existing axya-server and axya-web services if you own them. Verify actual public URLs first. Do not create duplicate services or change an existing service region blindly. The proposed Ohio region matches the current Neon US East 2 metadata location for a new deployment. Existing service regions cannot be changed in place.

API: Dockerfile server/Dockerfile with build context server. Web: root directory web, build npm ci && npm run build, start npm run start. The web start script uses Render's PORT. Auto deployment follows passing repository CI checks. Connect the correct reviewed Git branch; local uncommitted changes are not deployed by Render.

For an existing backend, set the pre-deploy command to `node scripts/predeploy.cjs`, health check to `/readyz`, and shutdown delay to 60 seconds. Leave the Docker start command unset so the image's CMD runs. Keep one backend instance. The old Azure workflow is now manual so a future Git push cannot automatically deploy to two providers.

The pre-deploy command validates production configuration and verifies that every currently encrypted Telegram session can be opened with the supplied key before running the existing transactional, advisory-locked schema migration. It does not re-encrypt sessions or touch disk files. Render runs pre-deploy commands in a separate instance without the persistent disk, so staging permissions are checked by `/readyz` at runtime. See [Render deploy steps](https://render.com/docs/deploys).

`/readyz` returns 200 only when the schema, database, Telegram API configuration and staging directory are ready; it returns 503 during startup, dependency failure or shutdown. This is not a live Telegram login or file-integrity test. `/health` remains a 200 liveness endpoint for the existing app's server wake checks.

## Required secrets — enter through Render environment settings

- DATABASE_URL: Neon connection, entered securely.
- SESSION_ENCRYPTION_KEY: preserve the EXACT existing key used to encrypt database Telegram sessions. A new key cannot decrypt existing sessions. Back it up securely; never commit it.
- TELEGRAM_API_ID and TELEGRAM_API_HASH: existing application credentials.
- JWT_SECRET and COOKIE_SECRET: stable random secrets; Blueprint generates them only if missing. Rotating them invalidates authentication sessions.
- Optional share signing secrets: preserve existing SHARE_LINK_SECRET, SHARE_ACCESS_SECRET, SPACE_ACCESS_SECRET and SIGNED_DOWNLOAD_SECRET if configured.

Each user signs into their own Telegram account. A global TELEGRAM_SESSION is not required for this per-user model. Do not put user Telegram sessions into client bundles.

Set NODE_ENV=production, STORAGE_PROVIDER=telegram, UPLOAD_STORAGE_DIR=/data/uploads. Check ALLOWED_ORIGINS, SERVER_BASE_URL, FRONTEND_BASE_URL, web AXYA_API_URL, and the Android EAS API/share URLs agree with actual deployed domains. The proposed disk supports a 6 GB temporary staging budget and a 1 GB individual file limit; neither is an unlimited Telegram workaround.

Use `server/.env.production.example` for variable names only. Enter values into Render, not into the committed template. Production secrets must be stable, non-placeholder values; JWT_SECRET and COOKIE_SECRET must each be at least 32 characters. Missing or unsafe configuration stops startup rather than falling back silently.

Web needs `AXYA_API_URL=https://YOUR-API-ORIGIN` at BUILD time and `NEXT_PUBLIC_API_URL=/backend`. Keep `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_BASE_URL` on the actual web origin. The same-origin `/backend` proxy preserves browser cookie authentication. Rebuild web when the API origin changes. The diagnostic `/test/upload` page returns 404 in production.

Update all `app/eas.json` release profiles if the actual API or share domain differs from the proposed names. `EXPO_PUBLIC_API_URL` points to the API and `EXPO_PUBLIC_SHARE_BASE_URL` points to the Next.js web service; these public endpoint URLs contain no secrets. Confirm Android app-link hosts in `app/app.json` match the final share domain before generating the release APK. Render can assign a different subdomain if the proposed name is unavailable; do not distribute an APK with assumed domains.

## Verify deployment before releasing the APK

1. Back up Neon metadata and the encryption key. Restore into an isolated database and prove it can read the encrypted test session without touching production files.
2. Deploy backend, check `/readyz` returns 200, `/health` has readyForUploads=true and `/health?deep=1` reports db=ok. A liveness 200 response alone is insufficient.
3. Stage one chunk of a diagnostic file, restart/redeploy the backend, resume the remaining chunks, and compare the final downloaded SHA-256.
4. Deploy web, upload via a password-protected request link, verify the destination folder, download/ZIP byte integrity, and immediate revocation.
5. Test Android login, native uploads with screen off/process eviction/reboot, Wi-Fi/charging restrictions, scanner, gallery permission revocation, share-to-Axya and PDF preview on physical devices. Android force-stop stops scheduled jobs until the user reopens the app.
6. Verify mixed-size 50-file batches on real mobile internet, cancellation, insufficient disk, Telegram flood waits and expired Telegram sessions. The completed local 50-photo test used small generated photos and is not a phone bandwidth benchmark.
7. Resolve/review the Expo dependency audit before production sign-off. Do not force an incompatible Expo/RN downgrade just to silence audit output.

After backend and web are live, run the read-only smoke check from the repository root:

```sh
npm run deploy:smoke -- --api https://YOUR-API-ORIGIN --web https://YOUR-WEB-ORIGIN
```

It checks API readiness, web HTML, the web-to-API proxy and the hidden production diagnostic route. It exits nonzero when a check fails and does not log in or modify data. Passing it is not a substitute for the upload/restart/download-integrity and device tests above.

Once production checks pass, build the phone install artifact from `app`:

```sh
npx eas-cli build --platform android --profile production-apk
```

This produces an APK using EAS cloud builds; local Android Studio is not required for that build path. Install and test the signed APK on a physical phone before distribution. The `production` profile is separate for the store release artifact.

## Rollback

Keep previous APK/server builds and database backups. Roll back application code while retaining the disk and compatible schema; never discard staged bytes to make a deployment healthy. Render disk-backed deploys have an instance handover interruption; clients must retry/resume. Check recovery after rollback before reopening uploads.
