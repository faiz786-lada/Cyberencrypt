// crypto.js
// End-to-end encryption for CYBER-CHAT.
// The room secret NEVER leaves the browser: it lives only in the URL
// fragment (after '#'), which browsers never send to a server, and is
// used to derive an AES-GCM 256 key via PBKDF2. Firebase only ever
// stores ciphertext + IV.

const PBKDF2_ITERATIONS = 150000;
const KEY_LENGTH_BITS = 256;

/**
 * Generate a cryptographically secure random secret for a new room.
 * This is the value that goes in the URL fragment (#secret).
 * 32 bytes -> 43-char base64url string, effectively unguessable.
 */
export function generateRoomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Generate a hard-to-guess room ID (used in the URL path / DB key).
 * This is NOT the secret — it's just an identifier. Default 10 chars
 * from a large alphabet, well within the 8-12 char requirement.
 */
export function generateRoomId(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

/**
 * Derive an AES-GCM-256 CryptoKey from the room secret + room ID (used
 * as salt so the same secret can't be replayed against another room).
 */
export async function deriveRoomKey(secret, roomId) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('cyberchat-room-' + roomId),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string. Returns { ciphertext, iv } both as
 * base64 strings, ready to store in Firebase.
 */
export async function encryptMessage(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    iv: bytesToBase64(iv),
  };
}

/**
 * Decrypt { ciphertext, iv } (base64 strings) back to plaintext.
 * Throws if the key is wrong or data was tampered with.
 */
export async function decryptMessage(key, ciphertext, iv) {
  const dec = new TextDecoder();
  const cipherBytes = base64ToBytes(ciphertext);
  const ivBytes = base64ToBytes(iv);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    cipherBytes
  );
  return dec.decode(plainBuf);
}

/* ---------------- base64 helpers ---------------- */

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
