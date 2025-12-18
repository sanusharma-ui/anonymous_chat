// script.js - full client-side logic for ShadowChat
// Follow-up: kept all features from original, fixed overlay/Next visibility issues,
// improved robustness for mobile/tablet, and retained safety/status features.
// Added flashing messages on partner disconnect: first "Disconnected", then "To connect with someone else, click ↻".

// Socket.io client
const socket = io({ transports: ['websocket'] });

// State
let currentRoom = new URLSearchParams(window.location.search).get('room') || null;
let messageIdCounter = 0;
let isTyping = false;
let typingTimer = null;
let typingMessageElement = null;

// DOM elements
const landing = document.getElementById('landing');
const chat = document.getElementById('chat');
const waitingOverlay = document.getElementById('waiting-overlay');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const partnerStatus = document.getElementById('partner-status');
const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');
const messageStatus = document.getElementById('message-status');
const roomModal = document.getElementById('room-modal');
const roomLinkInput = document.getElementById('room-link');
const copyLinkBtn = document.getElementById('copy-link');
const closeModalBtn = document.getElementById('close-modal');
const errorModal = document.getElementById('error-modal');
const errorText = document.getElementById('error-text');
const okBtn = document.getElementById('ok-btn');

// Make Next button always visible on chat
// (this ensures UX: Next is always actionable and not hidden by logic)
nextBtn.style.display = 'block';

// --- Utility functions ---
function showScreen(screen) {
  [...document.querySelectorAll('.screen, .overlay')].forEach(el => el.classList.remove('active'));
  if (screen) screen.classList.add('active');

  // ALWAYS show Next when on chat screen (UX decision)
  if (screen === chat) {
    nextBtn.style.display = 'block';
  }
}

function showWaiting(show = true, text = 'Finding a chat partner...') {
  // Overlay used only for "searching" state
  waitingOverlay.classList.toggle('active', show);
  if (text) {
    const wt = document.getElementById('waiting-text');
    if (wt) wt.textContent = text;
  }
}

function showError(message) {
  errorText.textContent = message;
  errorModal.style.display = 'flex';
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom(behavior = 'smooth') {
  try {
    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior });
  } catch (e) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function addMessage({ id, content, isSent, timestamp = Date.now(), status = 'sent' }) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
  messageDiv.dataset.id = id;
  messageDiv.innerHTML = `
    <div class="message-bubble">${escapeHtml(content)}</div>
    <span class="message-time">${formatTime(timestamp)}</span>
    ${isSent ? `<span class="message-status ${status}">${status === 'seen' ? '✓✓' : status === 'delivered' ? '✓' : ''}</span>` : ''}
  `;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
  return { id, element: messageDiv };
}

function updateMessageStatus(id, status) {
  const message = messagesContainer.querySelector(`[data-id="${id}"]`);
  if (message) {
    const statusEl = message.querySelector('.message-status');
    if (statusEl) {
      statusEl.className = `message-status ${status}`;
      statusEl.textContent = status === 'seen' ? '✓✓' : status === 'delivered' ? '✓' : '';
    }
  }
}

