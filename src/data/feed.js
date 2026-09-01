const { db, collection, getDocs, query, where } = require('../firebase');
const { listFolloweeIds } = require('./follows');

// Feed strategy: read-time fan-in.
//
// Fan-out-on-write would append an activity item into every follower's feed
// collection whenever a user posts. That makes reads O(1) but writes O(followers)
// and duplicates data heavily -- worth it only at very large read:write ratios
// with celebrity-scale fan-out. Fan-in-on-read instead resolves the followee set
// at read time and queries their recent activity on demand. Writes stay untouched
// (we never modify the Reviews/watch_entries write paths) and there is no data to
// keep in sync. For this app's scale (small followee lists) the read cost is
// trivial, so we choose read-time fan-in.

// Firestore `in` queries accept at most 10 values, so split larger id sets.
const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const fetchByUidField = async (collectionName, uidField, uids) => {
  const results = [];
  for (const idChunk of chunk(uids, 10)) {
    const snapshot = await getDocs(query(
      collection(db, collectionName),
      where(uidField, 'in', idChunk)
    ));
    results.push(...snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
  }
  return results;
};

const reviewActivity = review => ({
  id: `review_${review.id}`,
  type: 'review',
  actorUid: review.uid,
  actorName: review.Author,
  timestamp: review.date || null,
  movieId: review.movieId,
  content: review.content,
  rating: review.rating,
  refId: review.id
});

const watchEntryActivity = entry => ({
  id: `watch_${entry.id}`,
  type: 'watch',
  actorUid: entry.userId,
  actorName: null,
  timestamp: entry.updatedAt || entry.createdAt || null,
  movieId: entry.movieId,
  status: entry.status,
  rating: entry.rating,
  refId: entry.id
});

// Build a paginated, newest-first activity feed for the users `followerId` follows.
// Cursor is an ISO timestamp; only items strictly older than the cursor are returned.
const buildFeed = async (followerId, { cursor, limit = 20 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const followeeIds = await listFolloweeIds(followerId);

  if (followeeIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  const activities = [];

  // Reviews are a hard dependency of the feed.
  const reviews = await fetchByUidField('Reviews', 'uid', followeeIds);
  activities.push(...reviews.map(reviewActivity));

  // watch_entries may or may not exist depending on rollout; include defensively.
  try {
    const watchEntries = await fetchByUidField('watch_entries', 'userId', followeeIds);
    activities.push(...watchEntries.map(watchEntryActivity));
  } catch {
    // Collection missing or unreadable -- skip without failing the feed.
  }

  const sorted = activities
    .filter(item => item.timestamp)
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));

  const afterCursor = cursor
    ? sorted.filter(item => new Date(item.timestamp) < new Date(cursor))
    : sorted;

  const items = afterCursor.slice(0, safeLimit);
  const nextCursor = items.length === safeLimit && afterCursor.length > safeLimit
    ? items[items.length - 1].timestamp
    : null;

  return { items, nextCursor };
};

module.exports = { buildFeed };
