const test = require('node:test');
const assert = require('node:assert/strict');

const { createAuthenticate, requireRole } = require('../src/middleware/authenticate');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

test('authenticate rejects requests without a bearer token', async () => {
  const authenticate = createAuthenticate({ verifyIdToken: async () => ({ uid: 'unused' }) });
  const req = { get: () => undefined };
  const res = createResponse();
  let nextCalled = false;

  await authenticate(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('authenticate rejects invalid Firebase ID tokens', async () => {
  const authenticate = createAuthenticate({
    verifyIdToken: async () => { throw new Error('invalid token'); }
  });
  const req = { get: () => 'Bearer invalid' };
  const res = createResponse();

  await authenticate(req, res, () => assert.fail('next should not be called'));

  assert.equal(res.statusCode, 401);
});

test('authenticate assigns the verified token to req.user', async () => {
  const decodedToken = { uid: 'verified-user', role: 'editor' };
  const authenticate = createAuthenticate({
    verifyIdToken: async token => {
      assert.equal(token, 'valid-token');
      return decodedToken;
    }
  });
  const req = { get: () => 'Bearer valid-token' };
  const res = createResponse();
  let nextCalled = false;

  await authenticate(req, res, () => { nextCalled = true; });

  assert.equal(req.user, decodedToken);
  assert.equal(nextCalled, true);
});

test('requireRole accepts admin/editor claims and rejects other users', () => {
  const middleware = requireRole('admin', 'editor');
  const allowedReq = { user: { uid: 'editor-user', role: 'editor' } };
  const arrayReq = { user: { uid: 'admin-user', roles: ['admin'] } };
  const deniedReq = { user: { uid: 'regular-user', role: 'user' } };
  const res = createResponse();
  let allowed = 0;

  middleware(allowedReq, res, () => { allowed += 1; });
  middleware(arrayReq, res, () => { allowed += 1; });
  middleware(deniedReq, res, () => assert.fail('unauthorized role was accepted'));

  assert.equal(allowed, 2);
  assert.equal(res.statusCode, 403);
});
