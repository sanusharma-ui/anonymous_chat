const socket = io({ transports: ['websocket'] });

// ----- State -----
let currentRoom = new URLSearchParams(window.location.search).get('room') || null;
let mode = currentRoom ? 'private' : 'idle'; // 'idle' | 'random' | 'private'
let messageIdCounter = 0;

let isTyping = false;
let typingTimer = null;
let typingMessageElement = null;

// Voice recording
let mediaRecorder = null;
let recordingChunks = [];
let recordingStartAt = 0;
let isRecording = false;

// Limits (client-side safety)
const MAX_IMAGE_BYTES = 700_000; // ~700KB
const MAX_AUDIO_MS = 12_000;     // 12 seconds

// ----- DOM -----
const landing = document.getElementById('landing');
const chat = document.getElementById('chat');

const messagesContainer = document.getElementById('messages');

const partnerStatus = document.getElementById('partner-status');
const chatTitle = document.getElementById('chat-title');

const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');

const banner = document.getElementById('connection-banner');
const bannerText = document.getElementById('connection-text');

const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messageStatus = document.getElementById('message-status');

const roomModal = document.getElementById('room-modal');
const roomLinkInput = document.getElementById('room-link');
const copyLinkBtn = document.getElementById('copy-link');
const closeModalBtn = document.getElementById('close-modal');

const toast = document.getElementById('toast');

// Media UI
const attachBtn = document.getElementById('attach-btn');
const imageInput = document.getElementById('image-input');
const voiceBtn = document.getElementById('voice-btn');

// ----- UI helpers -----
function showScreen(screenEl) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  if (screenEl) screenEl.classList.add('active');

  nextBtn.style.display = (screenEl === chat && mode === 'random') ? 'inline-flex' : 'none';
}

function setHeader(title, subtitle) {
  chatTitle.textContent = title;
  partnerStatus.textContent = subtitle;
}

function setBanner(show, text = 'Connecting…') {
  banner.style.display = show ? 'flex' : 'none';
  if (text) bannerText.textContent = text;
}

