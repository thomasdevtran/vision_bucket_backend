const { db, collection, doc, getDoc, deleteDoc, setDoc } = require('../firebase');
const { deleteCommentsForParent } = require('./comments');

// The kinds of content a report can point at, and where that content lives.
const TARGET_TYPES = Object.freeze(['review', 'thread', 'comment']);
const REPORT_STATUSES = Object.freeze(['open', 'resolved', 'dismissed']);
const RESOLUTION_STATUSES = Object.freeze(['resolved', 'dismissed']);

const COMMENT_PARENT_TYPE = 'discussion_post';

// Map a target type to its Firestore document reference. Threads and comments
// reuse the same collections the discussions feature already owns.
const targetRef = (targetType, targetId) => {
  switch (targetType) {
    case 'review':
      return doc(db, 'Reviews', targetId);
    case 'thread':
      return doc(db, 'Disc_Posts', targetId);
    case 'comment':
      return doc(db, 'comments', targetId);
    default:
      return null;
  }
};

// Validate the body of a POST /reports request. Identity is never trusted from
// the body, only { targetType, targetId, reason } are read here.
const validateReportInput = ({ targetType, targetId, reason } = {}) => {
  const errors = [];
  if (!TARGET_TYPES.includes(targetType)) {
    errors.push(`targetType must be one of ${TARGET_TYPES.join(', ')}`);
  }
  if (typeof targetId !== 'string' || targetId.trim().length === 0) {
    errors.push('targetId is required');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    errors.push('reason is required');
  } else if (reason.trim().length > 1000) {
    errors.push('reason must be 1000 characters or fewer');
  }

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: {
      targetType,
      targetId: targetId.trim(),
      reason: reason.trim()
    }
  };
};

// Does the reported content still exist? Missing content is a 404 at the route.
const targetExists = async (targetType, targetId) => {
  const ref = targetRef(targetType, targetId);
  if (!ref) return false;
  const snap = await getDoc(ref);
  return snap.exists();
};

// Remove the offending content, reusing the same deletion logic the owning
// features use (threads cascade their comments before the post is deleted).
const removeTarget = async (targetType, targetId) => {
  const ref = targetRef(targetType, targetId);
  if (!ref) return false;
  if (targetType === 'thread') {
    await deleteCommentsForParent(COMMENT_PARENT_TYPE, targetId);
  }
  await deleteDoc(ref);
  return true;
};

// Append an immutable audit record for a moderator action.
const recordModerationAction = async ({ moderatorUid, action, targetType, targetId, reportId }) => {
  const ref = doc(collection(db, 'moderation_actions'));
  const record = {
    moderatorUid,
    action,
    targetType,
    targetId,
    reportId: reportId || null,
    createdAt: new Date().toISOString()
  };
  await setDoc(ref, record);
  return { id: ref.id, ...record };
};

module.exports = {
  TARGET_TYPES,
  REPORT_STATUSES,
  RESOLUTION_STATUSES,
  targetRef,
  validateReportInput,
  targetExists,
  removeTarget,
  recordModerationAction
};
