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

test('public review reads return reviews for a movie without leaking the owner uid', async () => {
  const owner = await createUser('reader-owner');
  const movieId = Math.floor(Math.random() * 1_000_000_000);
  const reviewRef = db.collection('Reviews').doc(`review-${Date.now()}`);
  await reviewRef.set({ uid: owner.uid, movieId, Author: 'Owner', content: 'great film', rating: 5 });

  const listResponse = await request(app).get(`/reviews/movie/${movieId}`);
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.length, 1);
  assert.equal(listResponse.body[0].content, 'great film');
  assert.equal(listResponse.body[0].uid, undefined);

  const oneResponse = await request(app).get(`/reviews/${reviewRef.id}`);
  assert.equal(oneResponse.status, 200);
  assert.equal(oneResponse.body.id, reviewRef.id);
  assert.equal(oneResponse.body.uid, undefined);

  const missingResponse = await request(app).get('/reviews/does-not-exist');
  assert.equal(missingResponse.status, 404);
});

const postReview = async (author, movieId, extra = {}) => {
  const response = await request(app)
    .post('/reviews/posting')
    .set(bearer(author.token))
    .send({ movieId, Author: 'Author', content: 'a review', rating: 4, ...extra });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.id;
};

test('reacting then unreacting updates the count and reactedByMe', async () => {
  const author = await createUser('reaction-author');
  const reactor = await createUser('reactor');
  const movieId = Math.floor(Math.random() * 1_000_000_000);
  const reviewId = await postReview(author, movieId);

  const react = await request(app)
    .post(`/reviews/${reviewId}/reactions`)
    .set(bearer(reactor.token))
    .send({ type: 'helpful' });
  assert.equal(react.status, 200);
  assert.equal(react.body.reactionCount, 1);
  assert.equal(react.body.reactedByMe, true);

  const authedRead = await request(app).get(`/reviews/${reviewId}`).set(bearer(reactor.token));
  assert.equal(authedRead.status, 200);
  assert.equal(authedRead.body.reactionCount, 1);
  assert.equal(authedRead.body.reactedByMe, true);

  const unreact = await request(app)
    .delete(`/reviews/${reviewId}/reactions`)
    .set(bearer(reactor.token));
  assert.equal(unreact.status, 200);
  assert.equal(unreact.body.reactionCount, 0);
  assert.equal(unreact.body.reactedByMe, false);
});

test('reacting twice is idempotent and stays at a count of 1', async () => {
  const author = await createUser('idem-author');
  const reactor = await createUser('idem-reactor');
  const movieId = Math.floor(Math.random() * 1_000_000_000);
  const reviewId = await postReview(author, movieId);

  const first = await request(app).post(`/reviews/${reviewId}/reactions`).set(bearer(reactor.token)).send({});
  assert.equal(first.status, 200);
  assert.equal(first.body.reactionCount, 1);

  const second = await request(app).post(`/reviews/${reviewId}/reactions`).set(bearer(reactor.token)).send({});
  assert.equal(second.status, 200);
  assert.equal(second.body.reactionCount, 1);
});

test('an unauthenticated reaction is rejected with 401', async () => {
  const response = await request(app).post('/reviews/whatever/reactions').send({ type: 'helpful' });
  assert.equal(response.status, 401);
});

test('reacting to a missing review returns 404', async () => {
  const reactor = await createUser('missing-reactor');
  const response = await request(app)
    .post('/reviews/does-not-exist/reactions')
    .set(bearer(reactor.token))
    .send({ type: 'helpful' });
  assert.equal(response.status, 404);
});

