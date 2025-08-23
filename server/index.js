const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  pingTimeout: 20000,
  cors: { origin: "*" },
});

app.use(express.static("public"));44444

const waitingQueue = new Set();

app.get("/create-room", (req, res) => {
  const roomId = randomUUID();
  res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
});

io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`);
  const roomId = socket.handshake.query.room;

  if (roomId) {
    socket.join(roomId);
    console.log(`🏠 User joined private room: ${roomId}`);

    const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
    if (clients.size === 2) {
      io.to(roomId).emit("paired");
    } else {
      socket.emit("waiting");
    }

    socket.on("message", (msg) => {
      socket.to(roomId).emit("message", msg);
    });

    socket.on("typing", (isTyping) => {
      socket.to(roomId).emit("typing", isTyping);
    });

    socket.on("disconnect", () => {
      socket.to(roomId).emit("partnerLeft");
    });

  } else {
    pairUser(socket);

    socket.on("message", (msg) => {
      if (socket.partner && socket.partner.connected) {
        socket.partner.emit("message", msg);
      }
    });

    socket.on("next", () => {
      console.log(`🔁 ${socket.id} requested next`);
      unpair(socket);
      pairUser(socket);
    });

    socket.on("typing", (isTyping) => {
      if (socket.partner && socket.partner.connected) {
        socket.partner.emit("typing", isTyping);
      }
    });

    socket.on("disconnect", () => {
      console.log(`❌ ${socket.id} disconnected`);
      unpair(socket);
    });
  }
});

function pairUser(socket) {
  for (let partner of waitingQueue) {
    if (partner.connected && partner !== socket) {
      waitingQueue.delete(partner);
      socket.partner = partner;
      partner.partner = socket;

      console.log(`🔗 Paired ${socket.id} with ${partner.id}`);
      socket.emit("paired");
      partner.emit("paired");
      return;
    }
  }
  waitingQueue.add(socket);
  socket.emit("waiting");
}

function unpair(socket) {
  if (socket.partner) {
    if (socket.partner.connected) {
      socket.partner.emit("partnerLeft");
      socket.partner.partner = null;
      waitingQueue.add(socket.partner);
    }
    socket.partner = null;
  }
  waitingQueue.delete(socket);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});