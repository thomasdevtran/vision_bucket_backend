const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';

const { createApp } = require('../../src/app');
const { loadConfig } = require('../../src/config');
const { db } = require('../../src/firebase');
const { createLogger } = require('../../src/logger');

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const config = loadConfig();
const app = createApp({
  config,
  logger: createLogger(config),
  readinessCheck: async () => {}
});

const createUser = async label => {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `${label}-${Date.now()}-${Math.random()}@example.test`,
        password: 'test-password-123',
        returnSecureToken: true
      })
    }
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return { uid: body.localId, token: body.idToken };
};

const bearer = token => ({ Authorization: `Bearer ${token}` });

test.before(() => {
  assert.ok(authHost, 'run this test through npm run test:emulator');
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator is required');
});

test('Supertest rejects unauthenticated mutations', async () => {
  const response = await request(app)
    .patch('/reviews/missing-review')
    .send({ content: 'changed' });

  assert.equal(response.status, 401);
});

test('one user cannot edit another user\'s review', async () => {
  const owner = await createUser('owner');
  const attacker = await createUser('attacker');
  const reviewRef = db.collection('Reviews').doc(`review-${Date.now()}`);
  await reviewRef.set({
    uid: owner.uid,
    movieId: 42,
    Author: 'Owner',
    content: 'original',
    rating: 5
  });

  const response = await request(app)
    .patch(`/reviews/${reviewRef.id}`)
    .set(bearer(attacker.token))
    .send({ content: 'tampered', rating: 1 });

  assert.equal(response.status, 403);
  const persisted = (await reviewRef.get()).data();
  assert.equal(persisted.content, 'original');
  assert.equal(persisted.rating, 5);
});

test('a review owner can edit their own review with validated values', async () => {
  const owner = await createUser('review-owner');
  const reviewRef = db.collection('Reviews').doc(`review-${Date.now()}`);
  await reviewRef.set({ uid: owner.uid, movieId: 42, Author: 'Owner', content: 'old', rating: 2 });

  const response = await request(app)
    .patch(`/reviews/${reviewRef.id}`)
    .set(bearer(owner.token))
    .send({ content: '  updated  ', rating: '4' });

  assert.equal(response.status, 200);
  const persisted = (await reviewRef.get()).data();
  assert.equal(persisted.content, 'updated');
  assert.equal(persisted.rating, 4);
});

const createProfile = async (user, username) => {
  await db.collection('Users').doc(user.uid).set({ Username: username, username });
};

test('an unauthenticated follow attempt is rejected', async () => {
  const response = await request(app).post('/follows').send({ followeeId: 'anyone' });
  assert.equal(response.status, 401);
});

test('a user can follow then unfollow another user', async () => {
  const follower = await createUser('follower');
  const followee = await createUser('followee');
  await createProfile(followee, 'Followee');

  const followResponse = await request(app)
    .post('/follows')
    .set(bearer(follower.token))
    .send({ followeeId: followee.uid });
  assert.equal(followResponse.status, 201);
  assert.equal(followResponse.body.follow.followerId, follower.uid);
  assert.equal(followResponse.body.follow.followeeId, followee.uid);

  // Idempotent: following again still succeeds.
  const repeatResponse = await request(app)
    .post('/follows')
    .set(bearer(follower.token))
    .send({ followeeId: followee.uid });
  assert.equal(repeatResponse.status, 201);

  const followersResponse = await request(app).get(`/follows/followers/${followee.uid}`);
  assert.equal(followersResponse.status, 200);
  assert.equal(followersResponse.body.count, 1);
  assert.deepEqual(followersResponse.body.followers, [follower.uid]);

  const followingResponse = await request(app).get(`/follows/following/${follower.uid}`);
  assert.equal(followingResponse.status, 200);
  assert.equal(followingResponse.body.count, 1);

  const unfollowResponse = await request(app)
    .delete(`/follows/${followee.uid}`)
    .set(bearer(follower.token));
  assert.equal(unfollowResponse.status, 200);

  const afterResponse = await request(app).get(`/follows/followers/${followee.uid}`);
  assert.equal(afterResponse.body.count, 0);
});

test('following yourself is rejected with 400', async () => {
  const user = await createUser('self-follower');
  await createProfile(user, 'Self');

  const response = await request(app)
    .post('/follows')
    .set(bearer(user.token))
    .send({ followeeId: user.uid });
  assert.equal(response.status, 400);
});

test('following a missing user returns 404', async () => {
  const user = await createUser('lonely');
  const response = await request(app)
    .post('/follows')
    .set(bearer(user.token))
    .send({ followeeId: 'does-not-exist-uid' });
  assert.equal(response.status, 404);
});

test('the feed returns activity from followed users with limit/cursor pagination', async () => {
  const reader = await createUser('feed-reader');
  const author = await createUser('feed-author');
  await createProfile(author, 'Author');

  await request(app)
    .post('/follows')
    .set(bearer(reader.token))
    .send({ followeeId: author.uid });

  // Two reviews at distinct timestamps so ordering and the cursor are observable.
  await db.collection('Reviews').doc(`feed-older-${Date.now()}`).set({
    uid: author.uid, movieId: 11, Author: 'Author', content: 'older', rating: 4,
    date: '2026-01-01T00:00:00.000Z'
  });
  await db.collection('Reviews').doc(`feed-newer-${Date.now()}`).set({
    uid: author.uid, movieId: 22, Author: 'Author', content: 'newer', rating: 5,
    date: '2026-02-01T00:00:00.000Z'
  });

  const firstPage = await request(app)
    .get('/feed?limit=1')
    .set(bearer(reader.token));
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.items.length, 1);
  assert.equal(firstPage.body.items[0].content, 'newer');
  assert.ok(firstPage.body.nextCursor, 'expected a nextCursor for the second page');

  const secondPage = await request(app)
    .get(`/feed?limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`)
    .set(bearer(reader.token));
  assert.equal(secondPage.status, 200);
  assert.equal(secondPage.body.items.length, 1);
  assert.equal(secondPage.body.items[0].content, 'older');
});

test('the feed excludes activity from users you do not follow', async () => {
  const reader = await createUser('isolated-reader');
  const stranger = await createUser('stranger');
  await createProfile(stranger, 'Stranger');
  await db.collection('Reviews').doc(`stranger-${Date.now()}`).set({
    uid: stranger.uid, movieId: 99, Author: 'Stranger', content: 'unfollowed', rating: 3,
    date: '2026-03-01T00:00:00.000Z'
  });

  const response = await request(app).get('/feed').set(bearer(reader.token));
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 0);
});

test('a supplied UID cannot redirect a profile write to another user', async () => {
  const victim = await createUser('victim');
  const attacker = await createUser('profile-attacker');
  const victimRef = db.collection('Users').doc(victim.uid);
  await victimRef.set({ Username: 'victim', Completed: [] });

  const response = await request(app)
    .post('/profile/create')
    .set(bearer(attacker.token))
    .send({ uid: victim.uid, Username: 'attacker-profile' });

  assert.equal(response.status, 201);
  assert.equal((await victimRef.get()).data().Username, 'victim');
  const attackerProfile = (await db.collection('Users').doc(attacker.uid).get()).data();
  assert.equal(attackerProfile.Username, 'attacker-profile');
  assert.equal(attackerProfile.uid, undefined);
});
