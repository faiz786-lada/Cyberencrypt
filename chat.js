// chat.js — Chat room page logic (chat.html)
// Handles: parsing room/secret from URL, deriving the encryption key,
// presence, typing indicators, sending/receiving encrypted messages,
// and the client-side expiry countdown (server-side deletion is
// enforced independently by the Cloud Function in functions/index.js).

import {
  db, ref, set, get, push, update, remove,
  onValue, onChildAdded, onDisconnect, serverTimestamp,
} from "./firebase.js";
import { deriveRoomKey, encryptMessage, decryptMessage } from "./crypto.js";

/* ---------------- DOM refs ---------------- */
const chatShell = document.getElementById("chatShell");
const statusShell = document.getElementById("statusShell");
const statusGlyph = document.getElementById("statusGlyph");
const statusTitle = document.getElementById("statusTitle");
const statusSub = document.getElementById("statusSub");
const statusHomeBtn = document.getElementById("statusHomeBtn");

const roomIdChip = document.getElementById("roomIdChip");
const onlineCountEl = document.getElementById("onlineCount");
const expiresInEl = document.getElementById("expiresIn");
const expiryBar = document.getElementById("expiryBar");
const messagesEl = document.getElementById("messages");
const typingRow = document.getElementById("typingRow");
const composerForm = document.getElementById("composerForm");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const connStatus = document.getElementById("connStatus");
const connText = document.getElementById("connText");

/* ---------------- parse URL ---------------- */
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const secret = window.location.hash ? window.location.hash.slice(1) : null;

const clientId = getOrCreateClientId();
const displayName = "user-" + clientId.slice(0, 4);

let roomKey = null;
let expiresAt = null;
let countdownTimer = null;
let typingTimeout = null;
let isTyping = false;
const knownTypers = new Map(); // clientId -> displayName

function showStatus(glyph, title, sub, showHome = false) {
  chatShell.style.display = "none";
  statusShell.style.display = "flex";
  statusGlyph.textContent = glyph;
  statusTitle.textContent = title;
  statusSub.textContent = sub;
  statusHomeBtn.style.display = showHome ? "inline-flex" : "none";
}