test('public movie reads expose reactionCount and isSpoiler but never the owner uid', async () => {
  const author = await createUser('spoiler-author');
  const movieId = Math.floor(Math.random() * 1_000_000_000);
  await postReview(author, movieId, { isSpoiler: true });

  const listResponse = await request(app).get(`/reviews/movie/${movieId}`);
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.length, 1);
  const [review] = listResponse.body;
  assert.equal(review.reactionCount, 0);
  assert.equal(review.isSpoiler, true);
  assert.equal(review.uid, undefined);
  // No token supplied: reactedByMe is not leaked into an anonymous read.
  assert.equal(review.reactedByMe, undefined);
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

test('an owner creates a list, adds items, and a reorder persists', async () => {
  const owner = await createUser('list-owner');

  const created = await request(app)
    .post('/lists')
    .set(bearer(owner.token))
    .send({ title: 'Top Sci-Fi', description: 'The best', isPublic: false });
  assert.equal(created.status, 201);
  assert.equal(created.body.ownerId, owner.uid);
  assert.deepEqual(created.body.items, []);
  const listId = created.body.id;

  for (const movieId of [11, 22, 33]) {
    const added = await request(app)
      .post(`/lists/${listId}/items`)
      .set(bearer(owner.token))
      .send({ movieId });
    assert.equal(added.status, 201);
  }

  const duplicate = await request(app)
    .post(`/lists/${listId}/items`)
    .set(bearer(owner.token))
    .send({ movieId: 11 });
  assert.equal(duplicate.status, 409);

  const reordered = await request(app)
    .patch(`/lists/${listId}/items`)
    .set(bearer(owner.token))
    .send({ order: [33, 11, 22] });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.items.map(item => item.movieId), [33, 11, 22]);
  assert.deepEqual(reordered.body.items.map(item => item.position), [1, 2, 3]);

  const removed = await request(app)
    .delete(`/lists/${listId}/items/11`)
    .set(bearer(owner.token));
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.items.map(item => item.movieId), [33, 22]);
  assert.deepEqual(removed.body.items.map(item => item.position), [1, 2]);

  const fetched = await request(app).get(`/lists/${listId}`).set(bearer(owner.token));
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body.items.map(item => item.movieId), [33, 22]);
});

test('a non-collaborator cannot edit or delete and cannot see a private list', async () => {
  const owner = await createUser('private-owner');
  const stranger = await createUser('stranger');

  const created = await request(app)
    .post('/lists')
    .set(bearer(owner.token))
    .send({ title: 'Secret picks', isPublic: false });
  const listId = created.body.id;

  const view = await request(app).get(`/lists/${listId}`).set(bearer(stranger.token));
  assert.equal(view.status, 404);

  const anonView = await request(app).get(`/lists/${listId}`);
  assert.equal(anonView.status, 404);

  const edit = await request(app)
    .patch(`/lists/${listId}`)
    .set(bearer(stranger.token))
    .send({ title: 'hijacked' });
  assert.equal(edit.status, 404);

  const del = await request(app)
    .delete(`/lists/${listId}`)
    .set(bearer(stranger.token));
  assert.equal(del.status, 404);

  const persisted = (await db.collection('lists').doc(listId).get()).data();
  assert.equal(persisted.title, 'Secret picks');
});

