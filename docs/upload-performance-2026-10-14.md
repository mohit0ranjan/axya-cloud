# Upload performance investigation — 14 October 2026

## Evidence and changes

The phone screenshot shows 107 selected files: 106 in progress, one complete,
with Telegram delivery and retry states. It does not establish the specific
network error, Telegram account throttling, or measured throughput. Production
logs and a timed physical-device batch remain necessary to distinguish those.

Source review established:

* Files travel phone → Render staging → Telegram. Both network legs consume time.
* Telegram delivery is limited to two finalizers by default, with four GramJS
  part workers per file. Increasing file concurrency without measurement can
  overload a small server or provoke Telegram rate limits.
* Installed GramJS upload code uses batches with a Promise.all barrier. An
  error escaping that operation makes the adapter start the entire file again.
  Small parts also incur more RPC overhead than Telegram's recommended 512 KiB.
* Android selected the same first twelve unfinished tasks before checking their
  retry timers. Processing files could starve later files in a large batch.

Implemented:

1. Continuous MTProto part workers, 512 KiB parts, default six / maximum eight.
   A finished worker immediately takes the next part.
2. Up to five attempts per transiently failed part, keeping the same temporary
   file ID and index. Successful parts are not resent during these retries.
   Shared FLOOD_WAIT cooldown, bounded buffers and file-size verification.
3. Completed temporary file handles reused when SendMedia alone needs retry.
   Expired/missing parts invalidate the handle. Stable message random ID and
   existing delivery checkpoints remain in place.
4. Android queue rotation and retry-timer filtering before selecting twelve
   tasks. Successful chunks clear consecutive retry failures; successful
   processing polls clear stale connection-error labels.
5. Telegram delivery duration/bytes/throughput logs, excluding credentials,
   sessions and filenames. Measure these rather than promising a speed factor.

These part checkpoints are in memory for one delivery, not persistent MTProto
resume across a Render restart. Phone-to-server acknowledged chunks retain the
existing resume protocol. A Free Render restart can still lose staging bytes.

## Integration status (updated after implementation)

Backend dependencies now include `@mtcute/node` and `@mtcute/convert`. The
adapter uses mtcute for the byte-transfer phase, with two upload connections
and three requests per connection by default. GramJS retains marker
reconciliation, stable random IDs, SendMedia and existing preview pointers.
`TELEGRAM_UPLOAD_TRANSPORT=gramjs` selects the bounded part engine as rollback.
Sessions stay encrypted in the existing database; mtcute clients use memory
storage and close after 60 seconds idle.

A real 12,582,931-byte diagnostic document was uploaded to Telegram, sent via
the existing message path, fully downloaded and compared by SHA-256. All checks
passed; upload + delivery + complete download took 21,866 ms on this local
machine. This is not a phone/Render benchmark or a speedup claim. A discovered
shared-auth-key TL-layer mismatch was fixed by keeping the mtcute upload-only
connections on GramJS's negotiated layer, with identity cached from the existing
authenticated reader. Modern account/message APIs are not mixed across schemas.

Android now bundles the official TDLib JNI classes/binaries from pinned
`react-native-tdlib` 2.3.0 through the existing Expo module. Its foreground RN
wrapper is deliberately disabled. The native transfer service owns per-account
TDLib clients, encrypted databases and restart checkpoints. Profile → Direct
Telegram uploads provides separate device authorization and verifies the same
Telegram user ID. Only new Saved Messages transfers use direct mode; staged
transfers and other chat targets retain the backend path. TDLib needs a fresh
native build, not an Expo OTA update.

Backend direct-upload reservations and completion endpoints verify the marker,
original filename and document size in the owner's Saved Messages before a
transaction creates the drive entry. Client-provided hashes are not treated as
verified integrity/deduplication hashes. Direct mode still requires the backend
for registration/confirmation. It does not make metadata available offline.

Checks: backend build + 53 server tests, app typecheck + 39 JavaScript tests.
Android build 7 completed successfully (TDLib JNI + Kotlin compiled). Final build
8 also includes cancellation serialization and direct-source cleanup:
https://expo.dev/accounts/mohit0344/projects/axya/builds/9a64a050-1f50-40fc-b58e-3a21ca6a47ff
Native compilation / device authorization / background recovery and production
batch throughput remain release gates until verified.