async function init() {
  if (!roomId) {
    showStatus("⚠", "No room specified", "This link is missing a room ID.", true);
    return;
  }
  if (!secret) {
    showStatus(
      "⚠",
      "Missing decryption key",
      "This room's secret key wasn't found in the link. Use the full share link (including the part after #) that was copied for you.",
      true
    );
    return;
  }

  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`)).catch(() => null);
  if (!metaSnap || !metaSnap.exists()) {
    showStatus("✕", "Room expired", "This room no longer exists — it either expired or never existed.", true);
    return;
  }

  const meta = metaSnap.val();
  expiresAt = meta.expiresAt;
  if (!meta.active || !expiresAt || Date.now() >= expiresAt) {
    showStatus("✕", "Room expired", "This room's 30-minute lifetime has ended and all messages were permanently deleted.", true);
    return;
  }

  roomKey = await deriveRoomKey(secret, roomId);

  chatShell.style.display = "flex";
  statusShell.style.display = "none";
  roomIdChip.textContent = roomId;

  setupPresence();
  setupTyping();
  setupMessages();
  setupExpiryWatch();
  setupConnectionIndicator();
}

/* ---------------- presence ---------------- */
function setupPresence() {
  const myPresenceRef = ref(db, `rooms/${roomId}/presence/${clientId}`);
  set(myPresenceRef, { name: displayName, joinedAt: serverTimestamp() });
  onDisconnect(myPresenceRef).remove();

  const presenceRef = ref(db, `rooms/${roomId}/presence`);
  let firstLoad = true;
  const seen = new Set();

  onValue(presenceRef, (snap) => {
    const val = snap.val() || {};
    const currentIds = Object.keys(val);
    onlineCountEl.textContent = currentIds.length;

    if (!firstLoad) {
      // detect joins
      currentIds.forEach((id) => {
        if (!seen.has(id) && id !== clientId) {
          addSystemMessage(`${val[id]?.name || "someone"} joined the room`);
        }
      });
      // detect leaves
      seen.forEach((id) => {
        if (!currentIds.includes(id) && id !== clientId) {
          addSystemMessage(`someone left the room`);
        }
      });
    }
    seen.clear();
    currentIds.forEach((id) => seen.add(id));
    firstLoad = false;
  });
}

/* ---------------- typing indicator ---------------- */
function setupTyping() {
  const myTypingRef = ref(db, `rooms/${roomId}/typing/${clientId}`);
  onDisconnect(myTypingRef).remove();

  msgInput.addEventListener("input", () => {
    if (!isTyping) {
      isTyping = true;
      set(myTypingRef, true);
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      remove(myTypingRef);
    }, 2000);
  });

  onValue(ref(db, `rooms/${roomId}/typing`), (snap) => {
    const val = snap.val() || {};
    const others = Object.keys(val).filter((id) => id !== clientId);
    typingRow.textContent = others.length
      ? others.length === 1
        ? "someone is typing…"
        : `${others.length} people are typing…`
      : "";
  });
}

/* ---------------- messages ---------------- */
function setupMessages() {
  const messagesRef = ref(db, `rooms/${roomId}/messages`);
  onChildAdded(messagesRef, async (snap) => {
    const msg = snap.val();
    if (!msg) return;
    try {
      const plaintext = await decryptMessage(roomKey, msg.encryptedData, msg.iv);
      renderMessage({
        text: plaintext,
        sentByMe: msg.senderId === clientId,
        timestamp: msg.timestamp,
      });
    } catch (err) {
      console.error("Failed to decrypt message:", err);
      renderMessage({
        text: "[unable to decrypt message]",
        sentByMe: msg.senderId === clientId,
        timestamp: msg.timestamp,
      });
    }
  });
}

composerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text || !roomKey) return;

  sendBtn.disabled = true;
  try {
    const { ciphertext, iv } = await encryptMessage(roomKey, text);
    const newMsgRef = push(ref(db, `rooms/${roomId}/messages`));
    await set(newMsgRef, {
      encryptedData: ciphertext,
      iv,
      senderId: clientId,
      timestamp: serverTimestamp(),
    });
    msgInput.value = "";
    clearTimeout(typingTimeout);
    isTyping = false;
    remove(ref(db, `rooms/${roomId}/typing/${clientId}`));
  } catch (err) {
    console.error("Send failed:", err);
  } finally {
    sendBtn.disabled = false;
    msgInput.focus();
  }
});

function renderMessage({ text, sentByMe, timestamp }) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${sentByMe ? "sent" : "received"}`;

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = formatTime(timestamp);

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function addSystemMessage(text) {
  const el = document.createElement("div");
  el.className = "sys-msg";
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ---------------- expiry countdown ---------------- */
function setupExpiryWatch() {
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    clearInterval(countdownTimer);
    teardown();
    showStatus("✕", "Room expired", "This room's 30-minute lifetime has ended and all messages were permanently deleted.", true);
    return;
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  expiresInEl.textContent = `${mm}:${ss}`;

  const pct = Math.max(0, Math.min(100, (remainingMs / (30 * 60 * 1000)) * 100));
  expiryBar.style.width = pct + "%";
  expiryBar.classList.toggle("warn", pct <= 33 && pct > 10);
  expiryBar.classList.toggle("danger", pct <= 10);
}

function teardown() {
  remove(ref(db, `rooms/${roomId}/presence/${clientId}`)).catch(() => {});
  remove(ref(db, `rooms/${roomId}/typing/${clientId}`)).catch(() => {});
}

window.addEventListener("beforeunload", teardown);

/* ---------------- connection indicator ---------------- */
function setupConnectionIndicator() {
  onValue(ref(db, ".info/connected"), (snap) => {
    const isConnected = snap.val() === true;
    connStatus.classList.toggle("online", isConnected);
    connStatus.classList.toggle("offline", !isConnected);
    connText.textContent = isConnected ? "ONLINE" : "RECONNECTING";
  });
}

/* ---------------- utils ---------------- */
function getOrCreateClientId() {
  const key = "cyberchat_client_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

init();
