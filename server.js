const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
require('dotenv').config();
const ngrok = require("@ngrok/ngrok"); // Optional: For tunneling
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  maxHttpBufferSize: 1e7, // Added for memory safety
  cors: { origin: "*" },
});
// Bad words lists for safety filter
const englishBadWords = [
  'fuck', 'shit', 'ass', 'asshole', 'bitch', 'bastard', 'cock', 'pussy', 'cunt', 'dick',
  'bollocks', 'bugger', 'wanker', 'twat', 'prick', 'slut', 'whore', 'choad', 'shag'
  // Add more if needed, e.g., 'damn', 'hell' for mild ones
];
const hindiBadWords = [
  'madarchod', 'maderchod', 'behenchod', 'bhenchod', 'bahenchod', 'chutiya', 'chutiye',
  'bhosdi', 'bhosda', 'bhonsda', 'randi', 'rand', 'gandu', 'gand', 'lund', 'loda', 'lauda',
  'chut', 'choot', 'laund', 'harami', 'haramjada', 'bakchod', 'bhadwa', 'bhadva',
  'kutiya', 'kutta', 'suar', 'ullu', 'bc', 'mc', 'bsdk', 'pkmkb', 'teri maa ki chut'
  // Compiled from common lists; add variations like 'madarchoot' if needed
];
function hasBadWords(content) {
  const lowerMsg = content.toLowerCase().trim();
  return englishBadWords.some(word => lowerMsg.includes(word)) ||
         hindiBadWords.some(word => lowerMsg.includes(word));
}
app.use(express.static("public"));
const waitingQueue = new Set();
const roomUserCounts = new Map(); // Additional tracking for room sizes to handle concurrency better
app.get("/create-room", (req, res) => {
  const roomId = randomUUID();
  res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
});
io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`);
  const roomId = socket.handshake.query.room;
  let isPrivate = false;
  if (roomId && typeof roomId === "string" && roomId.trim() !== '') {
    isPrivate = true;
    // Private room logic: Prevent more than 2 users
    const currentCount = roomUserCounts.get(roomId) || 0;
    if (currentCount >= 2) {
      socket.emit("roomFull", { message: "Room is already full with 2 users." });
      socket.disconnect(true);
      return;
    }
    // Join the room and update count
    socket.join(roomId);
    roomUserCounts.set(roomId, currentCount + 1);
    console.log(`🏠 User joined private room: ${roomId} (Total: ${currentCount + 1})`);
    // Check after join
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (clients && clients.size === 2) {
      io.to(roomId).emit("paired");
    } else {
      socket.emit("waiting");
    }
  } else {
    // Public pairing logic
    pairUser(socket);
  }
  // Common handlers for both private and public (with checks)
  socket.on("message", (msg) => {
    if (msg.id && typeof msg.content === "string" && msg.content.trim()) {
      if (hasBadWords(msg.content)) {
        socket.emit("messageBlocked", {
          id: msg.id,
          reason: "Bhai, gaali mat de, clean chat karte hain! 😊"
        });
        return;
      }
      // Emit delivered back to sender
      socket.emit("delivered", msg.id);
      if (isPrivate) {
        // Emit to partner/room with ID
        socket.to(roomId).emit("message", { id: msg.id, content: msg.content });
      } else if (socket.partner && socket.partner.connected) {
        // Emit to partner with ID
        socket.partner.emit("message", { id: msg.id, content: msg.content });
      }
    }
  });
  // Typing indicator
  socket.on("typing", (isTyping) => {
    if (typeof isTyping === "boolean") {
      if (isPrivate) {
        socket.to(roomId).emit("typing", isTyping);
      } else if (socket.partner && socket.partner.connected) {
        socket.partner.emit("typing", isTyping);
      }
    }
  });
  // Seen handler
  socket.on("seen", (data) => {
    if (data.messageId) {
      if (isPrivate) {
        socket.to(roomId).emit("seen", data.messageId);
      } else if (socket.partner && socket.partner.connected) {
        socket.partner.emit("seen", data.messageId);
      }
    }
  });
  // Leave handler for explicit leave (e.g., goBack button)
  socket.on("leave", () => {
    console.log(`👋 ${socket.id} explicitly left`);
    if (isPrivate) {
      // Private room cleanup
      socket.to(roomId).emit("partnerLeft");
      socket.leave(roomId);
      const updatedCount = (roomUserCounts.get(roomId) || 0) - 1;
      roomUserCounts.set(roomId, updatedCount);
      if (updatedCount <= 0) {
        roomUserCounts.delete(roomId);
      }
      // Emit waiting to remaining user if one left
      const remainingClients = io.sockets.adapter.rooms.get(roomId);
      if (remainingClients && remainingClients.size === 1) {
        io.to(roomId).emit("waiting");
      }
    } else {
      // Public unpair
      unpair(socket);
    }
  });
  // Next partner request (public only)
  if (!isPrivate) {
    socket.on("next", () => {
      console.log(`🔁 ${socket.id} requested next`);
      unpair(socket);
    });
  }
  // Handle disconnecting (before actual disconnect)
  socket.on("disconnecting", () => {
    if (isPrivate) {
      socket.to(roomId).emit("partnerLeft");
      // Update count on disconnect
      const updatedCount = (roomUserCounts.get(roomId) || 0) - 1;
      roomUserCounts.set(roomId, updatedCount);
      if (updatedCount === 0) {
        roomUserCounts.delete(roomId); // Cleanup empty rooms
      }
      console.log(`🏠 User leaving private room: ${roomId} (Remaining: ${updatedCount})`);
    } else {
      unpair(socket);
    }
  });
  // Optional: Handle post-disconnect cleanup if needed
  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}${isPrivate ? ` from private room: ${roomId}` : ''}`);
    if (isPrivate) {
      // Emit waiting to remaining user if exactly one left
      const remainingClients = io.sockets.adapter.rooms.get(roomId);
      if (remainingClients && remainingClients.size === 1) {
        io.to(roomId).emit("waiting");
      }
      // Cleanup count
      const updatedCount = (roomUserCounts.get(roomId) || 0) - 1;
      roomUserCounts.set(roomId, updatedCount);
      if (updatedCount <= 0) roomUserCounts.delete(roomId);
    }
    // Public already handled in disconnecting/unpair
  });
  // Join random for public (after connection)
  socket.on('joinRandom', () => {
    if (!isPrivate) {
      pairUser(socket);
    }
  });
});
function tryPair() {
  while (waitingQueue.size >= 2) {
    const [u1, u2] = [...waitingQueue].filter(
      s => s.connected && !s.partner
    ).slice(0, 2);
    if (!u1 || !u2) break;
    waitingQueue.delete(u1);
    waitingQueue.delete(u2);
    u1.partner = u2;
    u2.partner = u1;
    console.log(`🔗 Paired ${u1.id} with ${u2.id}`);
    u1.emit("paired");
    u2.emit("paired");
  }
}
function pairUser(socket) {
  waitingQueue.add(socket);
  socket.emit("waiting");
  tryPair();
}
function unpair(socket) {
  if (socket.partner) {
    const partner = socket.partner;
    if (partner.connected) {
      partner.emit("partnerLeft");
      partner.partner = null;
      waitingQueue.add(partner);
    }
    socket.partner = null;
  }
  waitingQueue.delete(socket);
  // 🔥 THIS IS THE MISSING LINE
  tryPair();
}
// Ngrok Integration (Easy to Remove: Just comment out or unset ENABLE_NGROK)
async function startNgrok() {
  if (process.env.ENABLE_NGROK !== 'true') {
    console.log('🌐 Ngrok disabled. Set ENABLE_NGROK=true to enable.');
    return;
  }
  try {
    const listener = await ngrok.forward({
      addr: process.env.PORT || 3000,
      authtoken: process.env.NGROK_AUTHTOKEN, // Direct env se le, from_env ki jagah
    });
    const url = listener.url(); // Yeh sync hai latest mein, await optional
    console.log(`🌐 Ngrok tunnel started: ${url}`);
    console.log(`🔗 Public URL: ${url}/ (Share this for testing)`);
  } catch (error) {
    console.error('❌ Ngrok failed to start:', error.message || error);
    console.log('💡 Double-check NGROK_AUTHTOKEN – copy fresh from dashboard, no spaces!');
  }
}
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  await startNgrok(); // Start ngrok after server listen
});