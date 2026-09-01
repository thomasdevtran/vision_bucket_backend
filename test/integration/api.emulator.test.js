const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../../src/app');
const { db } = require('../../src/firebase');

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const app = createApp();

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
