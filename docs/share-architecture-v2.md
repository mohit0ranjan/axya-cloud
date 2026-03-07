# AXYA Share System V2 (Telegram-Optimized)

## Scope

- Replace legacy `shared_links` sharing implementation end-to-end.
- Keep existing upload pipeline unchanged.
- Provide reliable public file/folder share pages with working preview + download.

## Audit Summary (Current System)

### 1) Multiple overlapping share models

- Legacy model uses `shared_links` + `/api/share/*`.
- Repo also contains `shares` and `shared_spaces` models/routes.
- This fragmentation increases drift and bug surface.

Evidence:
- [`server/src/services/db.service.ts:49`](D:/Projects/teledrive/server/src/services/db.service.ts:49)
- [`server/src/services/db.service.ts:67`](D:/Projects/teledrive/server/src/services/db.service.ts:67)
- [`server/src/services/db.service.ts:83`](D:/Projects/teledrive/server/src/services/db.service.ts:83)

### 2) Public share HTML is embedded inside backend bootstrap

- Large inline HTML+JS share app is in `index.ts`, not a versioned frontend bundle.
- Hard to test, maintain, and deploy safely.

Evidence:
- [`server/src/index.ts:169`](D:/Projects/teledrive/server/src/index.ts:169)

### 3) Token model is coupled and inconsistent

- Link token validation and access token issuance are mixed across page render + API.
- Password verify endpoint does not require signed link proof (share id + password only).

Evidence:
- [`server/src/controllers/share.controller.ts:553`](D:/Projects/teledrive/server/src/controllers/share.controller.ts:553)
- [`server/src/controllers/share.controller.ts:598`](D:/Projects/teledrive/server/src/controllers/share.controller.ts:598)
- [`server/src/services/share.service.ts:69`](D:/Projects/teledrive/server/src/services/share.service.ts:69)
- [`server/src/services/share.service.ts:96`](D:/Projects/teledrive/server/src/services/share.service.ts:96)

### 4) Telegram read path is fragile for public access

- Download/preview requires resolving original Telegram message at request time.
- Resolution tries multiple sessions and may fail if message/session mismatch.
- Failures map to "file unavailable" or download/preview errors.

Evidence:
- [`server/src/controllers/share.controller.ts:63`](D:/Projects/teledrive/server/src/controllers/share.controller.ts:63)
- [`server/src/controllers/share.controller.ts:787`](D:/Projects/teledrive/server/src/controllers/share.controller.ts:787)

### 5) Folder sharing complexity is high

- Folder traversal relies on recursive CTE + path transforms + ad-hoc ZIP generation.
- Error handling for partial Telegram failures during folder ZIP is brittle.

Evidence:
- [`server/src/controllers/share.controller.ts:291`](D:/Projects/teledrive/server/src/controllers/share.controller.ts:291)
- [`server/src/controllers/share.controller.ts:924`](D:/Projects/teledrive/server/src/controllers/share.controller.ts:924)

### 6) `POST /api/share/create` 500 behavior is expected under several DB-trigger paths

- Endpoint returns generic 500 for unclassified DB exceptions.
- `shared_links` has ownership trigger + uniqueness constraints that can raise non-normalized DB errors.

Evidence:
- [`server/src/controllers/share.controller.ts:342`](D:/Projects/teledrive/server/src/controllers/share.controller.ts:342)
- [`server/src/services/db.service.ts:178`](D:/Projects/teledrive/server/src/services/db.service.ts:178)

## V2 Design Principles

- Single source of truth: one share model.
- Stateless public APIs + short-lived scoped tokens.
- Deterministic resource snapshots for shares (file/folder membership at create time).
- Telegram read reliability: owner session first, then configured fallbacks.
- Strictly separate metadata APIs from binary streaming APIs.
- Upload flow untouched.

## V2 Database Structure

### Table: `share_links_v2`

- `id UUID PK`
- `owner_user_id UUID NOT NULL`
- `resource_type TEXT CHECK (resource_type IN ('file','folder'))`
- `root_file_id UUID NULL`
- `root_folder_id UUID NULL`
- `slug TEXT UNIQUE NOT NULL` (public id in URL; non-sequential random base62)
- `link_secret_hash TEXT NOT NULL` (hash of private link secret)
- `password_hash TEXT NULL`
- `allow_download BOOLEAN NOT NULL DEFAULT true`
- `allow_preview BOOLEAN NOT NULL DEFAULT true`
- `expires_at TIMESTAMP NULL`
- `revoked_at TIMESTAMP NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMP NOT NULL DEFAULT NOW()`
- Constraint: exactly one of `root_file_id` / `root_folder_id` present.

### Table: `share_items_v2`

- Snapshot of all files included in a share at creation/rebuild.
- `id UUID PK`
- `share_id UUID NOT NULL REFERENCES share_links_v2(id) ON DELETE CASCADE`
- `file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE`
- `relative_path TEXT NOT NULL` (for folder shares; `''` for single file)
- `display_name TEXT NOT NULL`
- `mime_type TEXT NULL`
- `size_bytes BIGINT NOT NULL`
- `telegram_chat_id TEXT NOT NULL`
- `telegram_message_id BIGINT NOT NULL`
- `telegram_file_id TEXT NULL`
- `position_index INT NOT NULL DEFAULT 0`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`
- Unique: `(share_id, file_id)`
- Indexes: `(share_id, relative_path)`, `(share_id, position_index)`

### Table: `share_access_sessions_v2`

- Public access session after link validation/password.
- `id UUID PK`
- `share_id UUID NOT NULL`
- `session_token_hash TEXT NOT NULL`
- `granted_at TIMESTAMP NOT NULL DEFAULT NOW()`
- `expires_at TIMESTAMP NOT NULL`
- `ip TEXT NULL`
- `user_agent TEXT NULL`
- `revoked_at TIMESTAMP NULL`
- Indexes: `(share_id, expires_at)`, `(session_token_hash)`

### Table: `share_events_v2`

- Audit and reliability telemetry.
- `id UUID PK`
- `share_id UUID NOT NULL`
- `event_type TEXT NOT NULL` (`open`, `password_ok`, `password_fail`, `preview`, `download`, `download_zip`, `error`)
- `item_id UUID NULL`
- `status_code INT NULL`
- `error_code TEXT NULL`
- `meta JSONB NOT NULL DEFAULT '{}'::jsonb`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`
- Index: `(share_id, created_at DESC)`

