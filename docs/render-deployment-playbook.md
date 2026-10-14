# Axya on Render — deployment and recovery

This is prepared configuration, not evidence of a deployed release. The root `render.yaml` selects Free backend/web services for testing. `render.paid.yaml` preserves the paid Starter services and 10 GB upload staging disk proposal for a later durable deployment. Select only one Blueprint for the same services; do not provision duplicates.

## Deploy using Free instances

In Render, select the repository branch `axya/reliability-and-ui` and Blueprint path `render.yaml`. Preview must show two Free web services, no disk and no pre-deploy command. Enter the required secrets listed below, retaining the existing Neon database and original session encryption key. If resources already exist, inspect the proposed changes before applying; removing an existing disk would discard staging data. Do not change a paid deployment with active uploads to this profile.

The Docker image's default start command runs the API. Its existing startup path initializes the database schema and retries database initialization; `/readyz` stays unavailable until initialization succeeds. Free instances do not support Render's paid pre-deploy step, so the existing encrypted-session compatibility scan is not run by this profile. The exact original session encryption key remains required. Web configuration and APK endpoint checks below still apply.

Free instances sleep after 15 minutes without inbound traffic; waking takes about a minute. Sleep, restart and redeploy discard local upload chunks and caches. Completed Telegram originals and metadata in the external Neon database are separate from this local filesystem. An incomplete upload may need its original file resent; do not promise that it can resume after server filesystem loss. A successful readiness check proves directory access, not durable storage. The configured file/staging limits are application caps, not guaranteed Free-instance capacity; begin with small files and batches.

