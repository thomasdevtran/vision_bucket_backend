const jsonBody = schema => ({
  required: true,
  content: { 'application/json': { schema } }
});
const pathParameter = name => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const ok = description => ({ 200: { description } });
const secured = { security: [{ firebaseBearer: [] }] };

module.exports = {
  openapi: '3.1.0',
  info: {
    title: 'Vision Bucket API',
    version: '1.0.0',
    description: 'Discussions, news, profiles, watch entries, and movie reviews.'
  },
  servers: [{ url: '/', description: 'Current deployment' }],
  components: {
    securitySchemes: {
      firebaseBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token' }
    },
    schemas: {
      Comment: {
        type: 'object', required: ['author', 'content', 'date'],
        properties: { author: { type: 'string' }, content: { type: 'string' }, date: { type: 'string' } }
      },
      Movie: {
        type: 'object', required: ['movieId'],
        properties: { movieId: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }
      },
      Review: {
        type: 'object', required: ['movieId', 'Author', 'content', 'rating'],
        properties: {
          movieId: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
          Author: { type: 'string' }, content: { type: 'string' }, rating: { type: 'integer' }
        }
      }
    }
  },
  paths: {
    '/health': { get: { summary: 'Liveness probe', responses: ok('Process is alive') } },
    '/ready': { get: { summary: 'Firestore readiness probe', responses: { ...ok('Ready'), 503: { description: 'Firestore unavailable' } } } },
    '/discussions/posts': { get: { tags: ['Discussions'], summary: 'List posts', responses: ok('Posts') } },
    '/discussions/post/{docId}': {
      get: { tags: ['Discussions'], summary: 'Get post', parameters: [pathParameter('docId')], responses: ok('Post') },
      delete: { tags: ['Discussions'], summary: 'Delete owned post', ...secured, parameters: [pathParameter('docId')], responses: ok('Deleted') }
    },
    '/discussions/posting': { post: { tags: ['Discussions'], summary: 'Create post', ...secured, requestBody: jsonBody({ type: 'object', required: ['Author', 'Date', 'Title', 'Description'] }), responses: { 201: { description: 'Created' } } } },
    '/discussions/post/{docId}/comment': { post: { tags: ['Discussions'], summary: 'Add comment', ...secured, parameters: [pathParameter('docId')], requestBody: jsonBody({ $ref: '#/components/schemas/Comment' }), responses: { 201: { description: 'Created' } } } },
    '/discussions/comment/{docId}/{commentId}': { delete: { tags: ['Discussions'], summary: 'Delete owned comment', ...secured, parameters: [pathParameter('docId'), pathParameter('commentId')], responses: ok('Deleted') } },
    '/news/posts': { get: { tags: ['News'], summary: 'List posts', responses: ok('Posts') } },
    '/news/post/{docId}': { get: { tags: ['News'], summary: 'Get post', parameters: [pathParameter('docId')], responses: ok('Post') } },
    '/news/posting': { post: { tags: ['News'], summary: 'Create post (admin/editor)', ...secured, requestBody: jsonBody({ type: 'object', required: ['Author', 'Date', 'Title', 'Description'] }), responses: { 201: { description: 'Created' } } } },
    '/news/post/{docId}/comment': { post: { tags: ['News'], summary: 'Add comment', ...secured, parameters: [pathParameter('docId')], requestBody: jsonBody({ $ref: '#/components/schemas/Comment' }), responses: { 201: { description: 'Created' } } } },
    '/profile/data/{uid}': { get: { tags: ['Profiles'], summary: 'Get profile', parameters: [pathParameter('uid')], responses: ok('Profile') } },
    '/profile/watch_entries/{uid}': { get: { tags: ['Profiles'], summary: 'List watch entries', parameters: [pathParameter('uid')], responses: ok('Watch entries') } },
    '/profile/create': { post: { tags: ['Profiles'], summary: 'Create own profile', ...secured, requestBody: jsonBody({ type: 'object', additionalProperties: true }), responses: { 201: { description: 'Created' } } } },
    '/profile/update/last_online': { put: { tags: ['Profiles'], summary: 'Update own last-online time', ...secured, requestBody: jsonBody({ type: 'object', required: ['last_online'] }), responses: ok('Updated') } },
    '/profile/update/{status}/add_movie': { put: { tags: ['Profiles'], summary: 'Add movie to own list', ...secured, parameters: [pathParameter('status')], requestBody: jsonBody({ $ref: '#/components/schemas/Movie' }), responses: ok('Updated') } },
    '/profile/update/{status}/remove_movie': { put: { tags: ['Profiles'], summary: 'Remove movie from own list', ...secured, parameters: [pathParameter('status')], requestBody: jsonBody({ $ref: '#/components/schemas/Movie' }), responses: ok('Updated') } },
    '/profile/update/add_review': { put: { tags: ['Profiles'], summary: 'Add review reference', ...secured, requestBody: jsonBody({ type: 'object', required: ['reviewId'] }), responses: ok('Updated') } },
    '/profile/update/remove_review': { put: { tags: ['Profiles'], summary: 'Remove review reference', ...secured, requestBody: jsonBody({ type: 'object', required: ['reviewId'] }), responses: ok('Updated') } },
    '/reviews/posting': { post: { tags: ['Reviews'], summary: 'Create review', ...secured, requestBody: jsonBody({ $ref: '#/components/schemas/Review' }), responses: { 201: { description: 'Created' } } } },
    '/reviews/{docId}': {
      patch: { tags: ['Reviews'], summary: 'Update owned review', ...secured, parameters: [pathParameter('docId')], responses: ok('Updated') },
      delete: { tags: ['Reviews'], summary: 'Delete owned review', ...secured, parameters: [pathParameter('docId')], responses: ok('Deleted') }
    }
  }
};
