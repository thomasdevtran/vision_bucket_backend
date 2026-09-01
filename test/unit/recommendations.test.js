const test = require('node:test');
const assert = require('node:assert/strict');

const { rankRecommendations, watchedMovieIds } = require('../../src/recommendations');

test('recommendations exclude every watched-list status', () => {
  const watched = watchedMovieIds({
    Completed: [1],
    Dropped: ['2'],
    On_hold: [3],
    Plan_to_watch: [4],
    Rewatched: [5]
  });

  assert.deepEqual([...watched], ['1', '2', '3', '4', '5']);
});

test('recommendations prioritize genre affinity, then popularity', () => {
  const candidates = [
    { id: 1, genres: ['Drama'], popularity: 100 },
    { id: 2, genres: ['Sci-Fi'], popularity: 20 },
    { id: 3, genres: ['Sci-Fi', 'Adventure'], popularity: 10 },
    { id: 4, genres: ['Comedy'], popularity: 500 }
  ];
  const profile = { Completed: [1], preferredGenres: ['sci-fi', 'adventure'] };

  assert.deepEqual(
    rankRecommendations(candidates, profile, 3).map(movie => movie.id),
    [3, 2, 4]
  );
});

test('recommendation ranking is stable and respects the requested limit', () => {
  const candidates = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
  assert.deepEqual(rankRecommendations(candidates, {}, 2).map(movie => movie.id), ['first', 'second']);
  assert.deepEqual(rankRecommendations(candidates, {}, -1), []);
});
