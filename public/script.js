const socket = io({ transports: ['websocket'], query: { room: new URLSearchParams(window.location.search).get('room') || '' } });
let currentRoom = null;
let messageIdCounter = 0;
let isTyping = false;
let typingTimer;
let typingMessageElement = null;

// DOM Elements
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

// Event Listeners
document.getElementById('random-chat').addEventListener('click', () => enterRandomChat());
document.getElementById('create-room').addEventListener('click', createRoom);
document.getElementById('join-btn').addEventListener('click', joinRoom);
document.getElementById('join-room').addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(); });
backBtn.addEventListener('click', () => goBack());
nextBtn.addEventListener('click', requestNext);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
messageInput.addEventListener('input', handleTyping);
messageInput.addEventListener('keydown', () => clearTimeout(typingTimer));
copyLinkBtn.addEventListener('click', copyRoomLink);
closeModalBtn.addEventListener('click', () => { roomModal.style.display = 'none'; });
okBtn.addEventListener('click', () => { errorModal.style.display = 'none'; });

// Utility Functions
function showScreen(screen) {
    [...document.querySelectorAll('.screen, .overlay')].forEach(el => el.classList.remove('active'));
    if (screen) screen.classList.add('active');
    if (screen === chat) nextBtn.style.display = currentRoom ? 'none' : 'block'; // Hide next for private rooms
}

function showWaiting(show = true, text = 'Finding a chat partner...') {
    waitingOverlay.classList.toggle('active', show);
    if (text) document.getElementById('waiting-text').textContent = text;
}

function showError(message) {
    errorText.textContent = message;
    errorModal.style.display = 'flex';
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addMessage({ id, content, isSent, timestamp = Date.now(), status = 'sent' }) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.innerHTML = `
        <div class="message-bubble">${escapeHtml(content)}</div>
        <span class="message-time">${formatTime(timestamp)}</span>
        ${isSent ? `<span class="message-status ${status}">${status === 'seen' ? '✓✓' : status === 'delivered' ? '✓' : ''}</span>` : ''}
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
    return { id, element: messageDiv };
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
        if (typingMessageElement) return; // Already showing

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

function scrollToBottom(behavior = 'smooth') {
    messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: behavior
    });
}

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

// Chat Functions
function enterRandomChat() {
    currentRoom = null;
    showScreen(waitingOverlay);
    socket.emit('joinRandom'); // Trigger connection in public mode
}

function createRoom() {
    fetch('/create-room')
        .then(res => res.json())
        .then(data => {
            roomLinkInput.value = data.link;
            roomModal.style.display = 'flex';
            currentRoom = new URLSearchParams(data.link.split('?')[1]).get('room');
        })
        .catch(() => showError('Failed to create room. Try again.'));
}

function joinRoom() {
    const roomId = document.getElementById('join-room').value.trim();
    if (roomId && roomId.length === 36) { // UUID length
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
    socket.disconnect();
    messagesContainer.innerHTML = '';
    partnerStatus.textContent = 'Connecting...';
    messageInput.value = '';
    if (typingMessageElement) {
        typingMessageElement.remove();
        typingMessageElement = null;
    }
}

function requestNext() {
    socket.emit('next');
    showWaiting(true, 'Finding next partner...');
}

function sendMessage() {
    const content = messageInput.value.trim();
    if (!content) return;
    const msgId = ++messageIdCounter;
    const message = { id: msgId, content };
    socket.emit('message', message);
    addMessage({ ...message, isSent: true, status: 'sent' });
    messageInput.value = '';
    handleTyping(); // Stop typing
    messageStatus.textContent = ''; // Clear any blocked status
    sendBtn.disabled = true;
    setTimeout(() => { sendBtn.disabled = false; }, 500);
}

// Socket Events
socket.on('connect', () => {
    console.log('Connected to server');
    if (currentRoom) {
        socket.emit('joinRoom', currentRoom);
        showScreen(waitingOverlay);
    }
});

socket.on('roomFull', (data) => {
    showWaiting(false);
    showError(data.message);
    setTimeout(goBack, 2000);
});

socket.on('waiting', () => {
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
    partnerStatus.textContent = 'Partner left';
    showWaiting(true, 'Partner disconnected. Finding new one...');
    nextBtn.style.display = currentRoom ? 'none' : 'block';
    showTypingIndicator(false); // Hide typing if partner left
    scrollToBottom();
});

socket.on('message', (msg) => {
    addMessage({ ...msg, isSent: false });
    showTypingIndicator(false); // Hide typing on new message
});

socket.on('delivered', (id) => {
    updateMessageStatus(id, 'delivered');
});

socket.on('seen', (id) => {
    updateMessageStatus(id, 'seen');
    // Optional: Mark as read on receive for simplicity (WhatsApp-like)
    socket.emit('seen', { messageId: id });
});

socket.on('typing', (typing) => {
    showTypingIndicator(typing);
    partnerStatus.textContent = typing ? '' : (currentRoom ? 'Private Chat' : 'Random Chat');
});

socket.on('messageBlocked', (data) => {
    messageStatus.textContent = data.reason;
    setTimeout(() => { messageStatus.textContent = ''; }, 3000);
});

// Copy Link
function copyRoomLink() {
    roomLinkInput.select();
    document.execCommand('copy');
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
}

// Auto-scroll and initial setup
messagesContainer.addEventListener('scroll', () => {
    // Infinite scroll or other features if needed, but keep simple
});

window.addEventListener('load', () => {
    if (currentRoom) joinRoom(); // Auto-join if URL has room
    else showScreen(landing);
});

// Handle resize for responsiveness
window.addEventListener('resize', () => {
    scrollToBottom('auto');
});

// Keyboard handling for mobile
messageInput.addEventListener('focus', () => {
    setTimeout(scrollToBottom, 300);
});