// functions/index.js
// Server-side guarantee that rooms disappear on schedule, even if no
// user is online to trigger client-side cleanup.
//
// Runs every 1 minute, scans all rooms, and permanently deletes any
// room (metadata + messages + presence + typing indicators + any
// other room-scoped data) whose expiresAt has passed.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.database();

exports.cleanupExpiredRooms = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Etc/UTC",
    retryCount: 1,
  },
  async () => {
    const now = Date.now();
    const roomsRef = db.ref("rooms");

    const snapshot = await roomsRef.once("value");
    if (!snapshot.exists()) {
      logger.info("cleanupExpiredRooms: no rooms present");
      return;
    }

    const deletions = [];
    const deletedIds = [];

    snapshot.forEach((roomSnap) => {
      const roomId = roomSnap.key;
      const meta = roomSnap.child("meta").val();

      // Treat a room as expired if it's past expiresAt, OR if it has
      // no valid meta at all (orphaned/corrupt data shouldn't linger).
      const expiresAt = meta && typeof meta.expiresAt === "number" ? meta.expiresAt : null;
      const isExpired = !expiresAt || expiresAt <= now;

      if (isExpired) {
        // Deleting the room node removes meta, messages, presence,
        // typing, and any other child data in one atomic operation.
        deletions.push(db.ref(`rooms/${roomId}`).remove());
        deletedIds.push(roomId);
      }
    });

    if (deletions.length === 0) {
      logger.info("cleanupExpiredRooms: no expired rooms this pass");
      return;
    }

    await Promise.all(deletions);
    logger.info(`cleanupExpiredRooms: deleted ${deletions.length} room(s)`, {
      deletedRoomIds: deletedIds,
    });
  }
);
