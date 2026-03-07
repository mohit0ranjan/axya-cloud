# Task Lifecycle Management

<cite>
**Referenced Files in This Document**
- [UploadManager.ts](file://app/src/services/UploadManager.ts)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx)
- [uploadService.ts](file://app/src/services/uploadService.ts)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts)
- [apiClient.ts](file://app/src/services/apiClient.ts)
- [retry.ts](file://app/src/utils/retry.ts)
- [UploadProgressOverlay.tsx](file://app/src/components/UploadProgressOverlay.tsx)
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
This document explains the upload task lifecycle management system used by the application. It focuses on the UploadTask interface, the state machine with all valid transitions, illegal transition detection, automatic recovery mechanisms, task creation with unique IDs and deduplication fingerprints, and the transition() method. It also covers common state sequences such as normal upload flow, pause/resume cycles, and retry scenarios with exponential backoff timing.

## Project Structure
The upload lifecycle spans the frontend React application and the backend server:
- Frontend: UploadManager orchestrates task creation, state transitions, persistence, notifications, and retry logic.
- Backend: Upload controller manages server-side upload sessions, deduplication, chunk ordering, Telegram delivery, and status polling.

```mermaid
graph TB
subgraph "Frontend"
UM["UploadManager<br/>Task orchestration"]
UCtx["UploadContext<br/>React provider"]
UI["UploadProgressOverlay<br/>UI"]
end
subgraph "Backend"
Ctrl["Upload Controller<br/>Server-side state"]
DB["PostgreSQL<br/>Files table"]
TG["Telegram API<br/>Media delivery"]
end
UM --> |HTTP| Ctrl
Ctrl --> |DB| DB
Ctrl --> |Telegram| TG
UCtx --> UM
UI --> UCtx
```

**Diagram sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L126-L992)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L12-L123)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L134-L546)

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L1-L18)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L1-L123)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L1-L118)

## Core Components
- UploadTask interface defines the task model with status, progress, retry count, and deduplication fingerprint.
- UploadManager implements the state machine, persistence, notifications, and automatic recovery.
- UploadContext exposes a React provider that subscribes to UploadManager and renders UI updates.
- Server-side upload controller manages upload sessions, deduplication, chunk ordering, and Telegram delivery.

Key responsibilities:
- Task creation: unique IDs, fingerprint generation, initial queued state.
- State transitions: validated by a transition table with illegal transitions blocked.
- Automatic recovery: exponential backoff, pause/resume, and retry logic.
- Persistence: AsyncStorage-backed queue and historical stats.
- Notifications: Android progress notifications and completion summaries.

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L36-L65)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L154-L174)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L514-L556)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L12-L123)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L134-L274)

## Architecture Overview
The system follows a producer-consumer model:
- Producer: UI triggers addUploads, which create tasks with unique IDs and deduplication fingerprints.
- Orchestrator: UploadManager maintains a queue, enforces state transitions, and schedules concurrent uploads.
- Consumers: Server upload controller processes chunks, performs deduplication, and delivers media to Telegram.
- Feedback: Server status polling updates task progress until completion.

```mermaid
sequenceDiagram
participant UI as "UI Layer"
participant Ctx as "UploadContext"
participant Mgr as "UploadManager"
participant Srv as "Upload Controller"
participant DB as "PostgreSQL"
participant TG as "Telegram"
UI->>Ctx : addUpload(files, folderId, chatTarget)
Ctx->>Mgr : addUploads(files, folderId, chatTarget)
Mgr->>Mgr : create tasks with unique IDs and fingerprints
Mgr->>Mgr : enqueue tasks (status=queued)
loop Concurrency control
Mgr->>Mgr : processQueue()
Mgr->>Srv : POST /files/upload/init
Srv->>DB : create upload session
Srv-->>Mgr : {uploadId, duplicate?}
alt duplicate
Mgr->>Mgr : update progress=100, bytesUploaded=size
Mgr-->>UI : notify listeners
else upload
loop chunk upload
Mgr->>Srv : POST /files/upload/chunk
Srv->>DB : append chunk
Srv-->>Mgr : progress update
end
Mgr->>Srv : POST /files/upload/complete
Srv->>TG : sendFile(chatId, file)
Srv->>DB : insert file record (ON CONFLICT)
loop status polling
Mgr->>Srv : GET /files/upload/status/ : uploadId
Srv-->>Mgr : {status, progress}
end
Mgr->>Mgr : update progress=100, status=completed
end
end
```

**Diagram sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L514-L981)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L134-L546)

## Detailed Component Analysis

