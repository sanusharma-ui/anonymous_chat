// server.js - No changes needed for this feature (client-side only)
// The server already emits 'partnerLeft' correctly on disconnect.
// If you need server-side tweaks, let me know.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
require('dotenv').config();
// const ngrok = require("@ngrok/ngrok"); // optional, keep commented if not using

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  maxHttpBufferSize: 1e7,
  cors: { origin: "*" },
});

app.use(express.static("public"));

// --- Bad words (keep and expand if needed) ----------------
const englishBadWords = [
  'fuck', 'shit', 'ass', 'asshole', 'bitch', 'bastard', 'cock', 'pussy', 'cunt', 'dick',
  'bollocks', 'bugger', 'wanker', 'twat', 'prick', 'slut', 'whore', 'choad', 'shag'
];
const hindiBadWords = [
  'madarchod', 'maderchod', 'behenchod', 'bhenchod', 'bahenchod', 'chutiya', 'chutiye',
  'bhosdi', 'bhosda', 'bhonsda', 'randi', 'rand', 'gandu', 'gand', 'lund', 'loda', 'lauda',
  'chut', 'choot', 'laund', 'harami', 'haramjada', 'bakchod', 'bhadwa', 'bhadva',
  'kutiya', 'kutta', 'suar', 'ullu', 'bc', 'mc', 'bsdk', 'pkmkb', 'teri maa ki chut'
];

function hasBadWords(content) {
  if (!content || typeof content !== 'string') return false;
  const lowerMsg = content.toLowerCase();
  return englishBadWords.some(w => lowerMsg.includes(w)) ||
         hindiBadWords.some(w => lowerMsg.includes(w));
}
// -----------------------------------------------------------

// Pairing state
const waitingQueue = new Set(); // sockets waiting for random
const roomUserCounts = new Map(); // private room id -> count

// Helper: clean disconnected / invalid sockets from queue
function cleanQueue() {
  for (const s of Array.from(waitingQueue)) {
    // remove sockets that are not connected or already paired or became private
    if (!s.connected || s.partner || s.isPrivate) {
      waitingQueue.delete(s);
    }
  }
}

// Try to pair users from waitingQueue
function tryPair() {
  cleanQueue();
  const arr = Array.from(waitingQueue).filter(s => s.connected && !s.partner && !s.isPrivate);
  while (arr.length >= 2) {
    const u1 = arr.shift();
    const u2 = arr.shift();
    // double check still valid
    if (!u1 || !u2 || !u1.connected || !u2.connected) continue;

    waitingQueue.delete(u1);
    waitingQueue.delete(u2);

    u1.partner = u2;
    u2.partner = u1;

    u1.emit("paired");
    u2.emit("paired");

    // update arr to reflect removal
    // (fast path: recompute arr)
    cleanQueue();
  }
}

function pairUser(socket) {
  if (!socket.connected || socket.partner) return;
  waitingQueue.add(socket);
  socket.emit("waiting");
  tryPair();
}

function unpair(socket) {
  waitingQueue.delete(socket);

  if (socket.partner) {
    const partner = socket.partner;
    socket.partner = null;
    partner.partner = null;

    if (partner.connected) {
      partner.emit("partnerLeft");
    }
  }

  tryPair();
}

// --- Routes ---
app.get("/create-room", (req, res) => {
  const roomId = randomUUID();
  res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
});