Both services share 750 Free instance hours per workspace per month. Bandwidth/build limits and unusually high service-initiated external traffic can also block service or builds. A Telegram relay can be affected by this traffic restriction. Monitor Render usage; do not use keep-alive pings to claim always-on reliability. Keep the existing Neon database: Free Render Postgres expires after 30 days. See [Render Free instance limits](https://render.com/docs/free) and [paid pre-deploy availability](https://render.com/docs/deploys).

Use this profile for a test deployment. Persistent staging or an implemented durable external staging provider is needed before claiming upload recovery across server replacement. Upgrading only the Render workspace/account does not change the compute instance limits.

## Confirmed architecture

The deployed backend origin is `https://axya-cloud-zxjk.onrender.com`. On 13 October 2026, read-only checks returned HTTP 200 for `/health` and `/readyz`, with database readiness confirmed. The root returns the API's JSON identity; a diagnostic `/s/` route returns the API's JSON 404. This deployment hosts the backend only. Live authenticated uploads and downloads have not been verified by these health checks.

The deployed Next.js web/sharing origin is `https://axya-web-ih1c.onrender.com`. On 14 October 2026, read-only checks returned HTTP 200 HTML for the home, diagnostic share and request page routes, HTTP 200 database readiness through `/backend/readyz`, and HTTP 404 for the production-only hidden diagnostic `/test/upload`. The diagnostic slugs are not real share grants; these checks do not verify passwords, file downloads or uploads. App share defaults, release profiles, native domain configuration and deployment templates use this web origin. Existing local development `.env` files remain local.

In the existing backend Render Environment set `SERVER_BASE_URL=https://axya-cloud-zxjk.onrender.com`, `FRONTEND_BASE_URL=https://axya-web-ih1c.onrender.com` and `ALLOWED_ORIGINS=https://axya-web-ih1c.onrender.com`. Optional `SHARE_PUBLIC_BASE_URL` can use the same web origin; `WEB_PUBLIC_BASE_URL` is unused. Preserve all existing secrets, especially session encryption and share-v2 pepper. In web Environment use the values in `web/.env.production.example` and Node 24, then rebuild. Committed templates do not update a manually created Render service's environment automatically. Install a rebuilt APK to receive updated native domain configuration; verified app-link opening also requires web association files and the signed release identity, not just the manifest host.

The 14 October read-only CORS preflight using `Origin: https://axya-web-ih1c.onrender.com` returned HTTP 403 from the deployed API. Apply the actual frontend/origin values above and redeploy, then repeat the preflight. Passing the health/proxy smoke checks does not mean browser-origin requests are authorized.

The backend was created manually in Render. Do not import a Blueprint as a second backend: its proposed service name may differ from the existing service. Set `SERVER_BASE_URL=https://axya-cloud-zxjk.onrender.com` in the existing Render service's Environment settings; changes to a committed template do not update those dashboard values. For manual deployment with an empty Root Directory, use Dockerfile Path `./server/Dockerfile` and Docker Build Context `./server`.

| Component | Runs on | Role |
| --- | --- | --- |
| Axya Android app | User's phone, installed APK | Current Expo UI, native background transfers and previews |
| axya-server | Render Docker web service | Authentication, Telegram transfers, metadata API and media streaming |
| axya-web | Render Node web service | Next.js sharing/request pages and existing browser dashboard |
| PostgreSQL metadata | Existing Neon database | Users, folders, file pointers, durable jobs and access policies |
| File storage | Users' Telegram accounts | Completed original files |

The Android app is built separately with EAS; it is not installed or executed on Render. This configuration does not add an Expo static website or change the phone UI.

## Why persistent storage is required

Upload sessions are stored in Neon; acknowledged chunks are stored under UPLOAD_STORAGE_DIR. Both must survive restart for durable recovery. The paid profile configures /data/uploads on a persistent disk. Free Render instances have an ephemeral filesystem and cannot preserve those chunks across redeploys. Keep-alive pings do not replace a durable disk. Render disks permit one service instance; do not enable multiple API instances with this design.

Official references: [disks](https://render.com/docs/disks), [free instances](https://render.com/docs/free), [Blueprint specification](https://render.com/docs/blueprint-spec).

## Existing services

Use the existing axya-server and axya-web services if you own them. Verify actual public URLs first. Do not create duplicate services or change an existing service region blindly. The proposed Ohio region matches the current Neon US East 2 metadata location for a new deployment. Existing service regions cannot be changed in place.

API: Dockerfile server/Dockerfile with build context server. Web: root directory web, build npm ci && npm run build, start npm run start. The web start script uses Render's PORT. Auto deployment follows passing repository CI checks. Connect the correct reviewed Git branch; local uncommitted changes are not deployed by Render.

For an existing paid backend, set the pre-deploy command to `node scripts/predeploy.cjs` and health check to `/readyz`. Do not set `maxShutdownDelaySeconds`: Render rejects a custom shutdown delay for services with a persistent disk. The application retains its bounded 25-second shutdown handler and durable upload recovery when staging is persistent. Leave the Docker start command unset so the image's CMD runs. Keep one backend instance. The old Azure workflow is now manual so a future Git push cannot automatically deploy to two providers.

The pre-deploy command validates production configuration and verifies that every currently encrypted Telegram session can be opened with the supplied key before running the existing transactional, advisory-locked schema migration. It does not re-encrypt sessions or touch disk files. Render runs pre-deploy commands in a separate instance without the persistent disk, so staging permissions are checked by `/readyz` at runtime. See [Render deploy steps](https://render.com/docs/deploys).

`/readyz` returns 200 only when the schema, database, Telegram API configuration and staging directory are ready; it returns 503 during startup, dependency failure or shutdown. This is not a live Telegram login or file-integrity test. `/health` remains a 200 liveness endpoint for the existing app's server wake checks.

## Required secrets — enter through Render environment settings

- DATABASE_URL: Neon connection, entered securely.
- SESSION_ENCRYPTION_KEY: preserve the EXACT existing key used to encrypt database Telegram sessions. A new key cannot decrypt existing sessions. Back it up securely; never commit it.
- TELEGRAM_API_ID and TELEGRAM_API_HASH: existing application credentials.
- JWT_SECRET and COOKIE_SECRET: stable random secrets; Blueprint generates them only if missing. Rotating them invalidates authentication sessions.
- SHARE_V2_SESSION_SECRET, SHARE_V2_TICKET_SECRET and SHARE_V2_LINK_PEPPER: all three are required even when web is not yet deployed. For a first deployment generate separate random 32-byte secrets (64 hex characters each). Manual services must receive them in Render Environment settings; Blueprints generate them for new services. Preserve existing values when moving an established deployment. Changing LINK_PEPPER invalidates existing share-link secret hashes; session/ticket key changes invalidate their issued tokens. For links previously created in development without an explicit pepper, the hashing fallback was that environment's JWT_SECRET, so switching to a new pepper requires recreating those links or a planned migration.
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

The current EAS owner is `mohit0344`, project `@mohit0344/axya`, ID `c468dc65-fd62-4c5b-859b-447ada0f9502`. The app's OTA update URL uses this same project ID. The former owner's project is no longer referenced by the runtime app configuration. Release signing credentials are configured in the new account; the certificate was preserved so this release can update an APK signed with the existing key. Private signing backups and `credentials.json` are ignored by Git and must never be committed.

```sh
npx eas-cli build --platform android --profile production-apk
```

This produces an APK using EAS cloud builds; local Android Studio is not required for that build path. Install and test the signed APK on a physical phone before distribution. The `production` profile is separate for the store release artifact.

## Rollback

Keep previous APK/server builds and database backups. Roll back application code while retaining the disk and compatible schema; never discard staged bytes to make a deployment healthy. Render disk-backed deploys have an instance handover interruption; clients must retry/resume. Check recovery after rollback before reopening uploads.
