const pino = require('pino');

function createLogger(config) {
  return pino({
    level: config.logLevel,
    base: { service: 'vision-bucket-backend', environment: config.nodeEnv },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'firebasePrivateKey'],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
