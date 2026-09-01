const { auth } = require('../firebaseAdmin');

const createAuthenticate = (authClient = auth) => async (req, res, next) => {
  const authorization = req.get('authorization');
  const match = authorization && authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return res.status(401).json({ error: 'A Firebase ID token is required' });
  }

  try {
    req.user = await authClient.verifyIdToken(match[1]);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired Firebase ID token' });
  }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  const user = req.user || {};
  const claimedRoles = [
    user.role,
    ...(Array.isArray(user.roles) ? user.roles : [])
  ].filter(Boolean);

  if (!allowedRoles.some(role => claimedRoles.includes(role))) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  return next();
};

const authenticate = createAuthenticate();

module.exports = { authenticate, createAuthenticate, requireRole };
