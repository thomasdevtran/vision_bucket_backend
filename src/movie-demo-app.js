// Public movie discovery for the portfolio. No Firebase or user-data routes.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const moviesRouter = require('./routes/movies');
const { createLogger } = require('./logger');
const { errorHandler, notFoundHandler } = require('./errors');

const createMovieDemoApp = ({ router = moviesRouter, logger } = {}) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ methods: ['GET', 'HEAD', 'OPTIONS'] }));
  app.use(pinoHttp({ logger: logger || createLogger({ logLevel: 'warn', nodeEnv: process.env.NODE_ENV || 'development' }) }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'vision-bucket-movies' }));
  app.use('/api/movies', (_req, res, next) => {
    // Only successful responses are cached; errors override this below.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    next();
  }, router);
  app.use((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    notFoundHandler(req, res);
  });
  app.use((error, req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    errorHandler(error, req, res, next);
  });
  return app;
};

module.exports = { createMovieDemoApp };
