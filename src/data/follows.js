const {
  db,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where
} = require('../firebase');

const FOLLOWS_COLLECTION = 'follows';

// Deterministic doc id makes a follow idempotent (re-follow overwrites the same
// document) and lets unfollow delete directly without a lookup query.
const followDocumentId = (followerId, followeeId) => `${followerId}_${followeeId}`;

const createFollow = async (followerId, followeeId) => {
  const now = new Date().toISOString();
  const followRef = doc(db, FOLLOWS_COLLECTION, followDocumentId(followerId, followeeId));
  const existing = await getDoc(followRef);
  const createdAt = existing.exists() ? existing.data().createdAt : now;

  await setDoc(followRef, { followerId, followeeId, createdAt }, { merge: true });
  return { followerId, followeeId, createdAt };
};

const removeFollow = async (followerId, followeeId) => {
  const followRef = doc(db, FOLLOWS_COLLECTION, followDocumentId(followerId, followeeId));
  const existing = await getDoc(followRef);
  if (!existing.exists()) return false;
  await deleteDoc(followRef);
  return true;
};

// Ids of the users that `followerId` follows.
const listFolloweeIds = async followerId => {
  const snapshot = await getDocs(query(
    collection(db, FOLLOWS_COLLECTION),
    where('followerId', '==', followerId)
  ));
  return snapshot.docs.map(snapshotDoc => snapshotDoc.data().followeeId);
};

// Ids of the users that follow `followeeId`.
const listFollowerIds = async followeeId => {
  const snapshot = await getDocs(query(
    collection(db, FOLLOWS_COLLECTION),
    where('followeeId', '==', followeeId)
  ));
  return snapshot.docs.map(snapshotDoc => snapshotDoc.data().followerId);
};

const isFollowing = async (followerId, followeeId) => {
  const followRef = doc(db, FOLLOWS_COLLECTION, followDocumentId(followerId, followeeId));
  const existing = await getDoc(followRef);
  return existing.exists();
};

module.exports = {
  FOLLOWS_COLLECTION,
  followDocumentId,
  createFollow,
  removeFollow,
  listFolloweeIds,
  listFollowerIds,
  isFollowing
};