test('a collaborator can edit but cannot delete or manage collaborators', async () => {
  const owner = await createUser('collab-owner');
  const collaborator = await createUser('collaborator');
  const outsider = await createUser('collab-outsider');
  await db.collection('Users').doc(collaborator.uid).set({ Username: 'collab' });
  await db.collection('Users').doc(outsider.uid).set({ Username: 'outsider' });

  const created = await request(app)
    .post('/lists')
    .set(bearer(owner.token))
    .send({ title: 'Shared', isPublic: false });
  const listId = created.body.id;

  const addCollab = await request(app)
    .post(`/lists/${listId}/collaborators`)
    .set(bearer(owner.token))
    .send({ uid: collaborator.uid });
  assert.equal(addCollab.status, 200);
  assert.ok(addCollab.body.collaboratorIds.includes(collaborator.uid));

  // owner cannot be added as a collaborator
  const ownerAsCollab = await request(app)
    .post(`/lists/${listId}/collaborators`)
    .set(bearer(owner.token))
    .send({ uid: owner.uid });
  assert.equal(ownerAsCollab.status, 400);

  // unknown user rejected
  const unknownCollab = await request(app)
    .post(`/lists/${listId}/collaborators`)
    .set(bearer(owner.token))
    .send({ uid: 'does-not-exist-uid' });
  assert.equal(unknownCollab.status, 404);

  // collaborator can view and edit
  const view = await request(app).get(`/lists/${listId}`).set(bearer(collaborator.token));
  assert.equal(view.status, 200);

  const edit = await request(app)
    .patch(`/lists/${listId}`)
    .set(bearer(collaborator.token))
    .send({ description: 'edited by collaborator' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.description, 'edited by collaborator');

  const addItem = await request(app)
    .post(`/lists/${listId}/items`)
    .set(bearer(collaborator.token))
    .send({ movieId: 77 });
  assert.equal(addItem.status, 201);

  // collaborator cannot delete the list
  const del = await request(app).delete(`/lists/${listId}`).set(bearer(collaborator.token));
  assert.equal(del.status, 403);

  // collaborator cannot manage collaborators
  const manage = await request(app)
    .post(`/lists/${listId}/collaborators`)
    .set(bearer(collaborator.token))
    .send({ uid: outsider.uid });
  assert.equal(manage.status, 403);

  // owner removes the collaborator
  const removeCollab = await request(app)
    .delete(`/lists/${listId}/collaborators/${collaborator.uid}`)
    .set(bearer(owner.token));
  assert.equal(removeCollab.status, 200);
  assert.equal(removeCollab.body.collaboratorIds.includes(collaborator.uid), false);

  // after removal the former collaborator loses access
  const lostView = await request(app).get(`/lists/${listId}`).set(bearer(collaborator.token));
  assert.equal(lostView.status, 404);
});

test('list mutations reject unauthenticated callers with 401', async () => {
  const create = await request(app).post('/lists').send({ title: 'nope' });
  assert.equal(create.status, 401);

  const patch = await request(app).patch('/lists/whatever').send({ title: 'nope' });
  assert.equal(patch.status, 401);

  const addItem = await request(app).post('/lists/whatever/items').send({ movieId: 1 });
  assert.equal(addItem.status, 401);

  const del = await request(app).delete('/lists/whatever');
  assert.equal(del.status, 401);
});

test('GET /lists/user/:uid shows public lists to strangers and all lists to the owner', async () => {
  const owner = await createUser('feed-owner');
  const stranger = await createUser('feed-stranger');

  const publicList = await request(app)
    .post('/lists')
    .set(bearer(owner.token))
    .send({ title: 'Public favourites', isPublic: true });
  assert.equal(publicList.status, 201);

  const privateList = await request(app)
    .post('/lists')
    .set(bearer(owner.token))
    .send({ title: 'Private stash', isPublic: false });
  assert.equal(privateList.status, 201);

  const strangerView = await request(app).get(`/lists/user/${owner.uid}`).set(bearer(stranger.token));
  assert.equal(strangerView.status, 200);
  const strangerTitles = strangerView.body.map(list => list.title);
  assert.ok(strangerTitles.includes('Public favourites'));
  assert.equal(strangerTitles.includes('Private stash'), false);

  const ownerView = await request(app).get(`/lists/user/${owner.uid}`).set(bearer(owner.token));
  assert.equal(ownerView.status, 200);
  const ownerTitles = ownerView.body.map(list => list.title);
  assert.ok(ownerTitles.includes('Public favourites'));
  assert.ok(ownerTitles.includes('Private stash'));
});

test('an unauthenticated diary POST is rejected with 401', async () => {
  const response = await request(app)
    .post('/profile/diary')
    .send({ movieId: 1, watchedAt: '2026-01-01' });
  assert.equal(response.status, 401);
});

test('a user logs a watch and it appears in their diary', async () => {
  const user = await createUser('diary-owner');

  const created = await request(app)
    .post('/profile/diary')
    .set(bearer(user.token))
    .send({ movieId: 603, watchedAt: '2026-05-01', rating: 5, notes: 'Classic', rewatch: false });
  assert.equal(created.status, 201);
  assert.equal(created.body.userId, user.uid);
  assert.equal(created.body.movieId, 603);
  assert.equal(created.body.rating, 5);
  assert.equal(created.body.notes, 'Classic');
  assert.equal(created.body.rewatch, false);
  assert.ok(created.body.id);

  const diary = await request(app).get(`/profile/diary/${user.uid}`);
  assert.equal(diary.status, 200);
  assert.equal(diary.body.entries.length, 1);
  assert.equal(diary.body.entries[0].id, created.body.id);
});

test('two watches of the same movie both persist as separate rewatch entries', async () => {
  const user = await createUser('rewatcher');

  const first = await request(app)
    .post('/profile/diary')
    .set(bearer(user.token))
    .send({ movieId: 550, watchedAt: '2026-01-10', rating: 4 });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post('/profile/diary')
    .set(bearer(user.token))
    .send({ movieId: 550, watchedAt: '2026-06-20', rating: 5, rewatch: true });
  assert.equal(second.status, 201);
  assert.notEqual(first.body.id, second.body.id);

  const diary = await request(app).get(`/profile/diary/${user.uid}`);
  assert.equal(diary.status, 200);
  const forMovie = diary.body.entries.filter(entry => entry.movieId === 550);
  assert.equal(forMovie.length, 2);
});

test('the diary is newest-first and cursor-paginated', async () => {
  const user = await createUser('diary-paginator');
  const dates = ['2026-02-01', '2026-04-01', '2026-08-01'];
  for (const watchedAt of dates) {
    const created = await request(app)
      .post('/profile/diary')
      .set(bearer(user.token))
      .send({ movieId: 100 + dates.indexOf(watchedAt), watchedAt });
    assert.equal(created.status, 201);
  }

  const firstPage = await request(app).get(`/profile/diary/${user.uid}?limit=2`);
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.entries.length, 2);
  assert.equal(firstPage.body.entries[0].watchedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(firstPage.body.entries[1].watchedAt, '2026-04-01T00:00:00.000Z');
  assert.ok(firstPage.body.nextCursor, 'expected a nextCursor');

  const secondPage = await request(app)
    .get(`/profile/diary/${user.uid}?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`);
  assert.equal(secondPage.status, 200);
  assert.equal(secondPage.body.entries.length, 1);
  assert.equal(secondPage.body.entries[0].watchedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(secondPage.body.nextCursor, null);
});

test('a diary owner can edit their entry but a non-owner cannot', async () => {
  const owner = await createUser('diary-editor');
  const attacker = await createUser('diary-attacker');

  const created = await request(app)
    .post('/profile/diary')
    .set(bearer(owner.token))
    .send({ movieId: 27205, watchedAt: '2026-03-03', rating: 3 });
  assert.equal(created.status, 201);
  const entryId = created.body.id;

  const attackerEdit = await request(app)
    .patch(`/profile/diary/${entryId}`)
    .set(bearer(attacker.token))
    .send({ rating: 1 });
  assert.equal(attackerEdit.status, 404);

  const attackerDelete = await request(app)
    .delete(`/profile/diary/${entryId}`)
    .set(bearer(attacker.token));
  assert.equal(attackerDelete.status, 404);

  const ownerEdit = await request(app)
    .patch(`/profile/diary/${entryId}`)
    .set(bearer(owner.token))
    .send({ rating: 5, notes: 'Even better rewatched' });
  assert.equal(ownerEdit.status, 200);
  assert.equal(ownerEdit.body.rating, 5);
  assert.equal(ownerEdit.body.notes, 'Even better rewatched');

  const ownerDelete = await request(app)
    .delete(`/profile/diary/${entryId}`)
    .set(bearer(owner.token));
  assert.equal(ownerDelete.status, 200);

  const diary = await request(app).get(`/profile/diary/${owner.uid}`);
  assert.equal(diary.body.entries.some(entry => entry.id === entryId), false);
});

test('diary POST rejects a future date and an out-of-range rating with 400', async () => {
  const user = await createUser('diary-validator');

  const future = await request(app)
    .post('/profile/diary')
    .set(bearer(user.token))
    .send({ movieId: 1, watchedAt: '2999-01-01' });
  assert.equal(future.status, 400);

  const badRating = await request(app)
    .post('/profile/diary')
    .set(bearer(user.token))
    .send({ movieId: 1, watchedAt: '2026-01-01', rating: 9 });
  assert.equal(badRating.status, 400);
});

test('GET /recommendations ranks candidates from seeded watch history (provider mocked)', async () => {
  const express = require('express');
  const { createRecommendationsRouter } = require('../../src/routes/recommendations');
  const { errorHandler, notFoundHandler } = require('../../src/errors');

  const user = await createUser('rec-user');
  await createProfile(user, 'RecUser');

  // Seed real watch_entries through the live profile endpoint.
  const seeded = await request(app)
    .put('/profile/update/Completed/add_movie')
    .set(bearer(user.token))
    .send({ movieId: 500 });
  assert.equal(seeded.status, 200);

  // Mock only the TMDB-backed provider layer; auth + firestore reads are real.
  const mockProvider = {
    getPopularMovies: async () => ({ page: 1, results: [
      { id: 500, title: 'Watched', vote_average: 9 },
      { id: 700, title: 'Popular Only', vote_average: 8 }
    ] }),
    getGenres: async () => ({ genres: [{ id: 878, name: 'Sci-Fi' }] }),
    getMovieGenres: async () => ['Sci-Fi'],
    getMoviesByGenre: async () => ({ page: 1, results: [
      { id: 900, title: 'SciFi Pick', vote_average: 6 }
    ] })
  };

  const recApp = express();
  recApp.use((req, res, next) => { req.id = 'rec-test'; req.log = { error() {}, warn() {} }; next(); });
  recApp.use('/recommendations', createRecommendationsRouter({ provider: () => mockProvider }));
  recApp.use(notFoundHandler);
  recApp.use(errorHandler);

  const response = await request(recApp)
    .get('/recommendations?limit=5')
    .set(bearer(user.token));

  assert.equal(response.status, 200);
  assert.equal(response.body.fallback, false);
  const ids = response.body.results.map(movie => movie.id);
  assert.ok(!ids.includes(500), 'watched movie must be excluded');
  assert.equal(ids[0], 900, 'affinity-genre title ranks first');
  assert.ok(ids.includes(700));
});

// --- Moderation & reporting (Feature #9) -----------------------------------

const { getAuth } = require('firebase-admin/auth');
const { adminApp } = require('../../src/firebaseAdmin');

const TEST_PASSWORD = 'test-password-123';

// Sign up returning the email so we can re-authenticate after promoting a role.
const signUp = async label => {
  const email = `${label}-${Date.now()}-${Math.random()}@example.test`;
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD, returnSecureToken: true })
    }
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return { uid: body.localId, token: body.idToken, email };
};

