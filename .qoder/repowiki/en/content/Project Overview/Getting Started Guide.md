# Getting Started Guide

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [package.json](file://package.json)
- [server/package.json](file://server/package.json)
- [app/package.json](file://app/package.json)
- [server/src/index.ts](file://server/src/index.ts)
- [server/src/config/db.ts](file://server/src/config/db.ts)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts)
- [server/src/generateSession.ts](file://server/src/generateSession.ts)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts)
- [app/app.json](file://app/app.json)
- [app/eas.json](file://app/eas.json)
- [Procfile](file://Procfile)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Environment Configuration](#environment-configuration)
5. [Development Workflow](#development-workflow)
6. [Architecture Overview](#architecture-overview)
7. [Detailed Component Analysis](#detailed-component-analysis)
8. [Dependency Analysis](#dependency-analysis)
9. [Performance Considerations](#performance-considerations)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [Conclusion](#conclusion)

## Introduction
This guide helps you set up ANYX locally for development. ANYX is a self-hosted cloud storage system that uses Telegram as the storage backend, with a modern React Native mobile app and a Node.js + Express backend backed by PostgreSQL. You will configure environment variables, initialize the database, and run both the backend server and the mobile app.

## Prerequisites
- Node.js: The backend expects Node.js 20.x as defined by the server’s engines field.
- PostgreSQL: Required for storing metadata. You can use a local instance or a hosted provider.
- Telegram account and a Telegram bot: You will need a bot token and a private Telegram channel to store files.
- Expo CLI: Used to run the mobile app in development.

Section sources
- [server/package.json](file://server/package.json#L16-L18)
- [README.md](file://README.md#L178-L189)

## Installation
Follow these steps to install and prepare the project locally.

1. Clone the repository
   - Use the repository URL and clone it to your machine.
   - Navigate into the project directory.

2. Install backend dependencies
   - Change into the server directory and install dependencies.

3. Install mobile app dependencies
   - Change into the app directory and install dependencies.

Section sources
- [README.md](file://README.md#L250-L276)
- [server/package.json](file://server/package.json#L6-L11)
- [app/package.json](file://app/package.json#L5-L10)

## Environment Configuration
Create a .env file in the server directory with the following keys and values. These are essential for the backend to connect to PostgreSQL, Telegram, and to serve the app securely.

- PORT
  - Description: The port the backend listens on.
  - Example value: 5000
  - Notes: Defaults to 3000 in code if unspecified.

- DATABASE_URL
  - Description: PostgreSQL connection string for metadata storage.
  - Example value: postgresql://user:password@host/db
  - Notes: Required. The code validates this variable and logs a critical error if missing.

- TELEGRAM_API_ID
  - Description: Your Telegram API ID.
  - Example value: 12345678
  - Notes: Required for Telegram client initialization.

- TELEGRAM_API_HASH
  - Description: Your Telegram API hash.
  - Example value: abcdefghijklmnopqrstuvwxyz123456
  - Notes: Required for Telegram client initialization.

- TELEGRAM_SESSION
  - Description: A serialized session string for Telegram authentication.
  - Example value: AAAAAAA...
  - Notes: Required. Use the included script to generate this session string.

- TELEGRAM_CHANNEL_ID
  - Description: Private Telegram channel identifier where files are stored.
  - Example value: -100xxxxxxxxxx
  - Notes: Required for uploads and retrieval.

- JWT_SECRET
  - Description: Secret used to sign JWT tokens.
  - Example value: supersecret
  - Notes: Recommended to change from defaults.

- COOKIE_SECRET
  - Description: Secret used to sign cookies.
  - Example value: axya_default_secret
  - Notes: Defaults to a placeholder if not provided.

- ALLOWED_ORIGINS
  - Description: Comma-separated list of allowed CORS origins.
  - Example value: http://localhost:8081,http://localhost:3000
  - Notes: Defaults to localhost ports if not provided.

- EXPO_PUBLIC_API_URL
  - Description: Base URL for the backend API used by the mobile app.
  - Example value: http://localhost:3000
  - Notes: If omitted, the app uses platform-specific local URLs in development.

Section sources
- [README.md](file://README.md#L279-L300)
- [server/src/config/db.ts](file://server/src/config/db.ts#L7-L12)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts#L7-L10)
- [server/src/index.ts](file://server/src/index.ts#L63-L83)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L14-L22)

## Development Workflow
Run the backend server and the mobile app locally, then connect them.

1. Start the backend server
   - Change into the server directory and run the development script.
   - The server initializes the database schema and starts listening on the configured port.

2. Generate a Telegram session string
   - Use the provided script to authenticate with Telegram and print a session string.
   - Copy the printed session string and set TELEGRAM_SESSION in your .env file.

3. Start the mobile app
   - Change into the app directory and start the Expo dev server.
   - Scan the QR code with the Expo Go app on your device or use an emulator.

4. Connect the app to the local backend
   - Ensure the app resolves the backend URL correctly. In development, the app uses localhost by default, or you can override with EXPO_PUBLIC_API_URL.

Section sources
- [README.md](file://README.md#L303-L321)
- [server/src/index.ts](file://server/src/index.ts#L295-L312)
- [server/src/generateSession.ts](file://server/src/generateSession.ts#L13-L35)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L14-L22)

## Architecture Overview
The local development architecture connects the mobile app to the backend, which persists metadata in PostgreSQL and stores files in a Telegram channel.

```mermaid
graph TB
subgraph "Mobile App (Expo RN)"
A_UI["App UI"]
A_API["API Client<br/>EXPO_PUBLIC_API_URL"]
end
subgraph "Backend Server (Node.js + Express)"
B_Index["Express App"]
B_DB["PostgreSQL Pool"]
B_Telegram["Telegram Client"]
end
subgraph "External Services"
T_Channel["Telegram Channel"]
end
A_UI --> A_API
A_API --> B_Index
B_Index --> B_DB
B_Index --> B_Telegram
B_Telegram --> T_Channel
```

Diagram sources
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L14-L22)
- [server/src/index.ts](file://server/src/index.ts#L108-L221)
- [server/src/config/db.ts](file://server/src/config/db.ts#L27-L37)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts#L12-L14)

## Detailed Component Analysis

### Backend Server Initialization
The server performs health checks, applies database schema and migrations, and exposes REST endpoints. It also sets up security middleware, CORS, rate limiting, and graceful shutdown.

```mermaid
sequenceDiagram
participant Dev as "Developer"
participant Srv as "server/src/index.ts"
participant DB as "server/src/config/db.ts"
participant MIG as "server/src/services/db.service.ts"
Dev->>Srv : Start server (npm run dev)
Srv->>Srv : Load env vars (.env)
Srv->>DB : Initialize connection pool
Srv->>MIG : initSchema()
MIG->>DB : Apply schema and migrations
Srv->>Srv : Register routes and middleware
Srv-->>Dev : Listen on PORT
```

Diagram sources
- [server/src/index.ts](file://server/src/index.ts#L295-L312)
- [server/src/config/db.ts](file://server/src/config/db.ts#L27-L37)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L3-L312)

Section sources
- [server/src/index.ts](file://server/src/index.ts#L25-L100)
- [server/src/services/db.service.ts](file://server/src/services/db.service.ts#L3-L312)

### Telegram Session Generation
The session generation script authenticates with Telegram and prints a session string for reuse.

```mermaid
sequenceDiagram
participant Dev as "Developer"
participant Gen as "server/src/generateSession.ts"
participant Tel as "Telegram API"
Dev->>Gen : Run script
Gen->>Tel : Authenticate (phone, 2FA, OTP)
Tel-->>Gen : Authenticated client
Gen-->>Dev : Print session string (TELEGRAM_SESSION)
```

Diagram sources
- [server/src/generateSession.ts](file://server/src/generateSession.ts#L13-L35)

Section sources
- [server/src/generateSession.ts](file://server/src/generateSession.ts#L1-L36)

### Mobile App API Client
The mobile app determines the backend base URL based on environment variables and platform. It injects JWT tokens into requests and handles retries.

```mermaid
flowchart TD
Start(["App Start"]) --> CheckEnv["Check EXPO_PUBLIC_API_URL"]
CheckEnv --> HasEnv{"Env set?"}
HasEnv --> |Yes| UseEnv["Use EXPO_PUBLIC_API_URL"]
HasEnv --> |No| Platform{"Platform?"}
Platform --> |Web| UseWeb["Use http://localhost:PORT"]
Platform --> |Native Dev| UseLocal["Use platform-specific localhost"]
Platform --> |Prod| UseProd["Use production URL"]
UseEnv --> SetBase["Set API base URL"]
UseWeb --> SetBase
UseLocal --> SetBase
UseProd --> SetBase
SetBase --> InjectToken["Inject JWT token on requests"]
InjectToken --> SendReq["Send request with retry logic"]
```

Diagram sources
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L14-L22)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L46-L84)

Section sources
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L1-L164)

## Dependency Analysis
The project is split into three main areas: the root scripts, the backend server, and the mobile app. The backend depends on Express, PostgreSQL, and Telegram libraries. The mobile app depends on Expo and various React Native packages.

```mermaid
graph TB
Root["Root Scripts (package.json)"]
S_Pkg["server/package.json"]
A_Pkg["app/package.json"]
Root --> S_Pkg
Root --> A_Pkg
```

Diagram sources
- [package.json](file://package.json#L2-L5)
- [server/package.json](file://server/package.json#L6-L11)
- [app/package.json](file://app/package.json#L5-L10)

Section sources
- [package.json](file://package.json#L1-L19)
- [server/package.json](file://server/package.json#L1-L57)
- [app/package.json](file://app/package.json#L1-L59)

## Performance Considerations
- Database connection pooling: The backend uses a connection pool tuned for low-memory environments and quick idle release.
- Rate limiting: Global and auth-specific rate limits protect the server from abuse.
- Upload timeouts: Upload requests have a higher timeout to accommodate large files.

Section sources
- [server/src/config/db.ts](file://server/src/config/db.ts#L27-L37)
- [server/src/index.ts](file://server/src/index.ts#L85-L98)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L36-L42)

## Troubleshooting Guide
- DATABASE_URL missing
  - Symptom: Critical error logged indicating DATABASE_URL is not defined.
  - Action: Set DATABASE_URL in your .env file.

- Telegram authentication issues
  - Symptom: Telegram client connects but requires login (OTP).
  - Action: Run the session generation script to obtain a session string and set TELEGRAM_SESSION.

- CORS errors in development
  - Symptom: Requests blocked due to origin mismatch.
  - Action: Set ALLOWED_ORIGINS to include your frontend origins.

- Mobile app cannot reach backend
  - Symptom: Network errors or timeouts.
  - Action: Ensure EXPO_PUBLIC_API_URL points to your local backend or rely on default local URLs in development.

- Database SSL or timeout errors
  - Symptom: SSL-related or timeout errors when connecting to hosted databases.
  - Action: Adjust DATABASE_URL sslmode parameter or verify network connectivity.

Section sources
- [server/src/config/db.ts](file://server/src/config/db.ts#L9-L12)
- [server/src/config/telegram.ts](file://server/src/config/telegram.ts#L16-L28)
- [server/src/index.ts](file://server/src/index.ts#L63-L77)
- [app/src/services/apiClient.ts](file://app/src/services/apiClient.ts#L14-L22)
- [server/src/config/db.ts](file://server/src/config/db.ts#L40-L52)

## Conclusion
You now have the essentials to run ANYX locally: Node.js 20.x, PostgreSQL, a Telegram bot and private channel, and the environment variables configured. Start the backend, generate the Telegram session, and launch the mobile app. If you encounter issues, refer to the troubleshooting section for targeted fixes.