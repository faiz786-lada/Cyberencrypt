# CYBER-CHAT — Encrypted, Self-Destructing Chat Rooms

A pure HTML/CSS/JS real-time chat app. Rooms are end-to-end encrypted
(AES-256-GCM via the Web Crypto API) and auto-delete exactly 30 minutes
after creation — both client-side and, more importantly, **server-side**
via a scheduled Firebase Cloud Function, so rooms are deleted even if
nobody is around to trigger it.

## File structure

```
index.html            Home page — create / join a room
chat.html              Chat room page (shell only, logic in chat.js)
style.css              All styling (cyber/terminal theme)
firebase.js            Firebase app + Realtime Database init
crypto.js               AES-256-GCM encryption helpers (Web Crypto API)
app.js                  Home page logic (index.html)
chat.js                 Chat room logic (chat.html)
firebase.json           Firebase CLI project config
database.rules.json     Realtime Database security rules
functions/
  index.js               Scheduled cleanup Cloud Function (runs every 1 min)
  package.json            Cloud Functions dependencies (Node 20)
```

> Note: the brief listed a single `app.js`. In practice, home-page logic
> and chat-room logic are different enough (and both substantial) that
> splitting them into `app.js` + `chat.js` keeps each file focused and
> maintainable — that's the only deviation from the file list.

## How the encryption works

1. When a room is created, the browser generates two independent random
   values: a **room ID** (path-safe, used as the Firebase key / URL
   query param) and a **room secret** (32 random bytes, used only to
   derive the encryption key).
2. The share link is `chat.html?room=ROOM_ID#SECRET`. The `#fragment`
   is **never sent over the network** by any browser — Firebase and
   your web server only ever see `ROOM_ID`.
3. Each participant's browser derives the same AES-256 key locally via
   PBKDF2(secret, salt = room ID, 150,000 iterations).
4. Every message is encrypted client-side before being written to
   Firebase; Firebase only ever stores `{ encryptedData, iv }` — never
   plaintext.
5. If someone doesn't have the link's fragment (e.g. pasted a bare room
   ID), `chat.js` detects the missing secret and refuses to proceed,
   rather than silently failing.

## Firebase data structure

```
rooms/
  ROOM_ID/
    meta/
      createdAt      (server timestamp)
      expiresAt       (epoch ms, createdAt + 30 min)
      active          (bool)
    messages/
      MESSAGE_ID/
        encryptedData  (base64 ciphertext)
        iv              (base64 IV)
        senderId
        timestamp
    presence/
      CLIENT_ID: { name, joinedAt }
    typing/
      CLIENT_ID: true
```

---

## 1. Firebase project setup

1. Go to the [Firebase Console](https://console.firebase.google.com)
   and open (or create) your project — the config already targets
   `cyber-chat-59372`.
2. **Realtime Database** → create a database if you haven't (any
   region), start in **locked mode** (rules below override this).
3. Upgrade the project to the **Blaze (pay-as-you-go)** plan. Scheduled
   Cloud Functions require Blaze — the free tier isn't eligible. Blaze
   still has a generous free quota; a low-traffic app like this stays
   within it.
4. Install the Firebase CLI and log in:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
5. From the project folder:
   ```bash
   firebase use --add
   # select cyber-chat-59372, give it an alias e.g. "default"
   ```

## 2. Deploy the database rules

```bash
firebase deploy --only database
```

This pushes `database.rules.json`, which:
- Allows anyone to **create** a room's `meta` once, as long as
  `expiresAt` is at most 30 minutes out.
- Blocks all reads/writes to `meta`, `messages`, `presence`, and
  `typing` once `expiresAt` has passed or `active` isn't `true`.
- Validates the shape of every message (required fields, size caps).
- Denies access to anything outside `rooms/`.

**Important:** Realtime Database rules are notoriously easy to get
subtly wrong. Before going to production, test them with the
[Firebase Rules Playground](https://firebase.google.com/docs/database/security/test-rules-emulator)
or the local emulator (`firebase emulators:start`), especially the
interaction between the room-level and child-level rules.

## 3. Deploy the Cloud Function

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

This deploys `cleanupExpiredRooms`, a `firebase-functions/v2` scheduled
function that runs every minute, scans `rooms/`, and deletes any room
whose `expiresAt` has passed — metadata, messages, presence, and typing
data all go in one atomic `remove()`. Because it runs on Firebase's
infrastructure on a fixed schedule, it deletes expired rooms **even if
zero users are connected**.

Check it's running:
```bash
firebase functions:log
```

## 4. Frontend deployment (Netlify)

No build step is required — this is static HTML/CSS/JS loading Firebase
from the CDN via ES modules.

**Option A — Netlify CLI**
```bash
npm install -g netlify-cli
netlify login
netlify init          # or: netlify deploy --prod --dir .
```

**Option B — Netlify dashboard**
1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket).
2. Netlify → **Add new site → Import an existing project**.
3. Build command: *(leave blank)*. Publish directory: `.` (repo root,
   or wherever `index.html` lives).
4. Deploy.

**Option C — drag and drop**
Zip the folder (excluding `functions/`) and drag it onto
[app.netlify.com/drop](https://app.netlify.com/drop).

After deploying, add your Netlify domain to Firebase: **Authentication →
Settings → Authorized domains** (even though this app doesn't use
Firebase Auth, some Firebase features check this list) — and double
check `firebase.json` isn't required by Netlify (it's only used by the
Firebase CLI for Functions/Database, not for hosting).

## 5. Smoke test

1. Open the deployed site → **Create secure room**.
2. Copy the link, open it in a private/incognito window (simulating a
   second participant).
3. Send messages both ways — confirm they appear instantly, decrypted,
   with correct sent/received styling and timestamps.
4. Check the Firebase console → Realtime Database → confirm
   `messages/*/encryptedData` is unreadable ciphertext, never plaintext.
5. Wait for the 30-minute countdown (or temporarily shrink
   `ROOM_LIFETIME_MS` in `app.js` and the function's schedule check to
   test faster) and confirm both tabs land on the "Room expired" screen
   and the room node disappears from the database.

## Known limitations / things to harden further for real production use

- There's no rate limiting on room creation or messages — for a public
  deployment, consider Firebase App Check to block scripted abuse.
- Presence/typing use `onDisconnect()`, which is reliable but not
  instant on flaky connections (a brief delay before a "left" state
  shows is normal Realtime Database behavior).
- The Cloud Function runs once a minute, so a room can live up to ~60
  seconds past its exact `expiresAt` before server-side deletion — the
  client independently locks itself out at the exact timestamp via the
  database rules, so no reads/writes are possible in that gap either way.
