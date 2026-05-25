# ShadowChat 🌑
Anonymous, real-time 1:1 chat — **Random pairing** + **Private rooms** — built with **Node.js + Express + Socket.IO**.  
No login. No profiles. No message storage.

## Table of Contents
- [Demo](#demo)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Install & Run](#install--run)
  - [Environment Variables](#environment-variables)
- [Deployment](#deployment)
  - [Render](#render)
  - [Keep-alive (Avoid Sleeping)](#keep-alive-avoid-sleeping)
- [Security & Privacy Notes](#security--privacy-notes)
- [Roadmap](#roadmap)
- [License](#license)

---

## Demo
- Local: `http://localhost:3000`
- Production (example): `https://shadowchat-4.onrender.com`

> If you host on a free tier (e.g., Render Free), the first request after inactivity may be a cold start.

---

## Key Features

### 🎲 Random Anonymous Chat
- Join a queue and get paired 1:1 with a random user
- Real-time messaging via Socket.IO
- **↻ Next** to immediately switch to a new partner (random mode only)

### 🔗 Private Rooms
- Create a room and share an invite link
- Rooms are limited to **2 users**
- “Room full” handling built-in

### 💬 Real-Time Chat UX
- Typing indicator
- Delivery + seen acknowledgements
- Mobile-friendly auto-scroll and resilient UI states

### 🛡️ Safety & Moderation
- Bad-word filtering (English + Hindi + Hinglish)
- Messages are blocked client-visible with a friendly reason
- No server-side message persistence

### ⚡ Stability / UX-First Behavior
- Clean handling of disconnects (`partnerLeft`)
- Clear connection/waiting states
- Robust pairing logic and queue cleanup

---

## How It Works

1. User selects **Random Chat** or joins/creates a **Private Room**
2. Server either:
   - puts the socket in the random waiting queue, or
   - joins the socket to a private room (max 2)
3. When 2 users are available, the server emits `paired`
4. Messages are relayed in real-time (no database)
5. On disconnect / leave, the partner gets `partnerLeft`

**No database. No accounts. No history.**

---

## Tech Stack
- **Backend:** Node.js, Express
- **Realtime:** Socket.IO (WebSocket transport)
- **Frontend:** Vanilla HTML/CSS/JS
- **Utilities:** `crypto.randomUUID`, `dotenv`

---

## Project Structure
```
shadowchat/
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── server.js
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js 18+ recommended
- npm (comes with Node)

### Install & Run
```bash
# 1) Install dependencies
npm install

# 2) Start the server
node server.js
```

Open:
- `http://localhost:3000`

---

## Environment Variables
Create a `.env` file (optional):

```bash
PORT=3000
ENABLE_NGROK=false
# NGROK_AUTHTOKEN=...
```

- `PORT`: server port (default `3000`)
- `ENABLE_NGROK`: set `true` only if you wire ngrok in

---

## Deployment

### Render
Typical setup:
- Build Command: `npm install`
- Start Command: `node server.js`

Make sure WebSocket is allowed (Render supports it for web services).

### Keep-alive (Avoid Sleeping)
If your Render instance sleeps (free tier), create a lightweight endpoint:

```js
app.get("/health", (req, res) => res.status(200).send("ok"));
```

Then configure an external uptime/cron service (e.g., cron-job.org) to ping:

- `https://<your-app>.onrender.com/health`
- Every **5 minutes**
- Method: **GET**

---

## Security & Privacy Notes
- ShadowChat is designed to be anonymous, but **anonymity is not a security boundary**.
- Messages are filtered for bad words, but moderation is not perfect.
- No chat history is stored by default; however:
  - hosting providers may log requests
  - Socket.IO traffic is still network traffic (use HTTPS/WSS in production)

If you plan to run this publicly, consider:
- Rate limiting and spam control
- Abuse reporting / blocking
- Stricter content moderation
- Uploading media to storage (S3/Cloudinary) instead of sending base64

---

## Roadmap
Ideas for future improvements:
- Reconnect grace timer (short window to rejoin the same partner)
- Rate limiting + anti-spam
- Better moderation pipeline (regex + ML / external service)
- Optional message encryption layer
- Proper message types (`text`, `image`, `audio`) and media URLs (instead of base64)

---

## License
Add your license of choice (MIT is common).  
If you don’t have one yet, create a `LICENSE` file and update this section.