### UploadTask Interface and States
The UploadTask interface defines the task model with the following fields:
- id: Unique task identifier.
- file: FileAsset with uri, name, size, and optional mimeType.
- folderId: Target folder identifier or null.
- chatTarget: Telegram chat identifier (default me).
- progress: Percentage 0–100.
- bytesUploaded: Bytes successfully sent so far.
- status: Current state among pending, queued, uploading, paused, waiting_retry, retrying, completed, failed, cancelled.
- error: Optional error message for failed tasks.
- retryCount: Number of retries performed.
- uploadId: Server-assigned upload session ID.
- fingerprint: Deduplication key built from uri|name|size.
- duplicate: Flag indicating server detected existing file.

States and valid transitions are defined by a transition table. The transition() method enforces these rules and logs illegal transitions.

```mermaid
stateDiagram-v2
[*] --> pending
pending --> queued : "addUploads()"
queued --> uploading : "processQueue()"
queued --> paused : "pause()"
queued --> cancelled : "cancel()"
uploading --> completed : "success"
uploading --> waiting_retry : "network error"
uploading --> failed : "fatal error"
uploading --> paused : "pause()"
uploading --> cancelled : "cancel()"
waiting_retry --> retrying : "timer fires"
waiting_retry --> cancelled : "cancel()"
waiting_retry --> paused : "pause()"
retrying --> uploading : "resume"
retrying --> cancelled : "cancel()"
retrying --> paused : "pause()"
paused --> queued : "resume()"
failed --> queued : "retryFailed()"
completed --> [*]
cancelled --> [*]
```

**Diagram sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L154-L164)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L166-L174)

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L36-L65)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L154-L174)

### State Machine Logic and Transition Validation
- VALID_TRANSITIONS: Defines allowed transitions per state.
- transition(task, to): Validates target state against allowed transitions and logs illegal attempts.
- Illegal transitions are blocked and logged; the system remains in the current state.

```mermaid
flowchart TD
Start(["transition(task, to)"]) --> GetAllowed["Get allowed transitions for task.status"]
GetAllowed --> Allowed{"to in allowed?"}
Allowed --> |No| LogWarn["Log warning: Illegal transition"]
LogWarn --> ReturnFalse["Return false"]
Allowed --> |Yes| SetStatus["Set task.status = to"]
SetStatus --> ReturnTrue["Return true"]
```

**Diagram sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L154-L174)

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L154-L174)

### Task Creation, Unique IDs, and Deduplication
- Unique IDs: Generated using timestamp plus random suffix.
- Deduplication fingerprint: Built from uri|name|size.
- addUploads(): Skips duplicates already in the queue; creates new tasks with status queued.

```mermaid
flowchart TD
Add(["addUploads(files)"]) --> BuildFp["Build fingerprint for each file"]
BuildFp --> CheckDup{"Duplicate in queue?"}
CheckDup --> |Yes| Skip["Skip file"]
CheckDup --> |No| CreateTask["Create UploadTask with unique id and fingerprint"]
CreateTask --> Enqueue["Push to tasks[]"]
Enqueue --> Notify["notifyListeners(true)"]
Notify --> Seed["Seed up to MAX_CONCURRENT processors"]
```

**Diagram sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L514-L556)

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L514-L556)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L74-L77)

### Automatic Recovery Mechanisms
- Exponential backoff: waiting_retry -> retrying with delays 2^retry + 1 seconds.
- Fatal error detection: schema/Telegram fatal errors are not retried.
- Pause/resume: Cancels server session before resuming; resets progress and retry count.
- Cancel: Aborts in-flight operations and cancels server session.

```mermaid
flowchart TD
Start(["performUpload()"]) --> Init["Init upload session"]
Init --> ChunkLoop{"More chunks?"}
ChunkLoop --> |Yes| SendChunk["Send chunk"]
SendChunk --> UpdateProg["Update bytesUploaded/progress"]
UpdateProg --> ChunkLoop
ChunkLoop --> |No| Complete["POST /files/upload/complete"]
Complete --> Poll["Poll /files/upload/status/:uploadId"]
Poll --> Done{"Status == completed?"}
Done --> |Yes| Success["Mark completed"]
Done --> |No| Error{"Error or Cancelled?"}
Error --> |Yes| Fatal{"Fatal error?"}
Fatal --> |Yes| Fail["Mark failed"]
Fatal --> |No| WaitRetry["Mark waiting_retry, schedule retry"]
Error --> |No| Retry["Mark retrying, processQueue()"]
```

**Diagram sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L676-L760)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L764-L981)

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L676-L760)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L764-L981)

