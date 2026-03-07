# Deployment QA Plan (Authenticated + Device)

## Environment
- Backend built from current branch (`server`: `npm.cmd run build` succeeded).
- Use Node `20.x` (`.nvmrc` added in repo root and `server/`).
- Production env must include `COOKIE_SECRET` and required values from `server/.env.example`.

## 1) Upload Flow: init/chunk/complete
- Authenticate user on mobile and web.
- Upload small (1-5 MB), medium (20-100 MB), and near-limit file.
- Verify:
  - init returns upload session.
  - all chunks accepted in order and out-of-order retry.
  - complete marks file available in listing and preview.
  - interrupted upload resumes or fails with clear error.

## 2) Preview Flow: image/video/document
- Open image preview and zoom.
- Open video preview and seek at 0%, 50%, 90%.
- Open document preview/download (PDF and text file).
- Verify:
  - No 500 responses.
  - MIME mapping correct.
  - Playback/preview controls visible and tappable on physical devices.

## 3) Folder CRUD + move + delete
- Create nested folders.
- Rename folder.
- Move files between folders.
- Soft delete then restore/permanent delete where supported.
- Verify:
  - Breadcrumb/path consistency.
  - Counts/sizes refresh correctly.
  - No orphan UI rows after delete/move.

## 4) Share Creation + Open on Web/Mobile
- Create file share and folder share (with/without password).
- Open link in desktop browser and mobile browser/app.
- Negative checks:
  - invalid share UUID returns `400`.
  - unknown share UUID returns `404`.
  - invalid password returns `401`.
- Verify:
  - password-protected share requires verification.
  - non-password share returns access token/session.
  - file download respects `allow_download` and `view_only`.

## 5) Telegram OTP Login + upload/download path
- Fresh login using OTP.
- Upload file to Telegram-backed storage.
- Download same file via app and share/public path.
- Verify:
  - session persists across app restart.
  - OTP failures are rate-limited with correct message.
  - upload/download complete without Telegram session errors.

## 6) Mobile UI Regression (Physical Device)
- Test on at least one Android and one iOS device if available.
- Validate touch targets:
  - upload button
  - share actions
  - folder actions (create/move/delete)
  - playback/preview controls
- Verify:
  - no clipped buttons, no overlap, no blocked modals.
  - orientation change does not break layouts.
  - long filenames still render usable actions.
