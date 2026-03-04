# ANYX — Smart Cloud Drive

🚀 **Telegram-powered • Private • Unlimited • Beautiful**

Modern self-hosted cloud storage inspired by Teledrive.  
Upload, organize, preview and stream your files with a smooth React Native mobile experience and reliable Node.js backend.

<p align="center">
  <img src="./axya.png" alt="Axya — Telegram Powered Cloud Drive" width="900"/>
</p>

<h1 align="center">Axya</h1>

<p align="center">
Telegram-Powered Cloud Drive with instant uploads, streaming, and unlimited storage.
</p>
[![GitHub stars](https://img.shields.io/github/stars/your-username/anyx?style=social)](https://github.com/your-username/anyx)
[![GitHub forks](https://img.shields.io/github/forks/your-username/anyx?style=social)](https://github.com/your-username/anyx/fork)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

### File & Folder Management
- Create / rename / delete folders
- Upload any file type (images, videos, documents, archives…)
- Sort by name • date • size (ascending & descending)
- Breadcrumb + smooth folder navigation

### Smart Previews
- Image viewer with horizontal swipe + pinch-to-zoom
- Video streaming with native player controls
- Progressive loading (metadata → thumbnail → full preview)

### Upload Experience
- Background / resumable uploads
- Real-time progress + speed + ETA
- Automatic retry on connection loss
- Pause & resume support

### User Profile
- Storage usage statistics
- File count & quota overview
- Safe profile editing with validation

### UI/UX Details
- Fluid animations (Reanimated 2/3)
- Keyboard-aware forms & scroll views
- Clean minimal design (dark/light mode ready)

## 🏗 Tech Stack

| Layer         | Technology                                 |
|---------------|--------------------------------------------|
| Mobile        | Expo React Native (SDK 54) • TypeScript    |
| Navigation    | React Navigation v6                        |
| Animations    | React Native Reanimated                    |
| Backend       | Node.js + Express                          |
| Database      | PostgreSQL (Neon serverless recommended)   |
| File Storage  | Telegram Bot API (Teledrive-style)         |
| API Client    | Axios + centralized service                |

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- npm / yarn / pnpm
- Expo CLI (`npm install -g expo-cli`)
- Telegram Bot Token + Channel (via @BotFather)

### 1. Clone repository
```bash
git clone https://github.com/your-username/anyx.git
cd anyx
2. Install dependencies
Bash# Frontend (mobile)
cd app
npm install

# Backend
cd ../server
npm install
3. Configure environment
Create server/.env:
envPORT=5000
DATABASE_URL=postgresql://user:pass@your-neon-host.neon.tech/anyx?sslmode=require
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHANNEL_ID=-1001234567890          # or @channelusername
JWT_SECRET=change-this-to-a-very-long-secret
4. Start backend
Bashcd server
npm run dev
5. Start mobile app
Bashcd ../app
npx expo start
# or
npx expo start --dev-client
Open Expo Go or your dev client → scan QR code.
🔧 Recent Improvements

Unified sorting logic (backend + frontend)
Gesture-based image gallery with correct indexing
Proper KeyboardAvoidingView + SafeArea handling
Robust error boundaries & loading states
Centralized API client with interceptors & retries

📊 Data Flow
textMobile App
   ↓ (Axios)
Express API → PostgreSQL (metadata + user info)
   ↓ (Telegram Bot API)
Files stored in private Telegram channel
   ↑
Preview / Stream ← Progressive URLs
⚠️ Current Limitations

iOS/Android may pause background uploads when app is force-quit
Very large videos (>2GB) can buffer slowly on weak connections
No built-in E2E encryption (Telegram cloud storage)

🛤️ Roadmap

 Offline upload queue & auto-sync
 Public & password-protected sharing links
 AI-powered file tagging & smart search
 Multi-account / team folders
 Optional E2EE layer
 Web client (React)

🤝 Contributing
Pull requests welcome!

Fork & create feature branch (git checkout -b feat/amazing-thing)
Commit (git commit -m 'Add amazing thing')
Push (git push origin feat/amazing-thing)
Open Pull Request

Please discuss major changes via issue first.
📜 License
MIT License

ANYX — Your files. Your cloud. No limits.
textJust copy everything inside the ```markdown

Replace placeholders (`your-username`, banner image URL, Telegram values, etc.) with your real information
