# Shared Spaces Architecture

<cite>
**Referenced Files in This Document**
- [shared-space-system.md](file://docs/shared-space-system.md)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts)
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts)
- [telegram.service.ts](file://server/src/services/telegram.service.ts)
- [db.service.ts](file://server/src/services/db.service.ts)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts)
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx)
- [index.ts](file://server/src/index.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Security Architecture](#security-architecture)
9. [Database Schema and Relationships](#database-schema-and-relationships)
10. [Scalability Considerations](#scalability-considerations)
11. [Implementation Guidelines](#implementation-guidelines)
12. [Troubleshooting Guide](#troubleshooting-guide)
13. [Conclusion](#conclusion)

## Introduction
This document explains the Shared Spaces architecture for collaborative workspace design and system integration. It covers the high-level flow between a React Native mobile app, a Next.js public web page, an Express API, a PostgreSQL database, and Telegram Saved Messages as the storage backend. It documents component interactions, data flows, security controls, performance optimizations, and operational guidelines for extending and maintaining the system.

## Project Structure
The system spans three primary surfaces:
- Mobile app (React Native): navigates to shared spaces, handles password gates, lists files, and triggers downloads.
- Web app (Next.js): serves public pages under /s/:spaceId and /share/:shareId.
- Backend (Express): exposes REST endpoints, enforces access control, validates passwords, manages uploads/downloads, and integrates with Telegram.

```mermaid
graph TB
subgraph "Mobile App (React Native)"
RN_UI["SharedSpaceScreen.tsx"]
RN_API["sharedSpaceApi.ts"]
end
subgraph "Web App (Next.js)"
WEB_Page["/s/[spaceId] page"]
WEB_Share["/share/[shareId] page"]
end
subgraph "Backend (Express)"
ROUTER["spaces.routes.ts"]
CTRL["spaces.controller.ts"]
TG["telegram.service.ts"]
DB["PostgreSQL"]
end
RN_UI --> RN_API
WEB_Page --> ROUTER
RN_API --> ROUTER
ROUTER --> CTRL
CTRL --> DB
CTRL --> TG
TG --> |"Saved Messages"| CTRL
CTRL --> |"Signed URLs"| RN_UI
CTRL --> |"Signed URLs"| WEB_Page
```

**Diagram sources**
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx#L1-L282)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts#L1-L81)
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L1-L35)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L1-L498)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)

**Section sources**
- [shared-space-system.md](file://docs/shared-space-system.md#L1-L134)
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L1-L35)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L1-L498)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts#L1-L81)
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx#L1-L282)

## Core Components
- Mobile app screens and services:
  - SharedSpaceScreen orchestrates loading, password validation, folder navigation, and file actions.
  - sharedSpaceApi encapsulates HTTP calls to the backend with access tokens.
- Backend controllers and routes:
  - spaces.controller implements all shared space operations: creation, listing, password validation, file listing, uploads, and downloads.
  - spaces.routes defines endpoints and middleware (rate limits).
- Telegram integration:
  - telegram.service manages a persistent client pool, connects via session strings, and streams media progressively.
- Database service:
  - db.service initializes and maintains shared_spaces, shared_files, and access_logs tables.

**Section sources**
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx#L1-L282)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts#L1-L81)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L1-L498)
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L1-L35)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [db.service.ts](file://server/src/services/db.service.ts#L82-L121)

## Architecture Overview
The system uses a layered architecture:
- Presentation layer: React Native app and Next.js pages.
- Application layer: Express routes and controllers implementing business logic.
- Data layer: PostgreSQL for metadata and Telegram Saved Messages for binary storage.
- Integration layer: Telegram client pool for reliable, progressive streaming.

```mermaid
flowchart LR
A["React Native App"] --> |JWT owner APIs| B["Express API"]
W["Next.js Public Page /s/:spaceId"] --> |Public APIs| B
B --> |SQL| D["PostgreSQL"]
B --> |session_string| T["Telegram Saved Messages"]
T --> |"message_id + media"| B
B --> |"Signed download stream"| A
B --> |"Signed download stream"| W
```

**Diagram sources**
- [shared-space-system.md](file://docs/shared-space-system.md#L5-L26)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L427-L497)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L57-L97)

## Detailed Component Analysis

### Mobile App: SharedSpaceScreen and sharedSpaceApi
- Responsibilities:
  - Load space metadata and files with optional password access.
  - Present folders and files, enable uploads when allowed, and trigger downloads via signed URLs.
- Key flows:
  - On mount, fetch space metadata; if password-protected, show PasswordGateComponent.
  - After successful password validation, persist access token and reload content.
  - Navigate folders and refresh lists without remounting the screen.

```mermaid
sequenceDiagram
participant UI as "SharedSpaceScreen.tsx"
participant API as "sharedSpaceApi.ts"
participant BE as "spaces.controller.ts"
participant DB as "PostgreSQL"
UI->>API : fetchSharedSpace(spaceId, accessToken?)
API->>BE : GET /api/spaces/ : id
BE->>DB : SELECT shared_spaces
DB-->>BE : Space metadata
BE-->>API : { space }
API-->>UI : Space DTO
UI->>API : validateSharedSpacePassword(spaceId, password)
API->>BE : POST /api/spaces/ : id/validate-password
BE->>DB : SELECT password_hash
BE-->>API : { access_token }
API-->>UI : Token
UI->>API : fetchSharedSpaceFiles(spaceId, folderPath, accessToken)
API->>BE : GET /api/spaces/ : id/files?folder_path=...
BE->>DB : SELECT shared_files + child folders
DB-->>BE : Files + folders
BE-->>API : { space, files, folders }
API-->>UI : Payload
```

**Diagram sources**
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx#L29-L91)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts#L33-L56)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L218-L355)

**Section sources**
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx#L1-L282)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts#L1-L81)

### Backend: Express Routes and Controllers
- Routes:
  - Define authentication-required endpoints for owners and public endpoints for guests.
  - Apply rate-limiting middleware per action (view, password, upload).
- Controllers:
  - Enforce space expiration and password access checks.
  - Validate MIME types and upload sizes.
  - Generate signed tokens for downloads bound to both space and file identifiers.
  - Stream media from Telegram via a temporary file path and remove it after transfer.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Router as "spaces.routes.ts"
participant Ctrl as "spaces.controller.ts"
participant DB as "PostgreSQL"
participant TG as "telegram.service.ts"
Client->>Router : POST /api/spaces/ : id/upload
Router->>Ctrl : uploadToSpace()
Ctrl->>DB : SELECT users.session_string
Ctrl->>TG : sendFile('me', ...)
TG-->>Ctrl : { message_id, telegram_file_id }
Ctrl->>DB : INSERT shared_files
Ctrl-->>Client : { file }
Client->>Router : GET /api/files/ : id/download?sig=...
Router->>Ctrl : downloadSharedSpaceFile()
Ctrl->>Ctrl : verifyDownloadToken()
Ctrl->>DB : SELECT shared_files + shared_spaces
Ctrl->>TG : getMessages('me', { ids })
TG-->>Ctrl : Media message
Ctrl-->>Client : Stream file
```

**Diagram sources**
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L18-L35)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L357-L497)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L357-L401)

**Section sources**
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L1-L35)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L1-L498)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)

### Telegram Integration: Client Pool and Progressive Streaming
- Client lifecycle:
  - Persistent pool keyed by session fingerprint with TTL eviction and reconnect on disconnect.
  - Graceful error propagation for expired or revoked sessions.
- Streaming:
  - Iterative download with configurable chunk size and byte-range support.
  - Temporary file writes and cleanup to avoid memory pressure.

```mermaid
flowchart TD
Start(["Upload/Download Request"]) --> Lookup["Lookup TelegramClient from pool"]
Lookup --> Connected{"Connected?"}
Connected --> |No| Reconnect["Connect and cache client"]
Connected --> |Yes| Touch["Touch TTL"]
Reconnect --> Touch
Touch --> Action{"Action Type"}
Action --> |Upload| Send["sendFile('me', ...)"]
Action --> |Download| GetMsg["getMessages('me', { ids })"]
Send --> Persist["Persist message_id + metadata"]
GetMsg --> Stream["iterDownload() -> pipe stream"]
Persist --> Done(["Response"])
Stream --> Cleanup["Remove temp file"]
Cleanup --> Done
```

**Diagram sources**
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L57-L97)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L215-L251)

**Section sources**
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)

## Dependency Analysis
- Mobile app depends on sharedSpaceApi for HTTP communication and on SharedSpaceScreen for UI orchestration.
- Backend routes depend on controllers for business logic and on telegram.service for Telegram operations.
- Controllers depend on PostgreSQL for persistence and on telegram.service for media retrieval.
- Rate-limiting middleware is applied at the route level to protect public endpoints.

```mermaid
graph LR
RN["SharedSpaceScreen.tsx"] --> API["sharedSpaceApi.ts"]
API --> RT["spaces.routes.ts"]
RT --> CTRL["spaces.controller.ts"]
CTRL --> DB["PostgreSQL"]
CTRL --> TG["telegram.service.ts"]
```

**Diagram sources**
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx#L1-L282)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts#L1-L81)
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L1-L35)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L1-L498)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)

**Section sources**
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L1-L35)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L1-L498)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [sharedSpaceApi.ts](file://app/src/services/sharedSpaceApi.ts#L1-L81)
- [SharedSpaceScreen.tsx](file://app/src/screens/SharedSpaceScreen.tsx#L1-L282)

## Performance Considerations
- Stable effects and memoization:
  - Initial load guard prevents redundant work; memoized callbacks reduce re-renders.
- Incremental reloads:
  - Folder navigation reloads only affected views without remounting.
- Precomputed signed URLs:
  - Download links are computed server-side to avoid extra client roundtrips.
- Streaming optimizations:
  - Telegram iterDownload streams chunks without full buffering; temporary files are cleaned up promptly.
- Upload pipeline:
  - Multer destination and size limits prevent resource exhaustion; uploads are rejected early on invalid MIME types.

**Section sources**
- [shared-space-system.md](file://docs/shared-space-system.md#L109-L116)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L357-L497)
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L215-L251)

## Security Architecture
- Authentication and access control:
  - Owner-only endpoints require JWT; public endpoints enforce password access via signed space access tokens stored in cookies.
- Cryptography:
  - Passwords hashed with bcrypt at configured cost; signed tokens for downloads bound to both space and file identifiers with short TTL.
- Content validation:
  - MIME allowlist and maximum upload size enforced at controller and middleware layers.
- Expiry enforcement:
  - Spaces and tokens expire; controllers reject requests accordingly.
- Rate limiting:
  - Separate rate limiters for view, password validation, and upload actions.

**Section sources**
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L87-L126)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L161-L194)
- [spaces.routes.ts](file://server/src/routes/spaces.routes.ts#L12-L16)

## Database Schema and Relationships
The system uses three core tables:
- users: stores owner identities and Telegram session strings.
- shared_spaces: defines public spaces, permissions, and expiry.
- shared_files: records uploaded files’ metadata and Telegram message pointers.
- access_logs: tracks access events for auditing and abuse tracing.

```mermaid
erDiagram
USERS {
int id PK
varchar phone UK
varchar telegram_id
text session_string
timestamp created_at
}
SHARED_SPACES {
varchar id PK
varchar name
int owner_id FK
text password_hash
boolean allow_upload
boolean allow_download
timestamp expires_at
timestamp created_at
}
SHARED_FILES {
varchar id PK
varchar space_id FK
bigint telegram_message_id
varchar file_name
bigint file_size
varchar mime_type
varchar uploaded_by
timestamp created_at
varchar telegram_file_id
varchar folder_path
}
ACCESS_LOGS {
int id PK
varchar space_id FK
varchar user_ip
varchar action
timestamp created_at
}
USERS ||--o{ SHARED_SPACES : "owns"
SHARED_SPACES ||--o{ SHARED_FILES : "contains"
SHARED_SPACES ||--o{ ACCESS_LOGS : "targeted_by"
```

**Diagram sources**
- [shared-space-system.md](file://docs/shared-space-system.md#L28-L62)
- [db.service.ts](file://server/src/services/db.service.ts#L82-L121)

**Section sources**
- [shared-space-system.md](file://docs/shared-space-system.md#L28-L62)
- [db.service.ts](file://server/src/services/db.service.ts#L82-L121)

## Scalability Considerations
- Horizontal scaling:
  - Stateless controllers and shared PostgreSQL database enable load balancing behind a reverse proxy.
- Caching:
  - Telegram client pool reduces connection churn; consider caching frequently accessed metadata.
- Asynchronous tasks:
  - Offload long-running operations (e.g., large file processing) to background jobs.
- CDN and edge:
  - Serve signed download streams efficiently; consider edge caching for repeated downloads.
- Observability:
  - Monitor access_logs for abuse detection and capacity planning; instrument rate-limiters and download metrics.

[No sources needed since this section provides general guidance]

## Implementation Guidelines
- Extending shared spaces:
  - Add new controller actions and routes following existing patterns; reuse rate-limiting middleware and access-control helpers.
  - For new UI features, mirror the existing separation between screens and service modules.
- Maintaining integrity:
  - Always verify space expiry and password access before mutating or exposing resources.
  - Ensure uploads validate MIME types and sizes; persist Telegram message identifiers reliably.
  - Clean up temporary files after streaming; log access events for auditability.
- Operational hygiene:
  - Keep secrets (JWT secrets, Telegram API credentials) in environment variables.
  - Monitor pool stats and client eviction events; alert on recurring reconnect failures.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- Common issues and resolutions:
  - Expired or revoked Telegram sessions: client pool evicts expired clients; prompt users to re-authenticate and regenerate session strings.
  - Missing or invalid signed tokens: verify token TTL and binding to both space and file identifiers.
  - Upload failures: confirm MIME allowlist and size limits; inspect multer destination and cleanup logic.
  - Access denied errors: ensure password validation succeeded and access cookie/token is included in subsequent requests.
  - Rate-limited responses: adjust client-side retry delays and reduce bursty operations.

**Section sources**
- [telegram.service.ts](file://server/src/services/telegram.service.ts#L42-L47)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L128-L159)
- [spaces.controller.ts](file://server/src/controllers/spaces.controller.ts#L427-L497)

## Conclusion
The Shared Spaces system combines a React Native mobile interface, a Next.js public web presence, an Express backend, a PostgreSQL metadata store, and Telegram Saved Messages for scalable, collaborative file sharing. Its design emphasizes robust access control, progressive streaming, and operational resilience, with clear extension points and strong security defaults.

[No sources needed since this section summarizes without analyzing specific files]