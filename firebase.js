// firebase.js
// Central Firebase init. Import { db } from this module wherever you
// need Realtime Database access. Uses Firebase SDK v12 (modular, CDN).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
  query,
  limitToLast,
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

// NOTE: A Firebase web apiKey is a public identifier, not a secret —
// it's safe to ship in client code. Actual access control lives in
// database.rules.json (see that file / the deployment guide).
const firebaseConfig = {
  apiKey: "AIzaSyCo4-4XyiSH1aUxF-KjaNskWihC34Z2EAg",
  authDomain: "cyber-chat-59372.firebaseapp.com",
  databaseURL: "https://cyber-chat-59372-default-rtdb.firebaseio.com",
  projectId: "cyber-chat-59372",
  storageBucket: "cyber-chat-59372.firebasestorage.app",
  messagingSenderId: "1001802982192",
  appId: "1:1001802982192:web:ccea2193441f41c5961ef5",
  measurementId: "G-WQ1W5MNE39",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export {
  db,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
  query,
  limitToLast,
};
