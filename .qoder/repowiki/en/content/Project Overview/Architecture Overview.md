# Architecture Overview

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [server/src/index.ts](file://server/src/index.ts)
- [server/src/config/db.ts](file://server/src/config/db.ts)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts)
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts)
- [server/src/routes/file.routes.ts](file://server/src/routes/file.routes.ts)
- [server/src/controllers/auth.controller.ts](file://server/src/controllers/auth.controller.ts)
- [app/package.json](file://app/package.json)
- [server/package.json](file://server/package.json)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts)
- [app/src/context/AuthContext.tsx](file://app/src/context/AuthContext.tsx)
- [app/src/services/api.ts](file://app/src/services/api.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document describes the system architecture of ANYX, a self-hosted cloud storage platform that turns a private Telegram channel into an unlimited storage backend while providing a modern React Native mobile app and a Node.js/Express backend. The backend persists metadata in PostgreSQL and orchestrates file lifecycle operations via the Telegram Bot/Client APIs. The system emphasizes ownership of data, self-hosting, and a mobile-first experience.

## Project Structure
The repository is organized into three primary areas:
- app: React Native mobile application with authentication, upload/download, and UI components
- server: Node.js/Express backend with routing, controllers, services, and database integration
- docs: Documentation and assets

```mermaid
graph TB
subgraph "Mobile App (React Native)"
RN_UI["UI Screens<br/>Navigation & Context"]
RN_API["API Client<br/>Axios Interceptors"]
RN_AUTH["Auth Context<br/>Secure Storage"]
end
subgraph "Backend Server (Node.js + Express)"
ROUTES["Routes<br/>/auth, /files, /stream, /spaces"]
CTRL["Controllers<br/>Auth/File/Stream/Upload"]
SRV_TELEGRAM["Telegram Service<br/>Client Pool & Downloads"]
SRV_DB["DB Service<br/>Schema & Migrations"]
CFG_DB["DB Config<br/>Connection Pool"]
CFG_TELEGRAM["Telegram Config<br/>Client Setup"]
end
subgraph "External Systems"
PG["PostgreSQL<br/>Metadata"]
TG["Telegram Bot API<br/>Private Channel Storage"]
end
RN_UI --> RN_API
RN_AUTH --> RN_API
RN_API --> ROUTES
ROUTES --> CTRL
CTRL --> SRV_TELEGRAM
CTRL --> SRV_DB
SRV_DB --> CFG_DB
SRV_TELEGRAM --> CFG_TELEGRAM
SRV_DB --> PG
SRV_TELEGRAM --> TG
```

**Diagram sources**
- [server/src/index.ts](file://server/src/index.ts#L1-L315)
- [server/src/routes/file.routes.ts](file://server/src/routes/file.routes.ts#L1-L118)
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L1-L800)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L1-L315)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts#L1-L29)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L1-L164)
- [app/src/context/AuthContext.tsx](file://app/src/context/AuthContext.tsx#L1-L98)

**Section sources**
- [README.md](file://README.md#L225-L246)
- [server/src/index.ts](file://server/src/index.ts#L1-L315)
- [server/src/routes/file.routes.ts](file://server/src/routes/file.routes.ts#L1-L118)
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L1-L800)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L1-L315)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts#L1-L29)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L1-L164)
- [app/src/context/AuthContext.tsx](file://app/src/context/AuthContext.tsx#L1-L98)

## Core Components
- Mobile App (React Native)
  - Authentication flow with secure token storage
  - REST API client with interceptors and retry logic
  - UI screens for files, folders, previews, and settings
- Backend Server (Node.js/Express)
  - Centralized middleware for security, CORS, rate limiting, and logging
  - Routing for authentication, file management, streaming, and shared spaces
  - Controllers implementing business logic for uploads, downloads, streaming, and metadata operations
  - Services for Telegram client pooling and PostgreSQL schema initialization
- PostgreSQL
  - Stores user profiles, files, folders, shared links, tags, and audit logs
  - Indexes and triggers optimize queries and maintain counters
- Telegram Bot API
  - Acts as the actual storage engine for files
  - Client pool enables efficient, persistent connections and progressive downloads

**Section sources**
- [app/package.json](file://app/package.json#L1-L59)
- [server/package.json](file://server/package.json#L1-L57)
- [server/src/index.ts](file://server/src/index.ts#L1-L315)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L1-L315)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)

## Architecture Overview
ANYX follows a layered architecture:
- Presentation Layer: React Native mobile app
- Application Layer: Express routes and controllers
- Domain Layer: Business logic for uploads, downloads, streaming, and shared access
- Infrastructure Layer: PostgreSQL for metadata and Telegram for file storage

```mermaid
graph TB
A["Mobile App<br/>React Native"] --> B["Express API<br/>REST Endpoints"]
B --> C["Controllers<br/>Auth/File/Stream"]
C --> D["Telegram Service<br/>Client Pool"]
C --> E["DB Service<br/>Schema & Queries"]
E --> F["PostgreSQL<br/>Tables & Indices"]
D --> G["Telegram Bot API<br/>Private Channel"]
```

**Diagram sources**
- [server/src/index.ts](file://server/src/index.ts#L1-L315)
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L1-L800)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L1-L315)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts#L1-L29)

## Detailed Component Analysis

### Mobile App Authentication Flow
The mobile app authenticates users via Telegram OTP and stores a JWT token securely. On startup, the app verifies the token against the backend and hydrates the UI accordingly.

```mermaid
sequenceDiagram
participant UI as "Mobile App"
participant API as "Express API"
participant TGSVC as "Telegram Service"
participant DB as "PostgreSQL"
UI->>API : POST /auth/send-code
API->>TGSVC : generateOTP(phone)
TGSVC-->>API : {phoneCodeHash,tempSession}
API-->>UI : {success,phoneCodeHash,tempSession}
UI->>API : POST /auth/verify-code
API->>TGSVC : verifyOTPAndSignIn(...)
TGSVC-->>API : {userSessionString,profile}
API->>DB : Upsert user + session_string
API-->>UI : {token,user}
UI->>API : GET /auth/me (with Authorization)
API->>DB : SELECT user
DB-->>API : {user}
API-->>UI : {user}
```

**Diagram sources**
- [server/src/controllers/auth.controller.ts](file://server/src/controllers/auth.controller.ts#L1-L96)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L101-L160)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)
- [app/src/context/AuthContext.tsx](file://app/src/context/AuthContext.tsx#L1-L98)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L1-L164)

**Section sources**
- [app/src/context/AuthContext.tsx](file://app/src/context/AuthContext.tsx#L1-L98)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L1-L164)
- [server/src/controllers/auth.controller.ts](file://server/src/controllers/auth.controller.ts#L1-L96)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L101-L160)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)

### File Upload Pipeline
The upload pipeline streams files to Telegram via the Telegram client and records metadata in PostgreSQL.

```mermaid
sequenceDiagram
participant UI as "Mobile App"
participant API as "Express API"
participant CTRL as "File Controller"
participant TGSVC as "Telegram Service"
participant DB as "PostgreSQL"
UI->>API : POST /files/upload (multipart/form-data)
API->>CTRL : uploadFile(req,res)
CTRL->>TGSVC : getDynamicClient(sessionString)
TGSVC-->>CTRL : TelegramClient
CTRL->>TGSVC : sendFile(chatId, {CustomFile,...})
TGSVC-->>CTRL : {messageId,telegram_file_id}
CTRL->>DB : INSERT INTO files (user_id,folder_id,file_name,file_size,...)
DB-->>CTRL : {file}
CTRL-->>API : {success,file}
API-->>UI : {success,file}
```

**Diagram sources**
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L49-L98)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L57-L97)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)

**Section sources**
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L49-L98)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L57-L97)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)

### Streaming and Thumbnail Generation
Streaming avoids buffering by caching downloaded media to disk and serving HTTP Range requests. Thumbnails are generated efficiently using Telegram’s native thumbnails or on-demand compression.

```mermaid
flowchart TD
Start(["Request /files/:id/stream"]) --> CheckCache["Check Disk Cache"]
CheckCache --> CacheHit{"Cache Fresh?"}
CacheHit --> |Yes| ServeRange["Serve HTTP 206/200 with Range"]
CacheHit --> |No| Download["Download from Telegram to Cache"]
Download --> CacheWrite["Write to Disk Cache"]
CacheWrite --> ServeRange
ServeRange --> End(["Response Sent"])
```

**Diagram sources**
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L544-L689)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L215-L251)

**Section sources**
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L544-L689)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L215-L251)

### Data Model and Schema
PostgreSQL stores all metadata, including users, files, folders, shared links, tags, and audit logs. Migrations ensure schema integrity and indexes optimize common queries.

```mermaid
erDiagram
USERS {
uuid id PK
text phone UK
text session_string
text name
text username
text profile_pic
text plan
bigint storage_quota_bytes
bigint storage_used_bytes
int total_files_count
timestamp last_active_at
timestamp created_at
}
FOLDERS {
uuid id PK
uuid user_id FK
text name
uuid parent_id FK
boolean is_trashed
timestamp trashed_at
text color
timestamp created_at
timestamp updated_at
}
FILES {
uuid id PK
uuid user_id FK
uuid folder_id FK
text file_name
bigint file_size
text telegram_file_id
bigint telegram_message_id
text telegram_chat_id
text mime_type
boolean is_trashed
timestamp trashed_at
boolean is_starred
text sha256_hash
timestamp created_at
timestamp updated_at
}
SHARED_LINKS {
uuid id PK
uuid file_id FK
uuid folder_id FK
text token UK
timestamp expires_at
uuid created_by FK
text password_hash
boolean allow_download
boolean view_only
int views
int download_count
boolean is_public
timestamp created_at
}
ACCESS_LOGS {
uuid id PK
uuid space_id FK
text user_ip
text action
timestamp created_at
}
ACTIVITY_LOG {
uuid id PK
uuid user_id FK
text action
uuid file_id
uuid folder_id
jsonb meta
timestamp created_at
}
FILE_TAGS {
uuid id PK
uuid file_id FK
uuid user_id FK
text tag
timestamp created_at
}
USERS ||--o{ FOLDERS : "owns"
USERS ||--o{ FILES : "owns"
USERS ||--o{ SHARED_LINKS : "creates"
FILES ||--o{ FILE_TAGS : "tagged"
USERS ||--o{ FILE_TAGS : "tags"
SHARED_LINKS }o--|| FILES : "targets"
SHARED_LINKS }o--|| FOLDERS : "targets"
```

**Diagram sources**
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L3-L137)

**Section sources**
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L3-L137)

### Telegram Client Pool and Progressive Downloads
The Telegram service maintains a persistent client pool keyed by session fingerprint, enabling long-lived connections for streaming and reducing re-auth overhead. Downloads use iterative chunking to avoid full buffering.

```mermaid
classDiagram
class TelegramService {
+getDynamicClient(sessionString) TelegramClient
+generateOTP(phoneNumber) Promise
+verifyOTPAndSignIn(...) Promise
+resolveFileInfo(client,chatId,messageId) Promise
+iterFileDownload(client,message,offset,limit) AsyncGenerator
+getPoolStats() Object
}
class DBConfig {
+pool Pool
}
TelegramService --> DBConfig : "uses for logging/connection info"
```

**Diagram sources**
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)

**Section sources**
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L1-L260)
- [server/src/config/db.ts](file://server/src/config/db.ts#L1-L61)

## Dependency Analysis
- Mobile app depends on:
  - Axios for HTTP requests
  - Secure storage for JWT
  - Navigation and UI libraries
- Backend depends on:
  - Express for routing and middleware
  - node-telegram-bot-api/telegram for Telegram integration
  - pg for PostgreSQL connectivity
  - bcryptjs, helmet, cors, rate-limit for security and resilience
- External dependencies:
  - Telegram Bot API for storage
  - PostgreSQL for metadata persistence

```mermaid
graph LR
RN["React Native App"] --> AX["Axios"]
RN --> SEC["Secure Storage"]
BE["Express Server"] --> EXP["Express"]
BE --> PG["pg (PostgreSQL)"]
BE --> TG["telegram (Telegram)"]
BE --> HC["helmet/cors/rate-limit"]
BE --> LOG["winston (logging)"]
PG --> DB["PostgreSQL"]
TG --> BOT["Telegram Bot API"]
```

**Diagram sources**
- [app/package.json](file://app/package.json#L1-L59)
- [server/package.json](file://server/package.json#L1-L57)
- [server/src/index.ts](file://server/src/index.ts#L1-L315)

**Section sources**
- [app/package.json](file://app/package.json#L1-L59)
- [server/package.json](file://server/package.json#L1-L57)
- [server/src/index.ts](file://server/src/index.ts#L1-L315)

## Performance Considerations
- Streaming and caching
  - Disk cache for streams reduces repeated Telegram downloads and supports HTTP Range requests
  - Thumbnail cache avoids recompression and redundant downloads
- Client pooling
  - Persistent Telegram clients reduce handshake overhead and improve throughput for media playback
- Database tuning
  - Connection pool limits and timeouts prevent resource exhaustion on free tiers
  - Indexes on frequently queried columns accelerate listing and search
- Resilience
  - Retry logic in the mobile app and backend mitigates transient failures
  - Graceful degradation for optional features (e.g., thumbnail generation)

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- Authentication failures
  - Verify Telegram API credentials and session storage
  - Confirm JWT secret and token validity
- Upload/download issues
  - Check Telegram client pool status and session revocation
  - Inspect disk cache directories and permissions
- Database connectivity
  - Validate DATABASE_URL and SSL mode
  - Monitor pool errors and connection timeouts
- Streaming problems
  - Ensure cache TTL and disk space availability
  - Review Range request handling and partial content responses

**Section sources**
- [server/src/controllers/auth.controller.ts](file://server/src/controllers/auth.controller.ts#L1-L96)
- [server/src/services/telegram.service.ts](file://server/src/services/telegram.service.ts#L255-L260)
- [server/src/config/db.ts](file://server/src/config/db.ts#L39-L58)
- [server/src/controllers/file.controller.ts](file://server/src/controllers/file.controller.ts#L544-L689)

## Conclusion
ANYX achieves unlimited, private, self-hosted storage by leveraging Telegram as the backend while managing structure and access through a robust Node.js/Express backend and a modern React Native frontend. PostgreSQL ensures reliable metadata persistence, and the Telegram client pool enables efficient streaming and downloads. The layered architecture, combined with thoughtful caching and resilience strategies, delivers a scalable and user-friendly cloud storage solution.