require('dotenv').config();

const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const projectId = process.env.FIREBASE_PROJECT_ID || 'inf-124-10961';
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const options = { projectId };

if (serviceAccountJson) {
  options.credential = cert(JSON.parse(serviceAccountJson));
} else if (clientEmail && privateKey) {
  options.credential = cert({ projectId, clientEmail, privateKey });
} else if (clientEmail || privateKey) {
  throw new Error('FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be provided together');
}

const adminApp = getApps()[0] || initializeApp(options);
const auth = getAuth(adminApp);

module.exports = { adminApp, auth };
