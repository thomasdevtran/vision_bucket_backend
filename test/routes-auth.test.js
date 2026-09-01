const test = require('node:test');
const assert = require('node:assert/strict');

const { authenticate } = require('../src/middleware/authenticate');

const routers = {
  discussions: require('../src/routes/discussions'),
  news: require('../src/routes/news'),
  profile: require('../src/routes/profile'),
  reviews: require('../src/routes/reviews')
};

test('every mutation route authenticates before running its handler', () => {
  for (const [name, router] of Object.entries(routers)) {
    const mutationRoutes = router.stack
      .filter(layer => layer.route)
      .filter(layer => !layer.route.methods.get);

    assert.ok(mutationRoutes.length > 0, `${name} has no mutation routes`);

    for (const layer of mutationRoutes) {
      assert.equal(
        layer.route.stack[0].handle,
        authenticate,
        `${name} ${layer.route.path} does not authenticate first`
      );
      assert.equal(
        layer.route.path.includes(':uid'),
        false,
        `${name} ${layer.route.path} accepts a UID in a mutation URL`
      );
    }
  }
});

test('news creation applies authentication, role authorization, then the handler', () => {
  const postingLayer = routers.news.stack.find(
    layer => layer.route?.path === '/posting' && layer.route.methods.post
  );

  assert.ok(postingLayer);
  assert.equal(postingLayer.route.stack[0].handle, authenticate);
  assert.equal(postingLayer.route.stack.length, 3);

  const roleGate = postingLayer.route.stack[1].handle;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    }
  };

  roleGate({ user: { uid: 'regular-user', role: 'user' } }, res, () => {
    assert.fail('regular user passed the news role gate');
  });
  assert.equal(res.statusCode, 403);
});