## Token System

### 1) Public link token (long-lived, in URL)

- URL format: `/s/{slug}?k={secret}`
- `{slug}` resolves DB row.
- `{secret}` is random 32-byte base64url.
- Store only `SHA-256(secret + server_pepper)` in DB.
- No JWT required for link itself.

### 2) Access session token (short-lived, API usage)

- Issued only after link validation (+ password if required).
- 15-30 min TTL, refreshable.
- JWT or opaque token acceptable; opaque + DB hash recommended for revocation.
- Scope claims: `share_id`, `allow_preview`, `allow_download`.
- Never embed file IDs list in token.

### 3) Item download token (very short-lived)

- For stream endpoints, issue per-item signed token TTL 60-120s.
- Claims: `share_id`, `item_id`, `disposition`, nonce.
- Prevents replay and cross-item token abuse.

## API Route Structure

### Authenticated owner routes

- `POST /api/v2/shares`
  - body: `{ resource_type, root_file_id|root_folder_id, password?, allow_download, allow_preview, expires_at? }`
  - creates share row + builds snapshot in `share_items_v2`.
- `GET /api/v2/shares`
  - list owner shares + stats.
- `PATCH /api/v2/shares/:id`
  - update expiry/password/flags/revoke/rebuild-snapshot.
- `DELETE /api/v2/shares/:id`
  - revoke share.

### Public routes

- `POST /api/v2/public/shares/:slug/open`
  - body: `{ secret, password? }`
  - validates link + password and returns `{ session_token, share_meta }`.
- `GET /api/v2/public/shares/:slug/meta`
  - requires session token.
  - returns sanitized metadata, counts, flags, expiry.
- `GET /api/v2/public/shares/:slug/items`
  - requires session token.
  - query: `path`, `cursor`, `limit`, `search`, `sort`.
  - returns folders/files from `share_items_v2` snapshot.
- `POST /api/v2/public/shares/:slug/items/:itemId/preview-ticket`
  - returns short-lived preview/download ticket.
- `GET /api/v2/public/stream/:ticket`
  - serves inline preview or attachment stream.
- `GET /api/v2/public/shares/:slug/download-all`
  - async preferred: returns job id for zip.
  - small shares may stream directly.

## Preview System

- Preview is only another stream disposition (`inline`), not a separate Telegram logic path.
- For image/video/pdf/text:
  - Browser requests `stream/:ticket` with `inline`.
  - Support HTTP range for video/audio.
- Content-type is from snapshot metadata, fallback to Telegram message media type if missing.
- If Telegram fetch fails:
  - deterministic error code (`telegram_message_missing`, `telegram_session_invalid`, `telegram_timeout`).
  - user-facing message: "File temporarily unavailable, retry".

Reliability additions:
- Memory + disk chunk cache for hot items.
- ETag/Last-Modified on stream response.
- Abort-safe stream handling and connection timeout guards.

## Download System

- Single item download:
  - same stream endpoint with `attachment`.
  - increment event counters after first byte sent.
- Folder download:
  - build zip from `share_items_v2` snapshot paths.
  - default async job (`share_zip_jobs_v2`) for reliability on large folders.
  - expose polling route: `GET /api/v2/public/shares/:slug/zip-jobs/:jobId`.
  - completed zip expires automatically.

## Folder Sharing Logic

- At share creation:
  - resolve folder subtree once.
  - capture all current files into `share_items_v2` with deterministic `relative_path`.
- Default mode: snapshot (stable and reliable).
- Optional mode later: live share (rebuild snapshot on demand).
- Empty folder returns success with zero items, not error.

## Telegram-Specific Optimizations

- Resolve Telegram client order as:
  1. owner `session_string` (first)
  2. `TELEGRAM_STORAGE_SESSION`
  3. `TELEGRAM_SESSION`
- Cache successful `(chat_id, message_id) -> clientKey` mapping for faster reads.
- On repeated failures, circuit-break failing client for short cooldown.
- Keep upload write path unchanged.

## Migration Plan

1. Add new tables (`share_links_v2`, `share_items_v2`, `share_access_sessions_v2`, `share_events_v2`).
2. Build V2 routes/controllers alongside current routes.
3. Add owner UI to create/manage V2 shares.
4. Add public web page consuming only V2 public APIs.
5. Shadow-test V2 using canary traffic.
6. Freeze legacy `/api/share/*` creation.
7. Migrate active legacy links to V2 (generate new URL; optional compatibility redirect).
8. Remove legacy `shared_links` read path after cutover.

## Non-Goals

- No changes to upload endpoints, chunk logic, or Telegram upload flow.

## Expected Outcomes

- No more generic `/api/share/create` 500s from legacy edge paths.
- Share open/preview/download behavior deterministic and debuggable.
- Folder shares work from snapshot index instead of deep recursive live queries.
- Public share page becomes maintainable and testable.
