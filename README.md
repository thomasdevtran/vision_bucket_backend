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

