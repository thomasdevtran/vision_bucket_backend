const crypto = require('node:crypto');

const stableId = (...parts) => crypto
  .createHash('sha256')
  .update(parts.map(part => String(part)).join('\u0000'))
  .digest('base64url');

const watchEntryDocumentId = (userId, movieId) => stableId('watch_entry', userId, movieId);

const legacyCommentDocumentId = (parentType, parentId, legacyCommentId, index) =>
  stableId('legacy_comment', parentType, parentId, legacyCommentId || index);

module.exports = {
  legacyCommentDocumentId,
  stableId,
  watchEntryDocumentId
};
