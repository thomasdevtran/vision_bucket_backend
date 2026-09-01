const { getAuth } = require('firebase-admin/auth');

const extractBearerToken = authorizationHeader => {
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader || '');
  return match ? match[1] : null;
};

const isOwner = (authenticatedUid, ownerUid) => (
  typeof authenticatedUid === 'string'
  && typeof ownerUid === 'string'
  && authenticatedUid === ownerUid
);

const createRequireAuth = (verifyIdToken = token => getAuth().verifyIdToken(token)) => (
  async (req, res, next) => {
    const token = extractBearerToken(req.get('authorization'));
    if (!token) {
      return res.status(401).json({ error: 'A Firebase ID token is required' });
    }

    try {
      const decodedToken = await verifyIdToken(token);
      req.user = { uid: decodedToken.uid };
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid Firebase ID token' });
    }
  }
);

const requireOwner = (paramName = 'uid') => (req, res, next) => {
  if (!isOwner(req.user && req.user.uid, req.params[paramName])) {
    return res.status(403).json({ error: 'You cannot modify another user\'s content' });
  }
  return next();
};

module.exports = {
  createRequireAuth,
  extractBearerToken,
  isOwner,
  requireOwner
};