// --- Socket handlers ---
io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  // Initialize socket state
  socket.partner = null;
  socket.isPrivate = false;
  socket.currentRoom = null;

  // PUBLIC: client will request to join random explicitly
  socket.on("joinRandom", () => {
    // only allow if not in private room
    if (socket.isPrivate) {
      socket.emit("error", { message: "You are currently in a private room. Leave it first." });
      return;
    }
    pairUser(socket);
  });

  // PUBLIC: request next partner (user-initiated)
  socket.on("next", () => {
    unpair(socket);
    pairUser(socket);
  });

  // PRIVATE: join a room via explicit event (client emits 'joinRoom')
  socket.on("joinRoom", (roomId) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit("error", { message: "Invalid Room ID" });
      return;
    }
    // If already in some private room, leave first
    if (socket.isPrivate && socket.currentRoom === roomId) {
      socket.emit("waiting"); // already waiting in that room
      return;
    }

    // If socket was in public queue, remove it
    waitingQueue.delete(socket);
    socket.partner = null;

    socket.isPrivate = true;
    socket.currentRoom = roomId;
    socket.join(roomId);

    const currentCount = roomUserCounts.get(roomId) || 0;
    if (currentCount >= 2) {
      socket.emit("roomFull", { message: "Room is already full with 2 users." });
      // leave joined room
      socket.leave(roomId);
      socket.isPrivate = false;
      socket.currentRoom = null;
      return;
    }

    roomUserCounts.set(roomId, currentCount + 1);
    console.log(`🏠 ${socket.id} joined private room ${roomId} (count=${currentCount + 1})`);

    // If room now has 2 people, emit paired to both
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (clients && clients.size === 2) {
      io.to(roomId).emit("paired");
    } else {
      socket.emit("waiting");
    }
  });

  // PRIVATE: leave explicit
  socket.on("leaveRoom", () => {
    if (!socket.isPrivate || !socket.currentRoom) return;
    const roomId = socket.currentRoom;
    socket.to(roomId).emit("partnerLeft");
    socket.leave(roomId);
    const updatedCount = (roomUserCounts.get(roomId) || 1) - 1;
    if (updatedCount <= 0) roomUserCounts.delete(roomId);
    else roomUserCounts.set(roomId, updatedCount);
    socket.isPrivate = false;
    socket.currentRoom = null;
    socket.partner = null;
    socket.emit("left");
    console.log(`👋 ${socket.id} left private room ${roomId} (remaining=${updatedCount})`);
  });

  // Messaging
  socket.on("message", (msg) => {
    if (!msg || !msg.id || typeof msg.content !== "string") return;
    if (!msg.content.trim()) return;

    if (hasBadWords(msg.content)) {
      socket.emit("messageBlocked", {
        id: msg.id,
        reason: "Bhai, gaali mat de, clean chat karte hain! 😊"
      });
      return;
    }

    // Acknowledge delivered to sender
    socket.emit("delivered", msg.id);

    // Route message
    if (socket.isPrivate && socket.currentRoom) {
      // send to other in private room
      socket.to(socket.currentRoom).emit("message", { id: msg.id, content: msg.content });
    } else if (socket.partner && socket.partner.connected) {
      socket.partner.emit("message", { id: msg.id, content: msg.content });
    } else {
      // No partner: inform sender
      socket.emit("messageBlocked", {
        id: msg.id,
        reason: "No partner connected right now."
      });
    }
  });

  socket.on("typing", (isTyping) => {
    if (typeof isTyping !== "boolean") return;
    if (socket.isPrivate && socket.currentRoom) {
      socket.to(socket.currentRoom).emit("typing", isTyping);
    } else if (socket.partner && socket.partner.connected) {
      socket.partner.emit("typing", isTyping);
    }
  });

  socket.on("seen", (data) => {
    if (!data || !data.messageId) return;
    const mid = data.messageId;
    // forward seen to partner(s)
    if (socket.isPrivate && socket.currentRoom) {
      socket.to(socket.currentRoom).emit("seen", mid);
    } else if (socket.partner && socket.partner.connected) {
      socket.partner.emit("seen", mid);
    }
  });

  // Client requested explicit leave (used by goBack)
  socket.on("leave", () => {
    if (socket.isPrivate && socket.currentRoom) {
      // leave private room
      socket.to(socket.currentRoom).emit("partnerLeft");
      const roomId = socket.currentRoom;
      socket.leave(roomId);
      const updatedCount = (roomUserCounts.get(roomId) || 1) - 1;
      if (updatedCount <= 0) roomUserCounts.delete(roomId);
      else roomUserCounts.set(roomId, updatedCount);
      socket.isPrivate = false;
      socket.currentRoom = null;
      socket.partner = null;
    } else {
      // public: unpair this socket
      unpair(socket);
    }
  });

  // On disconnecting (before disconnect)
  socket.on("disconnecting", () => {
    // If private: notify other in room
    if (socket.isPrivate && socket.currentRoom) {
      socket.to(socket.currentRoom).emit("partnerLeft");
      const roomId = socket.currentRoom;
      // decrement count
      const updatedCount = (roomUserCounts.get(roomId) || 1) - 1;
      if (updatedCount <= 0) roomUserCounts.delete(roomId);
      else roomUserCounts.set(roomId, updatedCount);
      console.log(`🏠 ${socket.id} disconnecting from private room ${roomId} (remaining=${updatedCount})`);
    } else {
      // public: unpair and cleanup
      unpair(socket);
    }
  });

  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);
    waitingQueue.delete(socket);
    // ensure count cleanup if any (safe-guard)
    if (socket.isPrivate && socket.currentRoom) {
      const roomId = socket.currentRoom;
      const updatedCount = (roomUserCounts.get(roomId) || 1) - 1;
      if (updatedCount <= 0) roomUserCounts.delete(roomId);
      else roomUserCounts.set(roomId, updatedCount);
    }
  });
});

// Optional ngrok function (commented out if not used)
async function startNgrok() {
  if (process.env.ENABLE_NGROK !== 'true') {
    console.log('🌐 Ngrok disabled.');
    return;
  }
  try {
    // Uncomment and adapt if you want ngrok
    // const listener = await ngrok.forward({ addr: process.env.PORT || 3000, authtoken: process.env.NGROK_AUTHTOKEN });
    // console.log(`🌐 Ngrok tunnel started: ${listener.url()}`);
  } catch (error) {
    console.error('❌ Ngrok failed to start:', error.message || error);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  await startNgrok();
});