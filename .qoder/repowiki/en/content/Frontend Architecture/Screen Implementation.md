# Screen Implementation

<cite>
**Referenced Files in This Document**
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx)
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx)
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx)
- [ProfileScreen.tsx](file://app/src/screens/ProfileScreen.tsx)
- [SettingsScreen.tsx](file://app/src/screens/SettingsScreen.tsx)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx)
- [MainTabs.tsx](file://app/src/navigation/MainTabs.tsx)
- [apiClient.ts](file://app/src/services/apiClient.ts)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx)
- [FileCard.tsx](file://app/src/components/FileCard.tsx)
- [Skeleton.tsx](file://app/src/ui/Skeleton.tsx)
- [StarredScreen.tsx](file://app/src/screens/StarredScreen.tsx)
- [TrashScreen.tsx](file://app/src/screens/TrashScreen.tsx)
- [AnalyticsScreen.tsx](file://app/src/screens/AnalyticsScreen.tsx)
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
This document provides a comprehensive guide to the screen implementation across the application’s core screens. It explains screen structure patterns, data fetching strategies, user interaction handling, navigation integration, state management, and performance optimizations for HomeScreen, FilesScreen, FoldersScreen, ProfileScreen, SettingsScreen, and FilePreviewScreen. The goal is to help developers understand how each screen is built, how they interact with APIs and contexts, and how to maintain and extend them effectively.

## Project Structure
The screens are organized under app/src/screens and integrated via a bottom-tab navigator. Each screen encapsulates its UI, state, and interactions while leveraging shared services and contexts for authentication, theming, caching, and uploads.

```mermaid
graph TB
subgraph "Navigation Layer"
Tabs["MainTabs Navigator"]
end
subgraph "Screens"
Home["HomeScreen"]
Files["FilesScreen"]
Folders["FoldersScreen"]
Starred["StarredScreen"]
Profile["ProfileScreen"]
Settings["SettingsScreen"]
Preview["FilePreviewScreen"]
end
subgraph "Services & Contexts"
ApiClient["apiClient"]
Cache["ApiCacheStore"]
Upload["UploadContext"]
Theme["ThemeContext"]
Toast["ToastContext"]
Auth["AuthContext"]
end
Tabs --> Home
Tabs --> Files
Tabs --> Folders
Tabs --> Starred
Tabs --> Profile
Home --> Files
Home --> Folders
Home --> Preview
Files --> Preview
Starred --> Preview
Profile --> Settings
Preview --> Files
Preview --> Folders
Home --> ApiClient
Home --> Cache
Home --> Upload
Home --> Theme
Home --> Toast
Home --> Auth
Files --> ApiClient
Files --> Theme
Files --> Toast
Files --> Auth
Folders --> ApiClient
Folders --> Theme
Folders --> Toast
Starred --> ApiClient
Starred --> Theme
Starred --> Toast
Starred --> Auth
Profile --> ApiClient
Profile --> Theme
Profile --> Toast
Profile --> Auth
Settings --> ApiClient
Settings --> Theme
Settings --> Toast
Settings --> Auth
Preview --> ApiClient
Preview --> Theme
Preview --> Toast
Preview --> Upload
```

**Diagram sources**
- [MainTabs.tsx](file://app/src/navigation/MainTabs.tsx#L76-L89)
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx#L360-L520)
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L55-L100)
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx#L35-L101)
- [StarredScreen.tsx](file://app/src/screens/StarredScreen.tsx#L44-L68)
- [ProfileScreen.tsx](file://app/src/screens/ProfileScreen.tsx#L78-L115)
- [SettingsScreen.tsx](file://app/src/screens/SettingsScreen.tsx#L52-L74)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L314-L396)
- [apiClient.ts](file://app/src/services/apiClient.ts#L31-L42)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L51-L114)

**Section sources**
- [MainTabs.tsx](file://app/src/navigation/MainTabs.tsx#L76-L89)

## Core Components
- Navigation integration: Screens are registered in a bottom-tab navigator with a custom tab bar and a floating action button.
- Data fetching: Centralized via apiClient with automatic JWT injection and retry logic.
- State management: Local state per screen plus shared Zustand cache store for home data and upload context for global upload state.
- UI patterns: Consistent theming, skeleton loaders, and reusable components like FileCard.

**Section sources**
- [MainTabs.tsx](file://app/src/navigation/MainTabs.tsx#L14-L74)
- [apiClient.ts](file://app/src/services/apiClient.ts#L46-L84)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L51-L114)

## Architecture Overview
The screens follow a layered architecture:
- Presentation layer: React components rendering UI and handling user interactions.
- State layer: React hooks and Zustand stores for local and global state.
- Service layer: apiClient for HTTP requests and UploadManager via UploadContext.
- Integration layer: Navigation integration and cross-screen communication via params and navigation helpers.

```mermaid
sequenceDiagram
participant User as "User"
participant Home as "HomeScreen"
participant Cache as "ApiCacheStore"
participant API as "apiClient"
participant Nav as "Navigation"
User->>Home : Open Home
Home->>Cache : Read cached homeData
alt Cache present
Home->>Home : Populate UI instantly
else Cache empty
Home->>API : GET /files/stats, /files, /files/folders, /files/recent-accessed, /files/activity
API-->>Home : Data
Home->>Cache : Persist homeData
end
Home->>Nav : Navigate to Files/Folders/Preview on item press
```

**Diagram sources**
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx#L441-L517)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)
- [apiClient.ts](file://app/src/services/apiClient.ts#L87-L132)

## Detailed Component Analysis

### HomeScreen
- Purpose: Dashboard showing storage summary, recent files, folders, and activity.
- Data fetching: Uses a staggered strategy on cold start and parallel on warm cache; integrates with ApiCacheStore for instant hydration.
- Interactions: Search, refresh, FAB upload, create/rename folder, pin/unpin folders, navigate to previews.
- State management: Local state for UI, search, and pinned folders persisted to AsyncStorage; integrates with UploadContext for global upload status.
- UX patterns: Animated counters, skeleton placeholders, and a bottom tab bar with a floating action button.

```mermaid
flowchart TD
Start(["HomeScreen Mount"]) --> CheckCache["Check ApiCacheStore.homeData"]
CheckCache --> |Present| Hydrate["Hydrate UI from cache"]
CheckCache --> |Missing| Stagger["Staggered parallel requests"]
Stagger --> Parallel["Parallel requests after core data"]
Parallel --> Persist["Persist to cache"]
Hydrate --> Ready["Ready"]
Persist --> Ready
Ready --> UserActions["User Actions<br/>Search/Refresh/FAB/Pin/Preview"]
```

**Diagram sources**
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx#L441-L517)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)

**Section sources**
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx#L360-L520)
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx#L524-L580)
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx#L582-L594)
- [HomeScreen.tsx](file://app/src/screens/HomeScreen.tsx#L648-L696)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)

### FilesScreen
- Purpose: Browse and manage all files with sorting, filtering, search, and actions.
- Data fetching: Server-side sorting via query parameters; client-side filtering and pagination-like behavior via displayLimit.
- Interactions: Sort modal, search bar, filter tabs, open preview, star/trash actions, and refresh control.
- Performance: getItemLayout for fast scrolling, onEndReached for lazy loading, and skeleton placeholders.

```mermaid
sequenceDiagram
participant User as "User"
participant Files as "FilesScreen"
participant API as "apiClient"
participant Nav as "Navigation"
User->>Files : Open All Files
Files->>API : GET /files?limit=500&sort=col&order=dir
API-->>Files : files[]
Files->>Files : Filter by type + search
User->>Files : Tap file
Files->>Nav : navigate('FilePreview', { files, initialIndex })
```

**Diagram sources**
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L88-L100)
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L103-L108)
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L138-L147)

**Section sources**
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L55-L100)
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L102-L108)
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L137-L147)
- [FilesScreen.tsx](file://app/src/screens/FilesScreen.tsx#L224-L264)

### FoldersScreen
- Purpose: Manage folders with creation, renaming, pinning to Home, and sharing.
- Data fetching: Server-side sorting; loads folders and applies local search.
- Interactions: Sort modal, create/rename modals, long-press menu (platform-specific), and share modal.
- UX patterns: Grid layout, skeleton placeholders, and persistent pinned folder IDs via AsyncStorage.

```mermaid
sequenceDiagram
participant User as "User"
participant Folders as "FoldersScreen"
participant API as "apiClient"
participant Storage as "AsyncStorage"
User->>Folders : Open Folders
Folders->>API : GET /files/folders?sort=col&order=dir
API-->>Folders : folders[]
User->>Folders : Create/Rename/Pin/Share
Folders->>API : POST/PATCH/DELETE
Folders->>Storage : Persist pinned folder IDs
```

**Diagram sources**
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx#L84-L101)
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx#L103-L129)
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx#L131-L152)

**Section sources**
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx#L35-L101)
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx#L103-L152)
- [FoldersScreen.tsx](file://app/src/screens/FoldersScreen.tsx#L154-L203)

### ProfileScreen
- Purpose: User profile, stats, quick access, settings, and recent activity.
- Data fetching: Parallel fetch for stats and activity; animated entrance.
- Interactions: Quick access to Files, Starred, Folders, Trash, Analytics; logout confirmation; security note.
- UX patterns: Animated scroll reveal, stat tiles, and recent activity list.

```mermaid
sequenceDiagram
participant User as "User"
participant Profile as "ProfileScreen"
participant API as "apiClient"
participant Auth as "AuthContext"
User->>Profile : Open Profile
Profile->>API : GET /files/stats, /files/activity
API-->>Profile : stats, activity
User->>Profile : Tap quick access/settings
Profile->>Auth : logout()
```

**Diagram sources**
- [ProfileScreen.tsx](file://app/src/screens/ProfileScreen.tsx#L101-L115)
- [ProfileScreen.tsx](file://app/src/screens/ProfileScreen.tsx#L117-L134)

**Section sources**
- [ProfileScreen.tsx](file://app/src/screens/ProfileScreen.tsx#L78-L115)
- [ProfileScreen.tsx](file://app/src/screens/ProfileScreen.tsx#L117-L134)
- [ProfileScreen.tsx](file://app/src/screens/ProfileScreen.tsx#L315-L354)

### SettingsScreen
- Purpose: Minimal settings with preferences, storage, insights, security, and account management.
- Interactions: Toggle notifications, dark mode, storage analytics, shared links, sign out, and delete account.
- UX patterns: Pressable rows with scaling feedback, animated entrance, and danger zone styling.

```mermaid
sequenceDiagram
participant User as "User"
participant Settings as "SettingsScreen"
participant API as "apiClient"
participant Auth as "AuthContext"
User->>Settings : Open Settings
User->>Settings : Toggle dark mode / notifications
User->>Settings : Delete Account
Settings->>API : DELETE /auth/account
Settings->>Auth : logout()
```

**Diagram sources**
- [SettingsScreen.tsx](file://app/src/screens/SettingsScreen.tsx#L81-L94)
- [SettingsScreen.tsx](file://app/src/screens/SettingsScreen.tsx#L96-L131)

**Section sources**
- [SettingsScreen.tsx](file://app/src/screens/SettingsScreen.tsx#L52-L74)
- [SettingsScreen.tsx](file://app/src/screens/SettingsScreen.tsx#L81-L94)
- [SettingsScreen.tsx](file://app/src/screens/SettingsScreen.tsx#L114-L131)

### FilePreviewScreen
- Purpose: Unified preview for images, videos, PDFs, Office documents, and generic files.
- Data fetching: Uses JWT from AsyncStorage; streams media via API endpoints.
- Interactions: Horizontal swipe, pinch-to-zoom for images, video player, PDF open button, share link, move, rename, trash, and download.
- Performance: FlatList with getItemLayout, removeClippedSubviews, and window sizing; gesture handling for zoom; WebView sandboxing.

```mermaid
sequenceDiagram
participant User as "User"
participant Preview as "FilePreviewScreen"
participant API as "apiClient"
participant Download as "DownloadContext"
participant Nav as "Navigation"
User->>Preview : Open preview
Preview->>API : GET /files/{id}/download or /stream/{id}
API-->>Preview : Stream/Download URL
User->>Preview : Tap actions (Star/Trash/Download/Share/Move/Rename)
Preview->>API : PATCH /files/{id}/star, /files/{id}/trash, /files/bulk
Preview->>Download : addDownload(...)
Preview->>Nav : goBack()
```

**Diagram sources**
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L389-L396)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L398-L421)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L423-L429)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L431-L447)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L449-L457)

**Section sources**
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L314-L396)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L398-L457)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L459-L536)
- [FilePreviewScreen.tsx](file://app/src/screens/FilePreviewScreen.tsx#L614-L644)

## Dependency Analysis
- Navigation: MainTabs registers screens and exposes a custom tab bar with a floating action button.
- Services: apiClient centralizes base URL, timeouts, JWT injection, and retry logic.
- State: ApiCacheStore provides a single source of truth for home data; UploadContext manages upload tasks globally.
- UI: FileCard is reused across screens; Skeleton provides consistent loading states.

```mermaid
graph LR
MainTabs["MainTabs"] --> Home["HomeScreen"]
MainTabs --> Files["FilesScreen"]
MainTabs --> Folders["FoldersScreen"]
MainTabs --> Starred["StarredScreen"]
MainTabs --> Profile["ProfileScreen"]
Home --> ApiClient["apiClient"]
Files --> ApiClient
Folders --> ApiClient
Starred --> ApiClient
Profile --> ApiClient
Home --> Cache["ApiCacheStore"]
Home --> Upload["UploadContext"]
Files --> FileCard["FileCard"]
Folders --> FileCard
Starred --> FileCard
Preview["FilePreviewScreen"] --> FileCard
```

**Diagram sources**
- [MainTabs.tsx](file://app/src/navigation/MainTabs.tsx#L76-L89)
- [apiClient.ts](file://app/src/services/apiClient.ts#L31-L42)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L51-L114)
- [FileCard.tsx](file://app/src/components/FileCard.tsx#L32-L92)

**Section sources**
- [MainTabs.tsx](file://app/src/navigation/MainTabs.tsx#L76-L89)
- [apiClient.ts](file://app/src/services/apiClient.ts#L31-L42)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L51-L114)
- [FileCard.tsx](file://app/src/components/FileCard.tsx#L32-L92)

## Performance Considerations
- HomeScreen
  - Staggered requests on cold start to avoid overwhelming the server.
  - Parallel requests when cache is warm to minimize perceived latency.
  - Animated counters and skeleton loaders improve perceived performance.
- FilesScreen
  - getItemLayout for O(1) scroll performance.
  - onEndReached with displayLimit simulates pagination and reduces DOM nodes.
  - Debounced markAccessed to avoid frequent network calls.
- FoldersScreen
  - Grid layout with fixed card widths and skeleton placeholders.
  - Local search and server-side sorting reduce payload sizes.
- FilePreviewScreen
  - FlatList with getItemLayout and window sizing for smooth horizontal swiping.
  - Gesture-based zoom with spring animations; WebView sandboxing restricts external URLs.
  - removeClippedSubviews and limited batch rendering reduce memory footprint.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- Authentication failures
  - Ensure JWT is present in AsyncStorage; apiClient injects Authorization headers automatically.
  - Check request interceptors for errors and retry logic.
- Network timeouts and retries
  - apiClient sets timeouts and retries based on shouldRetry; review logs for retry attempts.
- Server waking UI
  - ServerStatusContext triggers a “waking” overlay when requests exceed 2 seconds; dismisses on response.
- Upload issues
  - UploadContext manages upload lifecycle; verify AppState events resume uploads when app becomes active.
- Cache inconsistencies
  - ApiCacheStore.setHomeData updates cached home data; clear cache if stale data appears.

**Section sources**
- [apiClient.ts](file://app/src/services/apiClient.ts#L46-L84)
- [apiClient.ts](file://app/src/services/apiClient.ts#L100-L131)
- [UploadContext.tsx](file://app/src/context/UploadContext.tsx#L62-L72)
- [ApiCacheStore.ts](file://app/src/context/ApiCacheStore.ts#L16-L27)

## Conclusion
The screen implementations demonstrate a cohesive pattern: centralized service layer, shared state management, and consistent UI components. Each screen balances user experience with performance through thoughtful data fetching strategies, skeleton loaders, and optimized rendering. The navigation integration via MainTabs ensures seamless transitions, while contexts like ApiCacheStore and UploadContext enable scalable state management across screens.