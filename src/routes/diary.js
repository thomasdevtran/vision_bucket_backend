// routes/diary.js - the viewing diary: an append-only log of watches (rewatches
// included). Mounted at /profile/diary. Identity always comes from the token.
const express = require('express');
const router = express.Router();
const { updateDoc, deleteDoc, getDoc } = require('../firebase');
const { authenticate } = require('../middleware/authenticate');
const { AppError } = require('../errors');
const { validateDiaryEntry, validateDiaryUpdate } = require('../validation');
const {
  serializeEntry,
  createDiaryEntry,
  listDiaryEntries,
  loadDiaryEntry
} = require('../data/diaryEntries');

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// POST /profile/diary - log a watch for the authenticated user.
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const validation = validateDiaryEntry(req.body);
  if (!validation.valid) {
    throw new AppError(400, 'invalid_diary_entry', validation.errors.join(', '));
  }
  const entry = await createDiaryEntry({ userId: req.user.uid, ...validation.value });
  res.status(201).json(entry);
}));

// GET /profile/diary/:uid - newest-first, cursor-paginated diary for a user.
// Query: ?cursor=<ISO watchedAt>&limit=<n>.
router.get('/:uid', asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const { entries, nextCursor } = await listDiaryEntries(req.params.uid, { cursor, limit });
  res.status(200).json({ entries, nextCursor });
}));

// PATCH /profile/diary/:entryId - edit rating/notes/watchedAt (owner only).
router.patch('/:entryId', authenticate, asyncHandler(async (req, res) => {
  const { ref, data } = await loadDiaryEntry(req.params.entryId);
  if (!data || data.userId !== req.user.uid) {
    throw new AppError(404, 'not_found', 'Diary entry not found');
  }
  const validation = validateDiaryUpdate(req.body);
  if (!validation.valid) {
    throw new AppError(400, 'invalid_diary_update', validation.errors.join(', '));
  }
  await updateDoc(ref, { ...validation.value, updatedAt: new Date().toISOString() });
  const updated = await getDoc(ref);
  res.status(200).json(serializeEntry(req.params.entryId, updated.data()));
}));

// DELETE /profile/diary/:entryId - remove an entry (owner only).
router.delete('/:entryId', authenticate, asyncHandler(async (req, res) => {
  const { ref, data } = await loadDiaryEntry(req.params.entryId);
  if (!data || data.userId !== req.user.uid) {
    throw new AppError(404, 'not_found', 'Diary entry not found');
  }
  await deleteDoc(ref);
  res.status(200).json({ message: 'Diary entry deleted successfully' });
}));

module.exports = router;