function showTypingIndicator(show) {
  if (show) {
    if (typingMessageElement) return;
    typingMessageElement = document.createElement('div');
    typingMessageElement.className = 'message received typing-message';
    typingMessageElement.innerHTML = `
      <div class="message-bubble">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messagesContainer.appendChild(typingMessageElement);
    scrollToBottom();
  } else {
    if (typingMessageElement) {
      typingMessageElement.remove();
      typingMessageElement = null;
    }
  }
}

// New: Flash a message in partnerStatus with fade-in/out animation
// Assumes CSS has .flash { animation: flash 1s ease-in-out; } @keyframes flash { 0%,100%{opacity:1} 50%{opacity:0.5} }
function flashStatusMessage(message, duration = 2000) {
  partnerStatus.textContent = message;
  partnerStatus.classList.add('flash');
  setTimeout(() => {
    partnerStatus.classList.remove('flash');
  }, duration);
}

// --- Input / Typing handling ---
function handleTyping() {
  const typing = messageInput.value.trim().length > 0;
  if (typing !== isTyping) {
    isTyping = typing;
    socket.emit('typing', typing);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    socket.emit('typing', false);
  }, 1000);
}

// --- Chat actions ---
function enterRandomChat() {
  currentRoom = null;
  showScreen(waitingOverlay);
  socket.emit('joinRandom');
}

function createRoom() {
  fetch('/create-room')
    .then(res => res.json())
    .then(data => {
      roomLinkInput.value = data.link;
      roomModal.style.display = 'flex';
      const rid = new URLSearchParams(data.link.split('?')[1]).get('room');
      currentRoom = rid;
      // Auto-join created private room
      socket.emit('joinRoom', currentRoom);
      showScreen(waitingOverlay);
      document.getElementById('waiting-text').textContent = 'Room created! Waiting for partner...';
      window.history.replaceState(null, '', `/?room=${currentRoom}`);
    })
    .catch(() => showError('Failed to create room. Try again.'));
}

function joinRoom() {
  const roomId = document.getElementById('join-room').value.trim();
  if (roomId && roomId.length === 36) {
    currentRoom = roomId;
    window.history.replaceState(null, '', `/?room=${roomId}`);
    socket.emit('joinRoom', roomId);
    showScreen(waitingOverlay);
    document.getElementById('waiting-text').textContent = 'Joining room...';
  } else {
    showError('Invalid Room ID. Must be 36 characters.');
  }
}

function goBack() {
  currentRoom = null;
  window.history.replaceState(null, '', '/');
  showScreen(landing);
  socket.emit('leave'); // server will handle cleanup
  messagesContainer.innerHTML = '';
  partnerStatus.textContent = 'Connecting...';
  messageInput.value = '';
  showTypingIndicator(false);
}

function requestNext() {
  // Clear typing indicator and old messages (fresh session UX)
  showTypingIndicator(false);
  messagesContainer.innerHTML = '';
  partnerStatus.textContent = 'Finding next partner...';
  showWaiting(true, 'Finding next partner...');
  socket.emit('next');
}

function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  const msgId = ++messageIdCounter;
  const message = { id: msgId, content };
  socket.emit('message', message);
  addMessage({ ...message, isSent: true, status: 'sent' });
  messageInput.value = '';
  handleTyping(); // ensure typing false sent
  messageStatus.textContent = '';
  sendBtn.disabled = true;
  setTimeout(() => { sendBtn.disabled = false; }, 400);
}

// --- Copy link fallback ---
function copyRoomLink() {
  const text = roomLinkInput.value || '';
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
    }).catch(() => {
      // fallback
      roomLinkInput.select();
      document.execCommand('copy');
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
    });
  } else {
    roomLinkInput.select();
    document.execCommand('copy');
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
  }
}

// --- Event listeners (UI) ---
document.getElementById('random-chat').addEventListener('click', enterRandomChat);
document.getElementById('create-room').addEventListener('click', createRoom);
document.getElementById('join-btn').addEventListener('click', joinRoom);
document.getElementById('join-room').addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(); });
backBtn.addEventListener('click', () => goBack());
nextBtn.addEventListener('click', requestNext);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener('input', handleTyping);
messageInput.addEventListener('keydown', () => clearTimeout(typingTimer));
copyLinkBtn.addEventListener('click', copyRoomLink);
closeModalBtn.addEventListener('click', () => { roomModal.style.display = 'none'; });
okBtn.addEventListener('click', () => { errorModal.style.display = 'none'; });

// Ensure Next button is always visible even if some other code modifies it
window.addEventListener('load', () => {
  nextBtn.style.display = 'block';
});

// --- Socket event handlers ---
socket.on('connect', () => {
  console.log('Connected to server');
  // If URL had room param, join now
  if (currentRoom) {
    socket.emit('joinRoom', currentRoom);
    showScreen(waitingOverlay);
    document.getElementById('waiting-text').textContent = 'Joining room...';
  } else {
    showScreen(landing);
  }
});

socket.on('roomFull', (data) => {
  showWaiting(false);
  showError(data.message || 'Room is full.');
  setTimeout(goBack, 2000);
});

socket.on('waiting', () => {
  // server tells us we are waiting for a partner
  showScreen(chat);
  showWaiting(true, 'Waiting for partner...');
  partnerStatus.textContent = 'Waiting for partner...';
  scrollToBottom();
});

socket.on('paired', () => {
  showWaiting(false);
  showScreen(chat);
  partnerStatus.textContent = currentRoom ? 'Private Chat' : 'Random Chat';
  scrollToBottom();
});

socket.on('partnerLeft', () => {
  // Updated: Flash "Disconnected" then "To connect with someone else, click ↻"
  // IMPORTANT FIX: hide overlay and show chat header + Next button
  showWaiting(false);           // hide overlay - critical
  showTypingIndicator(false);
  showScreen(chat);             // make sure chat screen is visible
  // preserve messages; user can click Next

  // Flash sequence
  flashStatusMessage('Disconnected', 1500);
  setTimeout(() => {
    flashStatusMessage('To connect with someone else, click ↻', 3000);
    setTimeout(() => {
      partnerStatus.textContent = 'Partner left'; // fallback to original
    }, 3000);
  }, 1500);

  scrollToBottom();
});

socket.on('message', (msg) => {
  if (!msg) return;
  addMessage({ ...msg, isSent: false });
  showTypingIndicator(false);
});

socket.on('delivered', (id) => {
  updateMessageStatus(id, 'delivered');
});

socket.on('seen', (id) => {
  updateMessageStatus(id, 'seen');
  // Optionally acknowledge back (keeps parity)
  socket.emit('seen', { messageId: id });
});

socket.on('typing', (typing) => {
  showTypingIndicator(typing);
  partnerStatus.textContent = typing ? '' : (currentRoom ? 'Private Chat' : 'Random Chat');
});

socket.on('messageBlocked', (data) => {
  if (data && data.reason) {
    messageStatus.textContent = data.reason;
    setTimeout(() => { messageStatus.textContent = ''; }, 3000);
  }
});

socket.on('error', (data) => {
  if (data && data.message) showError(data.message);
});

// Fallback: keep Next visible if some CSS/overlay change hides it
const nextVisibilityObserver = new MutationObserver(() => {
  if (nextBtn && getComputedStyle(nextBtn).display === 'none') {
    nextBtn.style.display = 'block';
  }
});
nextVisibilityObserver.observe(nextBtn, { attributes: true, attributeFilter: ['style', 'class'] });

// Auto-scroll when new messages arrive (ensure behavior on mobile keyboards)
messagesContainer.addEventListener('DOMNodeInserted', () => {
  // small timeout to allow layout to settle
  setTimeout(() => scrollToBottom('auto'), 60);
});

// Accessibility: focus input on chat open
chat.addEventListener('transitionend', () => {
  if (document.activeElement !== messageInput && showScreen) {
    try { messageInput.focus(); } catch (e) { /* ignore */ }
  }
});

// Keep Next visible if overlay gets active due to other code
const bodyObserver = new MutationObserver(() => {
  if (waitingOverlay.classList.contains('active')) {
    // overlay may cover header; ensure header buttons sit above if needed via CSS z-index.
    // Primary UX: partnerLeft should hide overlay — but this protects if overlay remains accidentally.
    nextBtn.style.display = 'block';
  }
});
bodyObserver.observe(waitingOverlay, { attributes: true, attributeFilter: ['class'] });

// Clean before unload: tell server we're leaving
window.addEventListener('beforeunload', () => {
  try { socket.emit('leave'); } catch (e) { /* ignore */ }
});