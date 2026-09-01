const {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc
} = require('../firebase');

const NOTIFICATIONS_COLLECTION = 'notifications';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// The set of notification types the emitter understands. Each maps to a default
// message so call sites can stay minimal and only supply who/what.
const NOTIFICATION_TYPES = ['follow', 'reaction', 'comment'];

const defaultMessage = (type, actorName) => {
  const who = actorName || 'Someone';
  switch (type) {
    case 'follow':
      return `${who} started following you`;
    case 'reaction':
      return `${who} reacted to your review`;
    case 'comment':
      return `${who} commented on your discussion`;
    default:
      return `${who} sent you a notification`;
  }
};

const serializeNotification = (id, data) => ({
  id,
  userId: data.userId,
  type: data.type,
  actorUid: data.actorUid,
  actorName: data.actorName === undefined ? null : data.actorName,
  entityType: data.entityType === undefined ? null : data.entityType,
  entityId: data.entityId === undefined ? null : data.entityId,
  message: data.message,
  read: data.read === true,
  createdAt: data.createdAt
});

// Best-effort lookup of the actor's display name so a notification can read
// "Ada started following you" rather than an opaque uid. Never fatal: a missing
// profile or a read failure just falls back to a generic message.
const resolveActorName = async actorUid => {
  try {
    const snapshot = await getDoc(doc(db, 'Users', actorUid));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return data.Username || data.username || null;
  } catch {
    return null;
  }
};

// Emit a notification for `userId` about `actorUid`'s action. Returns the stored
// notification, or null when it was intentionally skipped (self-action or an
// unknown type). Callers wrap this in try/catch so a failure here can never
// break the underlying follow/reaction/comment.
const createNotification = async ({
  userId,
  type,
  actorUid,
  actorName,
  entityType,
  entityId,
  message
}) => {
  if (!userId || !actorUid || !NOTIFICATION_TYPES.includes(type)) return null;
  // Never notify yourself about your own action.
  if (userId === actorUid) return null;

  const resolvedName = actorName || (await resolveActorName(actorUid));
  const notification = {
    userId,
    type,
    actorUid,
    actorName: resolvedName || null,
    entityType: entityType || null,
    entityId: entityId || null,
    message: message || defaultMessage(type, resolvedName),
    read: false,
    createdAt: new Date().toISOString()
  };

  const ref = await addDoc(collection(db, NOTIFICATIONS_COLLECTION), notification);
  return serializeNotification(ref.id, notification);
};

// Newest-first ordering: primary key createdAt, tie-broken by id so notifications
// written in the same millisecond keep a stable, deterministic order.
const byCreatedAtDesc = (left, right) => {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  return left.id < right.id ? 1 : (left.id > right.id ? -1 : 0);
};

// Cursor carries both createdAt and id so ties never drop or repeat an item.
const encodeCursor = item => `${item.createdAt}|${item.id}`;
const decodeCursor = cursor => {
  const separator = cursor.lastIndexOf('|');
  return separator === -1
    ? { createdAt: cursor, id: '' }
    : { createdAt: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
};
const isOlderThanCursor = (item, cursor) => item.createdAt < cursor.createdAt
  || (item.createdAt === cursor.createdAt && item.id < cursor.id);

// Fetch a recipient's notifications, newest-first and paginated in memory (no
// composite index needed). unreadCount always reflects the whole inbox, not just
// the current page.
const listNotifications = async (userId, { cursor, limit } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const snapshot = await getDocs(query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where('userId', '==', userId)
  ));

  const sorted = snapshot.docs
    .map(snapshotDoc => serializeNotification(snapshotDoc.id, snapshotDoc.data()))
    .sort(byCreatedAtDesc);

  const unreadCount = sorted.reduce((total, item) => total + (item.read ? 0 : 1), 0);

  const decoded = cursor ? decodeCursor(cursor) : null;
  const afterCursor = decoded
    ? sorted.filter(item => isOlderThanCursor(item, decoded))
    : sorted;

  const notifications = afterCursor.slice(0, safeLimit);
  const nextCursor = notifications.length === safeLimit && afterCursor.length > safeLimit
    ? encodeCursor(notifications[notifications.length - 1])
    : null;

  return { notifications, unreadCount, nextCursor };
};

// Mark one notification read (owner only). Returns the serialized notification,
// or null when it does not exist or belongs to another user - the route turns a
// null into a 404 so ownership is never leaked.
const markNotificationRead = async (notificationId, userId) => {
  const ref = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.userId !== userId) return null;
  if (data.read !== true) await updateDoc(ref, { read: true });
  return serializeNotification(notificationId, { ...data, read: true });
};

// Mark every unread notification for a user as read. Returns how many were
// updated. Batched so a large inbox stays within Firestore's 500-write limit.
const markAllNotificationsRead = async userId => {
  const snapshot = await getDocs(query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where('userId', '==', userId)
  ));
  const unread = snapshot.docs.filter(snapshotDoc => snapshotDoc.data().read !== true);
  for (let offset = 0; offset < unread.length; offset += 500) {
    const batch = db.batch();
    for (const snapshotDoc of unread.slice(offset, offset + 500)) {
      batch.update(snapshotDoc.ref, { read: true });
    }
    await batch.commit();
  }
  return unread.length;
};

module.exports = {
  NOTIFICATIONS_COLLECTION,
  NOTIFICATION_TYPES,
  createNotification,
  serializeNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  resolveActorName
};