// Re-authenticate to mint a fresh ID token that carries any newly-set claims.
const signIn = async email => {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD, returnSecureToken: true })
    }
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.idToken;
};

// Create a user, set a role custom claim via the Admin SDK, then sign in again
// so the returned token includes the claim (role: 'admin' | 'moderator').
const createUserWithRole = async (label, role) => {
  const user = await signUp(label);
  await getAuth(adminApp).setCustomUserClaims(user.uid, { role });
  const token = await signIn(user.email);
  return { uid: user.uid, token };
};

const seedReview = async author => {
  const ref = db.collection('Reviews').doc(`mod-review-${Date.now()}-${Math.random()}`);
  await ref.set({ uid: author.uid, movieId: 7, Author: 'Author', content: 'reported content', rating: 3 });
  return ref;
};

test('an authenticated user reports content and a duplicate open report is rejected with 409', async () => {
  const reporter = await createUser('report-reporter');
  const author = await createUser('report-author');
  const reviewRef = await seedReview(author);

  const created = await request(app)
    .post('/reports')
    .set(bearer(reporter.token))
    .send({ targetType: 'review', targetId: reviewRef.id, reason: 'Spam' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.reporterUid, reporter.uid);
  assert.equal(created.body.targetType, 'review');
  assert.equal(created.body.status, 'open');
  assert.ok(created.body.id);

  const duplicate = await request(app)
    .post('/reports')
    .set(bearer(reporter.token))
    .send({ targetType: 'review', targetId: reviewRef.id, reason: 'Spam again' });
  assert.equal(duplicate.status, 409);
});

test('reporting requires auth (401) and a missing target returns 404', async () => {
  const unauth = await request(app)
    .post('/reports')
    .send({ targetType: 'review', targetId: 'whatever', reason: 'x' });
  assert.equal(unauth.status, 401);

  const reporter = await createUser('missing-target-reporter');
  const missing = await request(app)
    .post('/reports')
    .set(bearer(reporter.token))
    .send({ targetType: 'review', targetId: 'does-not-exist', reason: 'x' });
  assert.equal(missing.status, 404);
});

test('a non-moderator cannot list or resolve reports (403)', async () => {
  const user = await createUser('plain-user');

  const list = await request(app).get('/reports').set(bearer(user.token));
  assert.equal(list.status, 403);

  const patch = await request(app)
    .patch('/reports/whatever')
    .set(bearer(user.token))
    .send({ status: 'dismissed' });
  assert.equal(patch.status, 403);

  // Unauthenticated moderator endpoints are 401, not 403.
  const anonList = await request(app).get('/reports');
  assert.equal(anonList.status, 401);
});

test('a moderator lists open reports and dismisses one, writing an audit record', async () => {
  const moderator = await createUserWithRole('moderator', 'moderator');
  const reporter = await createUser('dismiss-reporter');
  const author = await createUser('dismiss-author');
  const reviewRef = await seedReview(author);

  const created = await request(app)
    .post('/reports')
    .set(bearer(reporter.token))
    .send({ targetType: 'review', targetId: reviewRef.id, reason: 'Not actually a problem' });
  assert.equal(created.status, 201);
  const reportId = created.body.id;

  const list = await request(app).get('/reports?status=open').set(bearer(moderator.token));
  assert.equal(list.status, 200);
  assert.equal(list.body.status, 'open');
  assert.ok(list.body.reports.some(report => report.id === reportId));

  const dismissed = await request(app)
    .patch(`/reports/${reportId}`)
    .set(bearer(moderator.token))
    .send({ status: 'dismissed' });
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.status, 'dismissed');
  assert.equal(dismissed.body.resolvedBy, moderator.uid);
  assert.ok(dismissed.body.resolvedAt);
  assert.equal(dismissed.body.removedTarget, false);

  // The reported content is untouched by a dismiss.
  assert.equal((await reviewRef.get()).exists, true);

  // An audit record was written for the action.
  const audit = await db.collection('moderation_actions').where('reportId', '==', reportId).get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().action, 'dismissed');
  assert.equal(audit.docs[0].data().moderatorUid, moderator.uid);
});

