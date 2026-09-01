const {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc
} = require('../firebase');
const { upsertWatchEntry } = require('./watchEntries');

const DIARY_ENTRIES_COLLECTION = 'diary_entries';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// A diary entry is an append-only log of one viewing. Unlike watch_entries
// (one deterministic doc per user/movie holding the current status), the diary
// allows multiple docs per user/movie so rewatches form a timeline. Docs use
// Firestore auto-ids -- nothing is deduplicated by user/movie.
const serializeEntry = (id, data) => ({
  id,
  userId: data.userId,
  movieId: data.movieId,
  watchedAt: data.watchedAt,
  rating: data.rating === undefined ? null : data.rating,
  notes: data.notes === undefined ? null : data.notes,
  rewatch: data.rewatch === true,
  createdAt: data.createdAt
});

// Newest-first ordering: primary key watchedAt, tie-broken by createdAt so
// same-day entries (including a rewatch logged the same day) stay deterministic.
const byWatchedAtDesc = (left, right) => {
  const delta = new Date(right.watchedAt) - new Date(left.watchedAt);
  if (delta !== 0) return delta;
  return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
};

// Best-effort mirror of the latest viewing onto the movie's watch_entries doc so
// status/rating stay roughly in sync. Never allowed to break a diary write.
const syncWatchEntry = async ({ userId, movieId, watchedAt, rating, rewatch }) => {
  try {
    await upsertWatchEntry({
      userId,
      movieId,
      status: rewatch ? 'Rewatched' : 'Completed',
      watchedAt,
      ...(rating !== undefined && rating !== null ? { rating } : {})
    });
  } catch {
    // Sync is optional; swallow so the diary entry still succeeds.
  }
};

const createDiaryEntry = async ({ userId, movieId, watchedAt, rating, notes, rewatch }) => {
  const now = new Date().toISOString();
  const entry = { userId, movieId, watchedAt, rewatch: rewatch === true, createdAt: now };
  if (rating !== undefined && rating !== null) entry.rating = rating;
  if (notes !== undefined && notes !== null && notes !== '') entry.notes = notes;

  const ref = await addDoc(collection(db, DIARY_ENTRIES_COLLECTION), entry);
  await syncWatchEntry({ userId, movieId, watchedAt, rating, rewatch: entry.rewatch });
  return serializeEntry(ref.id, entry);
};

// Fetch a user's diary, sorted newest-first and paginated in memory (no
// composite index needed). Cursor is the ISO watchedAt of the last item on the
// previous page; only strictly-older entries are returned next.
const listDiaryEntries = async (userId, { cursor, limit } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const snapshot = await getDocs(query(
    collection(db, DIARY_ENTRIES_COLLECTION),
    where('userId', '==', userId)
  ));

  const sorted = snapshot.docs
    .map(snapshotDoc => serializeEntry(snapshotDoc.id, snapshotDoc.data()))
    .sort(byWatchedAtDesc);

  const afterCursor = cursor
    ? sorted.filter(item => new Date(item.watchedAt) < new Date(cursor))
    : sorted;

  const entries = afterCursor.slice(0, safeLimit);
  const nextCursor = entries.length === safeLimit && afterCursor.length > safeLimit
    ? entries[entries.length - 1].watchedAt
    : null;

  return { entries, nextCursor };
};

// Load a single entry; returns { ref, data } with data === null when missing.
const loadDiaryEntry = async entryId => {
  const ref = doc(db, DIARY_ENTRIES_COLLECTION, entryId);
  const snapshot = await getDoc(ref);
  return { ref, data: snapshot.exists() ? snapshot.data() : null };
};

module.exports = {
  DIARY_ENTRIES_COLLECTION,
  serializeEntry,
  createDiaryEntry,
  listDiaryEntries,
  loadDiaryEntry,
  syncWatchEntry
};