Backend push/deploy held: database inspection found two uploading and seven
queued staged sessions. A free Render redeploy can discard these pending bytes.

Local comparison, same file/account, alternating sequential uploads (two samples
each): original GramJS four-worker uploader 5,841 / 4,565 ms; mtcute 4,134 / 963 ms.
These are upload-only times. Connection warmup contributes to the first mtcute
sample. Small samples on a desktop cannot predict production/mobile throughput.

TDLib ELF load alignment verified: arm64-v8a and x86_64 >= 16 KiB. armeabi-v7a
uses 4 KiB alignment (32-bit); no x86 TDLib binary is provided by this package.
Direct mode cannot operate on an unsupported ABI; existing backend transfers
remain available. No claim of physical-device completion is made.

## Technology research

* **mtcute (@mtcute/node, @mtcute/web):** strongest candidate to benchmark as
  the replacement server transport. Its source implements a dedicated upload
  connection pool, tunable requests per connection, continuous part dispatch,
  stream input and AbortSignal. This is a meaningful difference from merely
  increasing GramJS workers on the same sender. It is not a drop-in replacement:
  session conversion, media identifiers, send idempotency and read paths need
  compatibility tests. Upload-only integration and scoped live checks are now
  implemented above; this does not replace all auth/message/read APIs.
  https://github.com/mtcute/mtcute
  https://github.com/mtcute/mtcute/blob/master/packages/core/src/highlevel/methods/files/upload-file.ts
* **react-native-tdlib:** community native bridge shipping Android/iOS TDLib
  binaries; possible starting point for the direct Android prototype. README
  documents native methods/events and separate Telegram authorization. Expo 55 /
  RN 0.83 New Architecture compatibility and service-owned background transfers
  are not established by that README and must be built/tested. Expo Go cannot
  simply load a new custom native library; a new native build is required.
  https://github.com/vladlenskiy/react-native-tdlib
* **Telegram MTProto:** already integrated; optimize this delivery path first.
  Telegram explicitly recommends continuous local part queues, 512 KiB parts,
  and allows additional parallel transfer connections. Extra TCP sessions are
  not implemented by this change.
  https://core.telegram.org/api/files
* **TDLib (official C++ Telegram library):** candidate for a native Android
  direct-to-Telegram transport that removes the Render byte relay. Requires
  native dependency packaging, device-local Telegram authorization/session
  storage, server metadata registration and independent end-to-end tests.
  Existing GramJS sessions must not be assumed portable to TDLib. Native direct
  mode now uses a separate device authorization and a service-owned JNI client.
  https://github.com/tdlib/td
* **tus / tusd:** standardized phone/web → staging resumable HTTP uploads.
  Useful for interoperable upload clients, but it does not accelerate the
  Render → Telegram bottleneck. Axya already has acknowledged-chunk resumption.
  https://github.com/tus/tusd
* **Durable object staging:** S3-compatible multipart storage is a possible
  replacement for ephemeral local staging. It needs bucket credentials,
  lifecycle cleanup and costs review, and still retains a second Telegram leg.
* **Render Free:** no persistent disk, idle spin-down and shared resource limits
  remain. Uptime monitoring does not provide durable staging or a speed SLA.
  https://render.com/docs/free

## Release and performance gate

Do not deploy while the current batch has uncommitted files: an ephemeral-host
restart can discard staging. Backend changes need a backend deploy. Native
queue changes need a new APK; the existing build 6 does not contain them.

Local TypeScript build and server unit tests cover part retries, exact bytes,
continuous scheduling, checksum, bounded concurrency, big-part RPC selection,
and permanent-error handling. They are not Telegram speed measurements.
Android native compilation and physical-device testing remain pending.
Validation completed: server TypeScript build, 53 server unit tests, 39 app
JavaScript unit tests, and git diff whitespace checks. The latter app tests do
not compile the changed Kotlin implementation.

Compare the same 10 / 50 / 107-file set, same phone/network/account, recording
selection-to-completion duration, successful bytes/sec, retries, Telegram flood
waits, CPU/RSS and database writes. Test Wi-Fi → mobile transition, offline
resume, manual pause/cancel, screen off, killed app, and a separate controlled
server restart. Verify file hashes, folder membership, and no duplicate messages.
Do not declare Google Drive parity or 100% reliability from unit tests.
