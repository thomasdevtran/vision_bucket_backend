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

const COMMENTS_COLLECTION = 'comments';
const parentKey = (parentType, parentId) => `${parentType}:${parentId}`;

const toCommentRecord = snapshot => ({
  id: snapshot.id,
  ...snapshot.data()
});

const toApiComment = comment => ({
  author: comment.author,
  uid: comment.authorId || undefined,
  content: comment.content,
  date: comment.date,
  commentId: comment.id
});

const listCommentRecords = async (parentType, parentId) => {
  const snapshot = await getDocs(query(
    collection(db, COMMENTS_COLLECTION),
    where('parentKey', '==', parentKey(parentType, parentId))
  ));

  return snapshot.docs
    .map(toCommentRecord)
    .sort((left, right) => String(left.date || left.createdAt).localeCompare(String(right.date || right.createdAt)));
};

const createComment = async ({ parentType, parentId, authorId, author, content, date }) => {
  const commentRef = doc(collection(db, COMMENTS_COLLECTION));
  const comment = {
    parentType,
    parentId,
    parentKey: parentKey(parentType, parentId),
    authorId: authorId || null,
    author,
    content,
    date,
    createdAt: new Date().toISOString()
  };

  await setDoc(commentRef, comment);
  return toApiComment({ id: commentRef.id, ...comment });
};

const findComment = async (parentType, parentId, commentId) => {
  const directSnapshot = await getDoc(doc(db, COMMENTS_COLLECTION, commentId));
  if (directSnapshot.exists()) {
    const direct = toCommentRecord(directSnapshot);
    return direct.parentType === parentType && direct.parentId === parentId ? direct : null;
  }

  const records = await listCommentRecords(parentType, parentId);
  return records.find(record => record.legacyCommentId === commentId) || null;
};

const deleteComment = comment => deleteDoc(doc(db, COMMENTS_COLLECTION, comment.id));

const deleteCommentsForParent = async (parentType, parentId) => {
  const comments = await listCommentRecords(parentType, parentId);
  for (let offset = 0; offset < comments.length; offset += 500) {
    const batch = db.batch();
    for (const comment of comments.slice(offset, offset + 500)) {
      batch.delete(doc(db, COMMENTS_COLLECTION, comment.id));
    }
    await batch.commit();
  }
  return comments.length;
};

const mergeWithLegacyComments = (records, legacyComments = []) => {
  const migratedLegacyIds = new Set(records.map(record => record.legacyCommentId).filter(Boolean));
  const normalized = records.map(toApiComment);
  const remainingLegacy = legacyComments.filter(comment => !migratedLegacyIds.has(comment.commentId));
  return [...remainingLegacy, ...normalized];
};

module.exports = {
  COMMENTS_COLLECTION,
  createComment,
  deleteComment,
  deleteCommentsForParent,
  findComment,
  listCommentRecords,
  mergeWithLegacyComments,
  parentKey,
  toApiComment
};
