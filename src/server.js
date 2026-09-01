const { loadConfig } = require('./config');

const config = loadConfig();
const { createLogger } = require('./logger');
const { createApp } = require('./app');
const { checkFirestoreReady } = require('./firebase');

const logger = createLogger(config);
const server = createApp({ config, logger, readinessCheck: checkFirestoreReady }).listen(config.port, () => {
  logger.info({ port: config.port }, 'server listening');
});

const shutdown = signal => {
  logger.info({ signal }, 'shutdown requested');
  server.close(error => {
    if (error) {
      logger.error({ err: error }, 'graceful shutdown failed');
      process.exitCode = 1;
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { server };
