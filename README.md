# Vision Bucket — Backend API

The REST API behind [Vision Bucket](https://github.com/trollbro71/vision_bucket),
a full-stack movie tracking and community platform. This service is built on
**Express 5** and **Firestore** (via the Firebase Admin SDK) and handles
authentication, user profiles, watch tracking, reviews, and discussion boards.

The React frontend lives in a
[separate repository](https://github.com/trollbro71/vision_bucket).

---

## Features

- **Firebase ID-token auth** — every mutating endpoint verifies a Firebase ID
  token and derives the user from the verified token, never from the URL.
- **Role-based authorization** — privileged actions (e.g. posting news) require a
  Firebase custom claim (`role: "admin" | "editor"`, or a `roles` array).
- **Resource ownership** — users can only edit or delete their own reviews and
  comments.
- **Operational hardening** — Helmet, CORS allow-listing, rate limiting,
  per-request IDs, structured logging (pino), and `/health` + `/ready` probes.
- **API documentation** — OpenAPI spec at `/openapi.json` and Swagger UI at
  `/docs`.
- **Normalized data model** — deterministic `watch_entries` and a top-level
  `comments` collection, with a reversible migration from the legacy shape.

## Tech stack

| Concern        | Technology                                   |
| -------------- | -------------------------------------------- |
| Runtime        | Node.js 22+                                  |
| Web framework  | Express 5                                    |
| Database       | Firestore (Firebase Admin SDK)               |
| Auth           | Firebase Authentication (ID tokens + claims) |
| Security/ops   | Helmet, CORS, express-rate-limit, pino       |
| Docs           | swagger-ui-express / OpenAPI                 |
| Tests          | `node:test` + Supertest + Firebase emulators |

## Architecture

```mermaid
flowchart LR
    FE[React frontend] -->|REST + Bearer ID token| API[Express API]
    API -->|verify token| AUTH[Firebase Auth]
    API -->|Admin SDK| FS[(Firestore)]
```

The frontend never touches Firestore directly — the deployed
[`firestore.rules`](firestore.rules) deny all client access, so the Express API
(using the Admin SDK) is the single path to data.

## API surface

| Method | Path                        | Auth        | Purpose                          |
| ------ | --------------------------- | ----------- | -------------------------------- |
| GET    | `/health`, `/ready`         | none        | Liveness / readiness probes      |
| GET    | `/openapi.json`, `/docs`    | none        | API spec and Swagger UI          |
| GET    | `/reviews/movie/:movieId`   | none        | List reviews for a movie         |
| GET    | `/reviews/:id`              | none        | Fetch a single review            |
| POST   | `/reviews/posting`          | required    | Create a review                  |
| PATCH  | `/reviews/:id`              | owner       | Edit your review                 |
| DELETE | `/reviews/:id`              | owner       | Delete your review               |
| *      | `/profile/*`                | mixed       | Profiles, watch entries, reviews index |
| *      | `/discussions/*`, `/news/*` | mixed       | Threads and comments             |

> Movie discovery (`/api/movies/*`) is included in this repository. Set `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY` for live discovery. Without a credential, these endpoints return a structured 503 error.

## Portfolio demo

The frontend includes a separate static demo mode (`npm run demo` or `npm run build:demo`). It needs no backend, Firebase credentials, TMDB account, or sign-in. Visitors use fictional sample content and browser-local persistence. This does not change this API’s authentication or connect demo visitors to Firestore. See the frontend `DEMO.md` for the walkthrough.

Authenticated review reads include `isOwner` for the verified caller; public responses continue to omit owner UIDs. This lets the frontend display editing controls while the mutation routes still enforce ownership.

## Getting started

### Prerequisites

- Node.js 22+
- A Firebase project with Firestore and Authentication enabled
- The [Firebase CLI](https://firebase.google.com/docs/cli) (for the emulator tests)

### Install

```sh
git clone https://github.com/thomasdevtran/vision_bucket_backend.git
cd vision_bucket_backend
npm install
```

### Configure

Create a `.env` file (it is gitignored). Common variables:

```sh
NODE_ENV=development
PORT=5000
FIREBASE_PROJECT_ID=your-project-id
FRONTEND_ORIGINS=http://localhost:3000   # comma-separated allow-list

# Local Admin credentials — provide ONE of:
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
# or
FIREBASE_SERVICE_ACCOUNT_JSON={...service account JSON...}
# or
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

In hosted Firebase/Google Cloud environments, use Application Default Credentials
instead of a key file. `FRONTEND_ORIGINS` is required in production.

### Run

```sh
npm run dev     # nodemon, http://localhost:5000
npm start       # production start
```

Interactive API docs are then available at `http://localhost:5000/docs`.

## Authentication

All mutation endpoints require a Firebase ID token:

```http
Authorization: Bearer <Firebase ID token>
```

The authenticated UID always comes from the verified token (`req.user.uid`) — it
is never taken from the URL. News creation requires a Firebase custom claim of
`role: "admin"`, `role: "editor"`, or a `roles` array containing one of those.

## Testing

```sh
npm run lint          # ESLint
npm test              # unit tests + Firebase-emulator integration tests
npm run test:unit     # unit tests only
npm run test:emulator # emulator-backed integration tests only
```

The emulator suite (`test/integration/api.emulator.test.js`) exercises real
auth/Firestore behavior, including unauthenticated access and cross-user
authorization attempts. CI runs lint, emulator tests, build checks, and a
production dependency audit
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Normalized Firestore records

New comments are stored in the top-level `comments` collection with `parentType`,
`parentId`, `parentKey`, and `authorId`. New movie-list updates are stored in
`watch_entries`, one deterministic document per user/movie pair. The profile
response still exposes status arrays for frontend compatibility;
`GET /profile/watch_entries/:uid` exposes full entries including `watchedAt`,
`rating`, `progress`, and `notes`.

Run the idempotent migration as a dry run first:

```sh
npm run migrate:normalized
```

Review invalid comments and movies that appear in multiple legacy status arrays,
then copy unambiguous records:

```sh
npm run migrate:normalized -- --apply
```

The migration never removes `Comments` or movie-status arrays. Deploy the new
read/write paths, verify the copied counts and API responses, and only remove the
legacy fields in a separately approved cleanup. Re-running `--apply` skips target
documents that already exist, so live normalized updates are not overwritten.

## My contributions

Vision Bucket started as a team project for a university course (UC Irvine,
Informatics 124) and I've since rebuilt and extended it on my own. On the backend
I designed and built:

- The secured Express 5 API: Firebase ID-token authentication middleware,
  role-based authorization, and per-resource ownership enforcement.
- Operational hardening — CORS allow-listing, rate limiting, structured request
  logging with request IDs, health/readiness probes, and Swagger/OpenAPI docs.
- The normalized Firestore data model (`watch_entries`, top-level `comments`) and
  a reversible, dry-run-first migration that preserves the legacy shape.
- The verification suite: `node:test` unit tests plus Firebase Auth/Firestore
  emulator integration tests, wired into GitHub Actions CI.

## Related

- Frontend app: [vision_bucket](https://github.com/trollbro71/vision_bucket)