### Server-Side Upload Session Management
- initUpload: Deduplicates by hash, creates upload session, and returns uploadId.
- uploadChunk: Validates chunk ordering, appends to temporary file, tracks received bytes.
- completeUpload: Marks as uploading_to_telegram, then asynchronously uploads to Telegram with semaphore and deduplication.
- cancelUpload: Marks session as cancelled and cleans up.
- checkUploadStatus: Returns progress and status for polling.

```mermaid
sequenceDiagram
participant Mgr as "UploadManager"
participant Ctrl as "Upload Controller"
participant FS as "Temp File"
participant DB as "PostgreSQL"
participant TG as "Telegram"
Mgr->>Ctrl : POST /files/upload/init
Ctrl->>DB : Insert upload session
Ctrl-->>Mgr : {uploadId}
loop chunks
Mgr->>Ctrl : POST /files/upload/chunk
Ctrl->>FS : Append chunk
Ctrl-->>Mgr : Progress update
end
Mgr->>Ctrl : POST /files/upload/complete
Ctrl->>TG : sendFile(chatId, file)
Ctrl->>DB : Insert file (ON CONFLICT)
Mgr->>Ctrl : GET /files/upload/status/ : uploadId
Ctrl-->>Mgr : {status, progress}
```

**Diagram sources**
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L134-L546)

**Section sources**
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L134-L274)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L276-L320)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L322-L488)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L499-L546)

### Common State Sequences

#### Normal Upload Flow
- pending → queued → uploading → completed
- Progress: 0–50% during chunk upload, 50–100% during Telegram delivery polling.

#### Pause/Resume Cycle
- queued → paused → queued → uploading → completed
- On resume, server session is cancelled and recreated; progress and retry count reset.

#### Retry Scenario with Exponential Backoff
- uploading → waiting_retry (network error) → retrying → uploading → completed
- Delay = (2^retry + 1) seconds; maximum 5 retries.

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L558-L585)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L676-L760)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L724-L751)

## Dependency Analysis
- UploadManager depends on:
  - AsyncStorage for persistence.
  - Notifications for Android progress.
  - apiClient/uploadClient for HTTP requests.
  - Expo File System for chunk reading and MD5 hashing.
- UploadContext provides a React provider that subscribes to UploadManager and renders UI updates.
- Server-side controller depends on PostgreSQL for file records and Telegram service for media delivery.

```mermaid
graph LR
UM["UploadManager"] --> AS["AsyncStorage"]
UM --> Notif["Notifications"]
UM --> AX["apiClient/uploadClient"]
UM --> FS["Expo File System"]
UCtx["UploadContext"] --> UM
UI["UploadProgressOverlay"] --> UCtx
AX --> Srv["Server Upload Controller"]
Srv --> DB["PostgreSQL"]
Srv --> TG["Telegram"]
```

**Diagram sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L20-L26)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L12-L123)
- [apiClient.ts](file://app/src/services/apiClient.ts#L31-L42)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L1-L11)

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L20-L26)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L12-L123)
- [apiClient.ts](file://app/src/services/apiClient.ts#L31-L42)
- [upload.controller.ts](file://server/src/controllers/upload.controller.ts#L1-L11)

## Performance Considerations
- Concurrency: Up to 3 simultaneous uploads to match server semaphore and avoid resource exhaustion.
- Chunk size: 5 MB for efficient throughput and reduced overhead.
- Progress accuracy: Real-time progress via onUploadProgress and polling ensures precise byte-accurate progress.
- Throttling: Notification throttling reduces React re-renders during rapid updates.
- Speed computation: Sliding window EMA for upload speed estimation.

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L128-L136)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L132-L135)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L283-L310)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L407-L445)

## Troubleshooting Guide
Common issues and remedies:
- Illegal state transitions: Detected and logged; ensure UI actions follow allowed transitions.
- Duplicate uploads: Fingerprint-based deduplication prevents redundant uploads.
- Fatal Telegram errors: Non-recoverable errors are marked as failed; do not retry.
- Network timeouts: UploadManager retries with exponential backoff; API client also retries on transient errors.
- Paused/resumed tasks: Server session is cancelled before resuming; progress and retry count reset.
- Cancelled tasks: Aborted operations and server session cancellation handled; task cleared after delay.

**Section sources**
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L166-L174)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L514-L556)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L717-L723)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L724-L751)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L558-L585)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L587-L601)
- [UploadManager.ts](file://app/src/services/UploadManager.ts#L648-L674)

## Conclusion
The upload task lifecycle management system provides a robust, stateful, and resilient mechanism for handling uploads. It enforces strict state transitions, supports pause/resume and retry with exponential backoff, prevents duplicates, and integrates tightly with server-side upload sessions and Telegram delivery. The combination of frontend orchestration and backend safeguards ensures reliable progress tracking and recovery across various failure modes.