// app.js — Home page logic (index.html)
// Handles: room creation, writing room metadata to Firebase,
// building the shareable link, and joining an existing room.

import { db, ref, set, serverTimestamp } from "./firebase.js";
import { generateRoomId, generateRoomSecret } from "./crypto.js";

const ROOM_LIFETIME_MS = 30 * 60 * 1000; // exactly 30 minutes

const createBtn = document.getElementById("createBtn");
const createBtnLabel = document.getElementById("createBtnLabel");
const readout = document.getElementById("readout");
const roomIdOut = document.getElementById("roomIdOut");
const roomLinkOut = document.getElementById("roomLinkOut");
const copyBtn = document.getElementById("copyBtn");
const enterRoomBtn = document.getElementById("enterRoomBtn");
const joinInput = document.getElementById("joinInput");
const joinBtn = document.getElementById("joinBtn");
const connStatus = document.getElementById("connStatus");
const connText = document.getElementById("connText");

function buildRoomLink(roomId, secret) {
  const base = window.location.origin + window.location.pathname.replace(/index\.html$/, "");
  return `${base}chat.html?room=${roomId}#${secret}`;
}

createBtn.addEventListener("click", async () => {
  createBtn.disabled = true;
  createBtnLabel.textContent = "Generating keys…";

  try {
    const roomId = generateRoomId(10); // 10-char, within the 8–12 requirement
    const secret = generateRoomSecret(); // never sent to Firebase

    const createdAt = Date.now();
    const expiresAt = createdAt + ROOM_LIFETIME_MS;

    // Only non-secret metadata is written to Firebase.
    await set(ref(db, `rooms/${roomId}/meta`), {
      createdAt: serverTimestamp(),
      expiresAt, // client-computed; Cloud Function re-validates server-side
      active: true,
    });

    const link = buildRoomLink(roomId, secret);
    roomIdOut.textContent = roomId;
    roomLinkOut.textContent = link;
    enterRoomBtn.href = link;
    readout.classList.add("show");
    createBtnLabel.textContent = "Room ready ✓";
  } catch (err) {
    console.error("Room creation failed:", err);
    createBtnLabel.textContent = "Failed — retry";
    createBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  const link = roomLinkOut.textContent;
  if (!link || link === "—") return;
  try {
    await navigator.clipboard.writeText(link);
    copyBtn.textContent = "COPIED";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "COPY";
      copyBtn.classList.remove("copied");
    }, 1800);
  } catch {
    // clipboard API unavailable — fall back to manual selection
    const range = document.createRange();
    range.selectNodeContents(roomLinkOut);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

joinBtn.addEventListener("click", () => tryJoin());
joinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryJoin();
});

function tryJoin() {
  const raw = joinInput.value.trim();
  if (!raw) return;

  // Accept either a full link or a bare room ID.
  if (raw.includes("chat.html") || raw.includes("?room=")) {
    try {
      const url = new URL(raw, window.location.href);
      window.location.href = url.href.includes("#")
        ? raw
        : raw; // preserve fragment as typed
      return;
    } catch {
      // fall through to treat as room ID
    }
  }
  // Bare room ID — no secret available, chat.html will show an error
  // asking the user to use the full link instead.
  window.location.href = `chat.html?room=${encodeURIComponent(raw)}`;
}

// Basic connectivity indicator for the home page.
window.addEventListener("online", () => setConn(true));
window.addEventListener("offline", () => setConn(false));
function setConn(isOnline) {
  connStatus.classList.toggle("online", isOnline);
  connStatus.classList.toggle("offline", !isOnline);
  connText.textContent = isOnline ? "ONLINE" : "OFFLINE";
}
