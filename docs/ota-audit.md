# OTA Audit (Expo Updates)

## Current Status
- `app/app.json` has `updates.enabled=true` and valid EAS update URL.
- `runtimeVersion.policy = "appVersion"` is enabled.
- Build channels are configured in `app/eas.json` (`development`, `preview`, `production`).
- `expo-updates` dependency is present.

## Fix Applied
- OTA check now runs:
  - once on app launch
  - again when app returns from background (throttled to once every 15 minutes)
- Added OTA diagnostics logs for:
  - `Updates.channel`
  - `Updates.runtimeVersion`
  - `Updates.updateId`
  - disabled OTA builds
- Kept update-loop guard using last reloaded update id.

## Important Operational Notes
- OTA updates do **not** apply to `developmentClient` builds in normal dev workflows.
- Publish OTA to the same channel as installed binary:
  - production build -> `eas update --channel production`
  - preview build -> `eas update --channel preview`
- With `runtimeVersion: appVersion`, OTA updates only apply to binaries with matching `expo.version` in `app/app.json`.
