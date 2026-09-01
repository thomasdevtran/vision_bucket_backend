// routes/lists.js
const express = require('express');
const router = express.Router();
const {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove
} = require('../firebase');
const { auth } = require('../firebaseAdmin');
const { authenticate } = require('../middleware/authenticate');
const {
  validateListCreate,
  validateListUpdate,
  validateListItem,
  validateReorder,
  toInteger
} = require('../validation');

const LISTS = 'lists';

// Optional authentication: resolve the caller's uid from a bearer token when one
// is present, but never reject the request. Used by public read endpoints so a
// signed-in owner/collaborator can see their own private lists.
const resolveUid = async req => {
  const authorization = req.get('authorization');
  const match = authorization && authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  try {
    const decoded = await auth.verifyIdToken(match[1]);
    return decoded.uid;
  } catch {
    return null;
  }
};

// Authorization helpers. Identity always comes from the token, never the body.
const canView = (list, uid) =>
  list.isPublic === true || (!!uid && (list.ownerId === uid || (list.collaboratorIds || []).includes(uid)));
const canEdit = (list, uid) =>
  !!uid && (list.ownerId === uid || (list.collaboratorIds || []).includes(uid));
const isOwner = (list, uid) => !!uid && list.ownerId === uid;

// Sort by explicit position and re-derive contiguous 1-based positions so stored
// order is always normalized.
const normalizeItems = items => {
  if (!Array.isArray(items)) return [];
  return [...items]
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((item, index) => ({
      movieId: item.movieId,
      position: index + 1,
      ...(item.note !== undefined && item.note !== '' ? { note: item.note } : {})
    }));
};

const serializeList = (id, data) => ({
  id,
  ownerId: data.ownerId,
  title: data.title,
  description: data.description || '',
  isPublic: data.isPublic === true,
  collaboratorIds: data.collaboratorIds || [],
  items: normalizeItems(data.items),
  createdAt: data.createdAt,
  updatedAt: data.updatedAt
});

// Load a list document; returns { ref, data } or { ref, data: null } when missing.
const loadList = async id => {
  const ref = doc(db, LISTS, id);
  const snap = await getDoc(ref);
  return { ref, data: snap.exists() ? snap.data() : null };
};

