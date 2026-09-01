const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

class ConfigError extends Error {
  constructor(messages) {
    super(`Invalid environment configuration:\n- ${messages.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name] ?? fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError([`${name} must be an integer between ${min} and ${max}`]);
  }
  return value;
}

function loadConfig() {
  const errors = [];
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV must be development, test, or production');
  }

  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!firebaseProjectId) errors.push('FIREBASE_PROJECT_ID is required');

  const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (Boolean(firebaseClientEmail) !== Boolean(firebasePrivateKey)) {
    errors.push('FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be provided together');
  }

  const origins = (process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (nodeEnv === 'production' && origins.length === 0) {
    errors.push('FRONTEND_ORIGINS must contain at least one origin in production');
  }

  if (errors.length) throw new ConfigError(errors);

  return Object.freeze({
    nodeEnv,
    port: integer('PORT', 5000, { min: 1, max: 65535 }),
    frontendOrigins: origins.length ? origins : ['http://localhost:3000'],
    bodyLimit: process.env.BODY_LIMIT || '100kb',
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, { min: 1000 }),
    rateLimitMax: integer('RATE_LIMIT_MAX', 100, { min: 1 }),
    logLevel: process.env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
    firebaseProjectId,
    firebaseClientEmail,
    firebasePrivateKey: firebasePrivateKey?.replace(/\\n/g, '\n'),
  });
}

module.exports = { ConfigError, loadConfig };
