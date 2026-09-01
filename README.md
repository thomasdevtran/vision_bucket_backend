# vision_bucket_backend

npm i --save-dev dotenv nodemon

# to start using nodemon use npm run devstart

## Firebase authentication

All mutation endpoints require a Firebase ID token:

```http
Authorization: Bearer <Firebase ID token>
```

Firebase Admin uses the `inf-124-10961` project by default. Override it with
`FIREBASE_PROJECT_ID`. In local development, provide Admin credentials with
`GOOGLE_APPLICATION_CREDENTIALS` or put the service-account JSON in
`FIREBASE_SERVICE_ACCOUNT_JSON`. `FIREBASE_CLIENT_EMAIL` plus
`FIREBASE_PRIVATE_KEY` are also supported. Use Application Default Credentials
in hosted Firebase/Google Cloud environments.

News creation requires a Firebase custom claim of either `role: "admin"`,
`role: "editor"`, or a `roles` array containing one of those values.

Mutation URLs no longer contain a UID. The authenticated UID always comes from
the verified token (`req.user.uid`).

## Normalized Firestore records

New comments are stored in the top-level `comments` collection with
`parentType`, `parentId`, `parentKey`, and `authorId`. New movie-list updates are
stored in `watch_entries`, one deterministic document per user/movie pair. The
existing profile response still exposes status arrays for frontend compatibility;
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