// POST /lists - create a list owned by the authenticated user
router.post('/', authenticate, async (req, res) => {
  try {
    const validation = validateListCreate(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid list', details: validation.errors });
    }

    const now = new Date().toISOString();
    const newList = {
      ownerId: req.user.uid,
      title: validation.value.title,
      description: validation.value.description,
      isPublic: validation.value.isPublic,
      collaboratorIds: [],
      items: [],
      createdAt: now,
      updatedAt: now
    };

    const docRef = await addDoc(collection(db, LISTS), newList);
    res.status(201).json(serializeList(docRef.id, newList));
  } catch (error) {
    console.error('Error creating list:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

// GET /lists/user/:uid - lists owned by :uid that the caller may view
router.get('/user/:uid', async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const callerUid = await resolveUid(req);
    const snapshot = await getDocs(query(collection(db, LISTS), where('ownerId', '==', targetUid)));
    const lists = snapshot.docs
      .map(listDoc => serializeList(listDoc.id, listDoc.data()))
      .filter(list => canView(list, callerUid))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    res.status(200).json(lists);
  } catch (error) {
    console.error('Error fetching user lists:', error);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

// GET /lists/:id - 200 if the caller may view, otherwise 404 (private lists stay hidden)
router.get('/:id', async (req, res) => {
  try {
    const { data } = await loadList(req.params.id);
    const callerUid = await resolveUid(req);
    if (!data || !canView(data, callerUid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    res.status(200).json(serializeList(req.params.id, data));
  } catch (error) {
    console.error('Error fetching list:', error);
    res.status(500).json({ error: 'Failed to fetch list' });
  }
});

// PATCH /lists/:id - update metadata (owner or collaborator)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { ref, data } = await loadList(req.params.id);
    if (!data || !canView(data, req.user.uid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!canEdit(data, req.user.uid)) {
      return res.status(403).json({ error: 'Unauthorized: You are not allowed to edit this list' });
    }
    const validation = validateListUpdate(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid list update', details: validation.errors });
    }
    await updateDoc(ref, { ...validation.value, updatedAt: new Date().toISOString() });
    const updated = await getDoc(ref);
    res.status(200).json(serializeList(req.params.id, updated.data()));
  } catch (error) {
    console.error('Error updating list:', error);
    res.status(500).json({ error: 'Failed to update list' });
  }
});

// DELETE /lists/:id - delete a list (owner only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { ref, data } = await loadList(req.params.id);
    if (!data || !canView(data, req.user.uid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!isOwner(data, req.user.uid)) {
      return res.status(403).json({ error: 'Unauthorized: Only the owner can delete this list' });
    }
    await deleteDoc(ref);
    res.status(200).json({ message: 'List deleted successfully' });
  } catch (error) {
    console.error('Error deleting list:', error);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

// POST /lists/:id/items - append a movie (owner or collaborator)
router.post('/:id/items', authenticate, async (req, res) => {
  try {
    const { ref, data } = await loadList(req.params.id);
    if (!data || !canView(data, req.user.uid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!canEdit(data, req.user.uid)) {
      return res.status(403).json({ error: 'Unauthorized: You are not allowed to edit this list' });
    }
    const validation = validateListItem(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid list item', details: validation.errors });
    }

    const items = normalizeItems(data.items);
    if (items.some(item => String(item.movieId) === String(validation.value.movieId))) {
      return res.status(409).json({ error: 'Movie is already in this list' });
    }
    items.push({
      movieId: validation.value.movieId,
      position: items.length + 1,
      ...(validation.value.note !== undefined ? { note: validation.value.note } : {})
    });
    await updateDoc(ref, { items, updatedAt: new Date().toISOString() });
    res.status(201).json(serializeList(req.params.id, { ...data, items }));
  } catch (error) {
    console.error('Error adding list item:', error);
    res.status(500).json({ error: 'Failed to add list item' });
  }
});

// PATCH /lists/:id/items - reorder items via the new ordered array of movieIds
router.patch('/:id/items', authenticate, async (req, res) => {
  try {
    const { ref, data } = await loadList(req.params.id);
    if (!data || !canView(data, req.user.uid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!canEdit(data, req.user.uid)) {
      return res.status(403).json({ error: 'Unauthorized: You are not allowed to edit this list' });
    }
    const validation = validateReorder(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid reorder', details: validation.errors });
    }

    const existing = normalizeItems(data.items);
    const byId = new Map(existing.map(item => [String(item.movieId), item]));
    const order = validation.value.order;
    if (order.length !== existing.length || order.some(movieId => !byId.has(String(movieId)))) {
      return res.status(400).json({ error: 'Reorder must reference exactly the movies already in the list' });
    }
    const items = order.map((movieId, index) => {
      const previous = byId.get(String(movieId));
      return {
        movieId: previous.movieId,
        position: index + 1,
        ...(previous.note !== undefined ? { note: previous.note } : {})
      };
    });
    await updateDoc(ref, { items, updatedAt: new Date().toISOString() });
    res.status(200).json(serializeList(req.params.id, { ...data, items }));
  } catch (error) {
    console.error('Error reordering list:', error);
    res.status(500).json({ error: 'Failed to reorder list' });
  }
});

// DELETE /lists/:id/items/:movieId - remove an item and re-normalize positions
router.delete('/:id/items/:movieId', authenticate, async (req, res) => {
  try {
    const movieId = toInteger(req.params.movieId);
    if (movieId === null || movieId < 1) {
      return res.status(400).json({ error: 'Invalid movie id' });
    }
    const { ref, data } = await loadList(req.params.id);
    if (!data || !canView(data, req.user.uid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!canEdit(data, req.user.uid)) {
      return res.status(403).json({ error: 'Unauthorized: You are not allowed to edit this list' });
    }
    const existing = normalizeItems(data.items);
    const remaining = existing.filter(item => String(item.movieId) !== String(movieId));
    if (remaining.length === existing.length) {
      return res.status(404).json({ error: 'Movie is not in this list' });
    }
    const items = remaining.map((item, index) => ({ ...item, position: index + 1 }));
    await updateDoc(ref, { items, updatedAt: new Date().toISOString() });
    res.status(200).json(serializeList(req.params.id, { ...data, items }));
  } catch (error) {
    console.error('Error removing list item:', error);
    res.status(500).json({ error: 'Failed to remove list item' });
  }
});

// POST /lists/:id/collaborators - add a collaborator (owner only)
router.post('/:id/collaborators', authenticate, async (req, res) => {
  try {
    const { ref, data } = await loadList(req.params.id);
    if (!data || !canView(data, req.user.uid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!isOwner(data, req.user.uid)) {
      return res.status(403).json({ error: 'Unauthorized: Only the owner can manage collaborators' });
    }
    const { uid } = req.body;
    if (typeof uid !== 'string' || uid.trim().length === 0) {
      return res.status(400).json({ error: 'A collaborator uid is required' });
    }
    const collaboratorUid = uid.trim();
    if (collaboratorUid === data.ownerId) {
      return res.status(400).json({ error: 'The owner cannot be added as a collaborator' });
    }
    const userSnap = await getDoc(doc(db, 'Users', collaboratorUid));
    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }
    await updateDoc(ref, { collaboratorIds: arrayUnion(collaboratorUid), updatedAt: new Date().toISOString() });
    const updated = await getDoc(ref);
    res.status(200).json(serializeList(req.params.id, updated.data()));
  } catch (error) {
    console.error('Error adding collaborator:', error);
    res.status(500).json({ error: 'Failed to add collaborator' });
  }
});

// DELETE /lists/:id/collaborators/:uid - remove a collaborator (owner only)
router.delete('/:id/collaborators/:uid', authenticate, async (req, res) => {
  try {
    const { ref, data } = await loadList(req.params.id);
    if (!data || !canView(data, req.user.uid)) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!isOwner(data, req.user.uid)) {
      return res.status(403).json({ error: 'Unauthorized: Only the owner can manage collaborators' });
    }
    await updateDoc(ref, {
      collaboratorIds: arrayRemove(req.params.uid),
      updatedAt: new Date().toISOString()
    });
    const updated = await getDoc(ref);
    res.status(200).json(serializeList(req.params.id, updated.data()));
  } catch (error) {
    console.error('Error removing collaborator:', error);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

module.exports = router;