function showToast(msg, type = 'info', ms = 2400) {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, ms);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom(behavior = 'smooth') {
  try {
    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior });
  } catch {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function addSystemMessage(text) {
  const wrap = document.createElement('div');
  wrap.className = 'system-row';
  wrap.innerHTML = `<div class="system-bubble">${escapeHtml(text)}</div>`;
  messagesContainer.appendChild(wrap);
  scrollToBottom();
}

function contentToRenderable(content) {
  // Detect Data URLs we send as "text messages"
  if (typeof content !== 'string') return { kind: 'text', html: '' };

  if (content.startsWith('data:image/')) {
    return {
      kind: 'image',
      html: `<img class="chat-image" src="${content}" alt="Shared image" loading="lazy" />`
    };
  }

  if (content.startsWith('data:audio/')) {
    return {
      kind: 'audio',
      html: `
        <audio class="chat-audio" controls preload="none">
          <source src="${content}">
          Your browser does not support audio playback.
        </audio>
      `
    };
  }

  // normal text (preserve newlines)
  const safe = escapeHtml(content).replace(/\n/g, '<br/>');
  return { kind: 'text', html: `<div class="text">${safe}</div>` };
}

function addMessage({ id, content, isSent, timestamp = Date.now(), status = 'sent' }) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
  messageDiv.dataset.id = id;

  const render = contentToRenderable(content);

  messageDiv.innerHTML = `
    <div class="bubble ${render.kind}">
      ${render.html}
      <div class="meta">
        <span class="time">${formatTime(timestamp)}</span>
        ${isSent ? `<span class="ticks ${status}">${status === 'seen' ? '✓✓' : status === 'delivered' ? '✓' : ''}</span>` : ''}
      </div>
    </div>
  `;

  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

function updateMessageStatus(id, status) {
  const message = messagesContainer.querySelector(`[data-id="${id}"]`);
  if (!message) return;
  const ticks = message.querySelector('.ticks');
  if (!ticks) return;
  ticks.className = `ticks ${status}`;
  ticks.textContent = status === 'seen' ? '✓✓' : status === 'delivered' ? '✓' : '';
}

function showTypingIndicator(show) {
  if (show) {
    if (typingMessageElement) return;
    typingMessageElement = document.createElement('div');
    typingMessageElement.className = 'message received typing';
    typingMessageElement.innerHTML = `
      <div class="bubble">
        <div class="typing-dots"><span></span><span></span><span></span></div>
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

// Autosize textarea
function autosizeTextarea() {
  messageInput.style.height = 'auto';
  const max = 140;
  messageInput.style.height = Math.min(messageInput.scrollHeight, max) + 'px';
}

// ----- Typing -----
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
  }, 900);
}

// ----- Actions -----
function resetChatUI() {
  messagesContainer.innerHTML = '';
  showTypingIndicator(false);
  messageStatus.textContent = '';
  autosizeTextarea();
}

function enterRandomChat() {
  mode = 'random';
  currentRoom = null;
  window.history.replaceState(null, '', '/');

  showScreen(chat);
  setHeader('Random Chat', 'Connecting…');
  setBanner(true, 'Finding a chat partner…');

  resetChatUI();
  addSystemMessage('Searching for a partner…');

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
      mode = 'private';

      window.history.replaceState(null, '', `/?room=${currentRoom}`);

      showScreen(chat);
      setHeader('Private Room', 'Waiting for someone to join…');
      setBanner(true, 'Room created — waiting for partner…');

      resetChatUI();
      addSystemMessage('Room created. Waiting for your friend…');

      socket.emit('joinRoom', currentRoom);
    })
    .catch(() => showToast('Failed to create room. Try again.', 'error'));
}

function parseRoomId(input) {
  const val = (input || '').trim();
  if (!val) return null;

  try {
    if (val.includes('room=')) {
      const maybeUrl = val.startsWith('http') ? val : (window.location.origin + val);
      const url = new URL(maybeUrl);
      return url.searchParams.get('room');
    }
  } catch {}

  return val;
}

function joinRoom() {
  const raw = document.getElementById('join-room').value;
  const roomId = parseRoomId(raw);

  if (roomId && roomId.length === 36) {
    currentRoom = roomId;
    mode = 'private';
    window.history.replaceState(null, '', `/?room=${roomId}`);

    showScreen(chat);
    setHeader('Private Room', 'Connecting…');
    setBanner(true, 'Joining room…');

    resetChatUI();
    addSystemMessage('Joining private room…');

    socket.emit('joinRoom', roomId);
  } else {
    showToast('Invalid Room ID or link.', 'error');
  }
}

function goBack() {
  socket.emit('leave');
  mode = 'idle';
  currentRoom = null;
  window.history.replaceState(null, '', '/');

  setBanner(false);
  showScreen(landing);
}

function requestNext() {
  if (mode !== 'random') return;

  setBanner(true, 'Finding next partner…');
  setHeader('Random Chat', 'Connecting…');

  showTypingIndicator(false);
  messagesContainer.innerHTML = '';
  addSystemMessage('Looking for the next partner…');

  socket.emit('next');
}

function sendTextMessage() {
  const content = messageInput.value.replace(/\r\n/g, '\n').trim();
  if (!content) return;

  const msgId = ++messageIdCounter;
  socket.emit('message', { id: msgId, content });

  addMessage({ id: msgId, content, isSent: true, status: 'sent' });

  messageInput.value = '';
  autosizeTextarea();

  isTyping = false;
  socket.emit('typing', false);

  sendBtn.disabled = true;
  setTimeout(() => (sendBtn.disabled = false), 250);
}

function bytesFromDataUrl(dataUrl) {
  // approximate byte count of base64 payload
  const idx = dataUrl.indexOf(',');
  if (idx < 0) return 0;
  const b64 = dataUrl.slice(idx + 1);
  const padding = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function sendImageFile(file) {
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file.', 'error');
    return;
  }

  // Convert to Data URL
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const size = bytesFromDataUrl(dataUrl);
  if (size > MAX_IMAGE_BYTES) {
    showToast('Image is too large. Please choose a smaller image.', 'error', 2800);
    return;
  }

  const msgId = ++messageIdCounter;
  socket.emit('message', { id: msgId, content: dataUrl });
  addMessage({ id: msgId, content: dataUrl, isSent: true, status: 'sent' });
}

async function startRecording() {
  if (isRecording) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Your browser does not support voice recording.', 'error', 2800);
    return;
  }

  // Choose a supported mimeType if possible
  const preferredTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];
  const mimeType = preferredTypes.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recordingChunks = [];
  recordingStartAt = Date.now();

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordingChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    // stop mic tracks
    stream.getTracks().forEach(t => t.stop());

    const duration = Date.now() - recordingStartAt;
    if (duration < 350) {
      showToast('Recording too short.', 'info');
      return;
    }

    const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

    if (duration > MAX_AUDIO_MS) {
      showToast('Voice note too long. Keep it under ~12 seconds.', 'error', 2800);
      return;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

    // size check (practical)
    const size = bytesFromDataUrl(dataUrl);
    if (size > 900_000) {
      showToast('Voice note is too large. Try a shorter recording.', 'error', 3000);
      return;
    }

    const msgId = ++messageIdCounter;
    socket.emit('message', { id: msgId, content: dataUrl });
    addMessage({ id: msgId, content: dataUrl, isSent: true, status: 'sent' });
  };

  mediaRecorder.start();
  isRecording = true;
  voiceBtn.classList.add('recording');
  showToast('Recording… release to send', 'info', 1200);
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  voiceBtn.classList.remove('recording');
  try { mediaRecorder.stop(); } catch {}
}

// ----- Event listeners -----
document.getElementById('random-chat').addEventListener('click', enterRandomChat);
document.getElementById('create-room').addEventListener('click', createRoom);
document.getElementById('join-btn').addEventListener('click', joinRoom);
document.getElementById('join-room').addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(); });

backBtn.addEventListener('click', goBack);
nextBtn.addEventListener('click', requestNext);

sendBtn.addEventListener('click', sendTextMessage);

messageInput.addEventListener('input', () => {
  autosizeTextarea();
  handleTyping();
});

// Enter sends, Shift+Enter inserts newline
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendTextMessage();
  }
});

// Image attach
attachBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  imageInput.value = '';
  try {
    await sendImageFile(file);
  } catch {
    showToast('Failed to send image.', 'error');
  }
});

// Voice: hold to record (mouse + touch)
voiceBtn.addEventListener('mousedown', (e) => { e.preventDefault(); startRecording().catch(() => showToast('Mic permission denied.', 'error')); });
voiceBtn.addEventListener('mouseup', (e) => { e.preventDefault(); stopRecording(); });
voiceBtn.addEventListener('mouseleave', stopRecording);

voiceBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording().catch(() => showToast('Mic permission denied.', 'error')); }, { passive: false });
voiceBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); }, { passive: false });
voiceBtn.addEventListener('touchcancel', stopRecording);

// Copy link
copyLinkBtn.addEventListener('click', async () => {
  const text = roomLinkInput.value || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied room link.', 'success');
  } catch {
    roomLinkInput.select();
    document.execCommand('copy');
    showToast('Copied room link.', 'success');
  }
});
closeModalBtn.addEventListener('click', () => { roomModal.style.display = 'none'; });

// ----- Socket events -----
socket.on('connect', () => {
  if (currentRoom) {
    mode = 'private';
    showScreen(chat);
    setHeader('Private Room', 'Connecting…');
    setBanner(true, 'Joining room…');
    resetChatUI();
    addSystemMessage('Joining private room…');
    socket.emit('joinRoom', currentRoom);
  } else {
    mode = 'idle';
    showScreen(landing);
  }
});

socket.on('roomFull', (data) => {
  setBanner(false);
  showToast(data?.message || 'Room is full.', 'error', 2500);
  addSystemMessage('Room is full. Returning home…');
  setTimeout(goBack, 1200);
});

socket.on('waiting', () => {
  showScreen(chat);
  setBanner(true, mode === 'private' ? 'Waiting for partner…' : 'Finding a partner…');
  setHeader(mode === 'private' ? 'Private Room' : 'Random Chat', 'Waiting…');
  addSystemMessage('Waiting for a partner…');
});

socket.on('paired', () => {
  setBanner(false);
  setHeader(mode === 'private' ? 'Private Room' : 'Random Chat', 'Connected');
  addSystemMessage('You are now connected.');
});

socket.on('partnerLeft', () => {
  showTypingIndicator(false);

  if (mode === 'random') {
    setHeader('Random Chat', 'Disconnected');
    setBanner(false);
    addSystemMessage('Partner disconnected. Tap ↻ to find someone else.');
    showToast('Partner disconnected.', 'info');
  } else {
    setHeader('Private Room', 'Partner left');
    setBanner(true, 'Waiting for someone to join…');
    addSystemMessage('Partner left the room.');
  }
});

socket.on('message', (msg) => {
  if (!msg) return;
  addMessage({ id: msg.id, content: msg.content, isSent: false });
  showTypingIndicator(false);
  socket.emit('seen', { messageId: msg.id });
});

socket.on('delivered', (id) => updateMessageStatus(id, 'delivered'));
socket.on('seen', (id) => updateMessageStatus(id, 'seen'));

socket.on('typing', (typing) => {
  showTypingIndicator(!!typing);
  if (typing) partnerStatus.textContent = 'Typing…';
  else partnerStatus.textContent = 'Connected';
});

socket.on('messageBlocked', (data) => {
  if (data?.reason) {
    messageStatus.textContent = data.reason;
    setTimeout(() => (messageStatus.textContent = ''), 2500);
  }
});

socket.on('error', (data) => {
  if (data?.message) showToast(data.message, 'error', 2500);
});

window.addEventListener('beforeunload', () => {
  try { socket.emit('leave'); } catch {}
});

window.addEventListener('load', autosizeTextarea);