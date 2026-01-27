# 🌑 ShadowChat

**ShadowChat** is an anonymous real-time random chat web application that connects two strangers instantly — no login, no profile, no history.  
Just open, connect, and talk.

Inspired by classic random-pairing platforms, ShadowChat focuses on **clean UX**, **privacy**, and **robust real-time behavior**, with modern safety and stability built in.

---

##  Features

### 🎲 Random Anonymous Chat
- Instantly get paired with a random user
- One-to-one, real-time messaging
- Click **↻ Next** anytime to switch partners

### 🔗 Private Rooms
- Create a private room with a unique invite link
- Share the link and chat securely
- Room auto-limits to 2 users only

### 💬 Real-Time Chat Experience
- Typing indicators
- Message delivery & seen status
- Smooth auto-scrolling (mobile friendly)

### 🛡️ Safety & Moderation
- Built-in bad-word filtering (English + Hindi + Hinglish)
- Clean chat enforcement with friendly warnings
- No message storage on server

### ⚡ Stable & UX-Focused
- Graceful handling of disconnects
- Clear partner status updates
- Mobile & tablet optimized
- Network-safe pairing logic

---

## 🧠 How It Works (High Level)

1. User joins **Random Chat** or a **Private Room**
2. Server places users in a waiting queue
3. Two users get paired instantly
4. Messages flow peer-to-peer via Socket.IO
5. On disconnect, the other user is notified immediately

No database.  
No tracking.  
No persistence.

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla JavaScript, HTML, CSS  
- **Backend:** Node.js, Express  
- **Realtime:** Socket.IO (WebSocket transport)  
- **Utilities:** UUID, dotenv  

---

## 📂 Project Structure

shadowchat/
│
├── public/
│ ├── index.html
│ ├── style.css
│ └── script.js
│
├── server.js
├── package.json
└── README.md


---

## ▶️ Getting Started

### 1️⃣ Clone the repository

2️⃣ Install dependencies
npm install
3️⃣ Run the server
node server.js
4️⃣ Open in browser
http://localhost:3000
🌐 Environment Variables (Optional)
Create a .env file if needed:

PORT=3000
ENABLE_NGROK=false
🧪 Status
✅ Fully functional MVP

✅ Production-ready logic

🚧 Future improvements possible (see below)

🔮 Possible Enhancements
Reconnect grace timer

Rate limiting & spam control

AI-based moderation

Message encryption layer

WebRTC voice/video chat

🧑‍💻 Author
Built with ❤️ and overthinking by Sanu Sharma
(Anonymous chat, but not anonymous effort 😉)
