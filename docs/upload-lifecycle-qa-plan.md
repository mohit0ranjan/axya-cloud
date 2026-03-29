# Upload Lifecycle QA Plan (Deterministic)

## Scope
This plan validates upload lifecycle reliability end-to-end for:
- backend upload API contract: init, chunk, complete, status, cancel
- app-side queue behavior: progress, pause/resume, cancel, retry, notification controls
- known limitations called out explicitly so QA can separate expected constraints from regressions

## Preconditions
- Backend is running and reachable.
- App build is installed on at least one Android device and one iOS device.
- Test account has a valid Telegram session.
- Network tools are available to simulate offline/online transitions.
- Upload manager screen is available from overlay and app navigation.

## Backend Integration Harness
Script: server/tests/upload-lifecycle.integration.mjs

### Required environment
- UPLOAD_TEST_BEARER_TOKEN: authenticated bearer token for the test user.

### Optional environment
- UPLOAD_TEST_BASE_URL (default: http://localhost:3000)
- UPLOAD_TEST_REQUEST_TIMEOUT_MS (default: 15000)
- UPLOAD_TEST_POLL_INTERVAL_MS (default: 1500)
- UPLOAD_TEST_COMPLETE_TIMEOUT_MS (default: 300000)
- UPLOAD_TEST_SKIP_COMPLETE=1 to skip finalization stage

### Command
From server folder:

```bash
npm run test:integration:upload
```

### Expected automated coverage
- init creates a valid uploadId
- chunk accepts ordered uploads and rejects out-of-order index with 409 and expectedChunk
- status returns nextExpectedChunk and byte counters
- resume path continues from nextExpectedChunk and reaches completion
- complete transitions to terminal completed state
- cancel transitions to cancelled state or cleaned terminal equivalent

## App-Side Deterministic QA Cases

## 1) Queue-State Synchronization
1. Start 3 uploads from different screens (home, folder view, file picker batch).
2. Open upload overlay and upload manager screen.
3. Verify all uploads show identical state in both views.
4. Relaunch app while uploads are in progress and verify restored queue state.
Expected:
- No missing tasks.
- Progress values are monotonic and synchronized between overlay and manager.
- Terminal tasks remain visible until user clears history.

## 2) Pause and Resume Determinism
1. Start one medium upload.
2. Pause from overlay.
3. Confirm state in upload manager updates to paused.
4. Resume from upload manager.
Expected:
- Same task id resumes, no duplicate task is created.
- Upload continues from next expected chunk and eventually completes.

## 3) Cancel Behavior
1. Start an upload.
2. Cancel from notification action.
3. Confirm manager shows cancelled state.
4. Confirm cancelled upload does not continue after app foreground/background transitions.
Expected:
- Cancel is final for that task unless user starts a new upload.
- No hidden in-flight chunk activity after cancel.

## 4) Retry After Transient Failure
1. Start upload on stable network.
2. Toggle network off mid-upload.
3. Wait for retry state.
4. Restore network.
5. Trigger resume/retry.
Expected:
- Task transitions to retry or paused-retry state without corruption.
- Resume uses server cursor and does not restart from chunk 0 unless session is invalid.

## 5) Notification Control Wiring
1. Start at least 2 uploads.
2. Use notification actions for pause all, resume all, and cancel all.
3. Cross-check upload manager state immediately after each action.
Expected:
- Notification actions apply queue-level operations correctly.
- Action effects are reflected in manager and overlay with no stale state.

## 6) Background and Termination Boundaries
1. Start upload and send app to background (app still alive).
2. Return to foreground and verify continuity.
3. Force terminate app and relaunch.
Expected:
- Background-alive session resumes robustly.
- Force-terminated behavior follows current platform/runtime limitations; no false pass if native transfer persistence is expected.

## Pass-Fail Matrix Template
- Device:
- OS version:
- Build version:
- Case id:
- Result (pass/fail):
- Failure evidence (logs/screenshots):
- Regression classification (critical/high/medium/low):

## Known Explicit Constraints
- True OS-native upload continuity when app is fully terminated is still constrained by Expo JS lifecycle.
- Notification actions are queue-level, not per-file buttons inside OS notification shade.
- Backend upload sessions are in-memory and can reset after server restart.