test('an admin resolves a report with removeTarget and the reported content is deleted', async () => {
  const admin = await createUserWithRole('admin', 'admin');
  const reporter = await createUser('remove-reporter');
  const author = await createUser('remove-author');
  const reviewRef = await seedReview(author);

  const created = await request(app)
    .post('/reports')
    .set(bearer(reporter.token))
    .send({ targetType: 'review', targetId: reviewRef.id, reason: 'Abuse' });
  assert.equal(created.status, 201);
  const reportId = created.body.id;

  const resolved = await request(app)
    .patch(`/reports/${reportId}`)
    .set(bearer(admin.token))
    .send({ status: 'resolved', removeTarget: true });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.status, 'resolved');
  assert.equal(resolved.body.resolvedBy, admin.uid);
  assert.equal(resolved.body.removedTarget, true);
  assert.equal(resolved.body.resolution, 'removed');

  // The offending content is gone.
  assert.equal((await reviewRef.get()).exists, false);

  const audit = await db.collection('moderation_actions').where('reportId', '==', reportId).get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().action, 'remove_target');
});

test('resolving a missing report returns 404', async () => {
  const moderator = await createUserWithRole('missing-report-mod', 'moderator');
  const response = await request(app)
    .patch('/reports/does-not-exist')
    .set(bearer(moderator.token))
    .send({ status: 'resolved' });
  assert.equal(response.status, 404);
});
