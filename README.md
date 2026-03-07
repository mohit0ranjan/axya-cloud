
<h1 align="center">ANYX — Smart Telegram-Powered Cloud Drive </h1>
<p align="center">
  <img src="./axya.png" alt="Axya — Telegram Powered Cloud Drive" width="900"/>
</p>

<h1 align="center">Axya</h1>

<p align="center">
Telegram-Powered Cloud Drive with instant uploads, streaming, and unlimited storage.
</p>>

<p align="center">
  <b>Private • Unlimited • Self-Hosted Cloud Storage</b><br/>
  Turn Telegram into your personal unlimited cloud drive.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-React%20Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB"/>
  <img src="https://img.shields.io/badge/Backend-Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/Framework-Express-000000?style=for-the-badge&logo=express&logoColor=white"/>
  <img src="https://img.shields.io/badge/Database-PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white"/>
  <img src="https://img.shields.io/badge/Storage-Telegram%20API-26A5E4?style=for-the-badge&logo=telegram&logoColor=white"/>
  <img src="https://img.shields.io/badge/Mobile-Expo-000020?style=for-the-badge&logo=expo&logoColor=white"/>
</p>

---

# ✨ What is ANYX?

**ANYX** is a self-hosted cloud storage system that uses **Telegram as the storage backend**.

Instead of paying for Google Drive or Dropbox subscriptions, ANYX stores files inside your **private Telegram channel** while giving you a **modern cloud-drive interface** via a mobile app.

Think of it as:

> **Google Drive + Telegram + Self Hosting**

ANYX provides unlimited cloud storage, modern UI, and full control over your files.

---

# 🚀 Key Highlights

• Unlimited storage via Telegram
• Self-hosted backend
• Modern React Native mobile app
• Video streaming and media preview
• Folder-based organization
• Background uploads and resumable transfers

---

# 📱 App Preview

<p align="center">
  <img src="docs/screenshots/home.png" width="260"/>
  <img src="docs/screenshots/upload.png" width="260"/>
  <img src="docs/screenshots/video.png" width="260"/>
</p>

Example screens:

• Folder navigation
• Upload progress
• Media streaming

*(Replace with real screenshots or GIF demos for best results.)*

---

# ⚙️ How It Works

```
Mobile App (React Native)
        │
        │ REST API
        ▼
Backend Server (Node.js + Express)
        │
        ├── PostgreSQL (metadata)
        │
        ▼
Telegram Bot API
        │
        ▼
Private Telegram Channel
(File storage)
```

Workflow:

1. User uploads file in ANYX app
2. Backend processes the upload
3. Telegram bot uploads file to private channel
4. File metadata stored in PostgreSQL
5. App streams or downloads files directly

Telegram acts as the **actual storage engine**, while ANYX manages structure and access.

---

# 🌟 Features

## 📂 File Management

• Create and manage folders
• Rename, move, and delete files
• Sort files by name, size, or date
• Breadcrumb navigation

---

## 🎥 Media Preview

• Image gallery with zoom support
• Built-in video player
• Progressive media loading

---

## ⬆️ Upload Engine

• Background uploads
• Pause and resume support
• Auto retry on connection failure
• Upload speed and progress stats

---

## 📊 User Dashboard

• Storage usage overview
• File statistics
• Account settings

---

## 🎨 Modern UX

• Smooth animations using Reanimated
• Dark mode support
• Mobile optimized layout
• Responsive UI

---

# 🧠 ANYX Philosophy

ANYX is built on a simple idea:

> **Your data should belong to you.**

Traditional cloud services impose limits and monthly subscriptions.
ANYX leverages Telegram infrastructure to provide **free, unlimited storage while maintaining control and privacy**.

Core principles:

• Ownership of data
• Open source transparency
• Self-hosted freedom
• Mobile-first experience

---

# ⚔️ Comparison

| Feature           | ANYX | Google Drive | Dropbox |
| ----------------- | ---- | ------------ | ------- |
| Unlimited storage | ✅    | ❌            | ❌       |
| Self-hosted       | ✅    | ❌            | ❌       |
| Telegram powered  | ✅    | ❌            | ❌       |
| Mobile app        | ✅    | ✅            | ✅       |
| Free              | ✅    | ❌            | ❌       |

---

# 🛠 Tech Stack

| Layer      | Technology              |
| ---------- | ----------------------- |
| Mobile     | Expo React Native       |
| Language   | TypeScript              |
| Navigation | React Navigation        |
| Animations | React Native Reanimated |
| Backend    | Node.js + Express       |
| Database   | PostgreSQL              |
| Storage    | Telegram Bot API        |
| Networking | Axios                   |

---

# 📡 API Overview

Example backend endpoints.

### Authentication

```
POST /auth/register
POST /auth/login
GET /auth/me
```

### Files

```
GET /files
POST /files/upload
DELETE /files/:id
GET /files/:id/stream
```

### Folders

```
GET /folders
POST /folders
DELETE /folders/:id
PATCH /folders/:id
```

---

# 📦 Project Structure

```
anyx
│
├── app
│   ├── screens
│   ├── components
│   ├── hooks
│   └── services
│
├── server
│   ├── routes
│   ├── controllers
│   ├── middleware
│   └── utils
│
├── docs
│   └── screenshots
│
└── README.md
```

---

# 🚀 Quick Start

## 1. Clone Repository

```bash
git clone https://github.com/your-username/anyx.git
cd anyx
```

---

## 2. Install Dependencies

Node runtime (required):

```bash
nvm use 20
node -v
```

Mobile app

```bash
cd app
npm install
```

Backend

```bash
cd server
npm install
```

---

## 3. Configure Environment

Create from template:

```
cp server/.env.example server/.env
cp app/.env.example app/.env
```

Minimum required values:

```
DATABASE_URL=postgresql://user:password@host/db
JWT_SECRET=supersecret
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=your_string_session
```

Production-only required:

```
NODE_ENV=production
COOKIE_SECRET=separate-strong-cookie-secret
```

---

## 4. Run Development

Backend

```
cd server
npm run dev
```

Mobile

```
cd app
npx expo start
```

Scan QR code using **Expo Go**.

---

# ☁️ Deployment

Recommended infrastructure.

Backend

• Railway
• Render
• Fly.io
• VPS

Database

• Neon
• Supabase
• PostgreSQL

Mobile Build

```
eas build
```

---

# 🔐 Security

• Files stored in private Telegram channel
• JWT authentication
• HTTPS recommended in production
• No analytics or tracking

---

# 🛤 Roadmap

Upcoming features:

• Web client interface
• Offline upload queue
• Public share links
• Multi-user collaboration
• AI file search
• Client-side encryption

---

# 🤝 Contributing

Contributions are welcome.

1. Fork repository
2. Create feature branch
3. Commit changes
4. Push branch
5. Open pull request

---

# ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=your-username/anyx\&type=Date)](https://star-history.com/#your-username/anyx)

---

# 📜 License

MIT License

---

<p align="center">
Built with ❤️ in Punjab
</p>

<p align="center">
⭐ Star the project if you find it useful
</p>
