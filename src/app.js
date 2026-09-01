const { randomUUID } = require('node:crypto');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const discussionsRouter = require('./routes/discussions');
const listsRouter = require('./routes/lists');
const newsRouter = require('./routes/news');
const profileRouter = require('./routes/profile');
const reviewsRouter = require('./routes/reviews');
const openapi = require('./openapi');
const { AppError, errorHandler, notFoundHandler } = require('./errors');

const createApp = ({ config, logger, readinessCheck }) => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false);
  app.use(pinoHttp({
    logger,
    genReqId(req, res) {
      const requestId = req.headers['x-request-id'] || randomUUID();
      res.setHeader('x-request-id', requestId);
      return requestId;
    }
  }));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.frontendOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'origin_not_allowed', 'Origin is not allowed'));
    }
  }));
  app.use(rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: req => req.path === '/health' || req.path === '/ready'
  }));
  app.use(express.json({ limit: config.bodyLimit }));

  app.get('/health', (req, res) => res.json({ status: 'ok', requestId: req.id }));
  app.get('/ready', async (req, res) => {
    try {
      await readinessCheck();
      return res.json({ status: 'ready', requestId: req.id });
    } catch (error) {
      req.log.warn({ err: error }, 'readiness check failed');
      return res.status(503).json({ status: 'not_ready', requestId: req.id });
    }
  });
  app.get('/openapi.json', (req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Vision Bucket API' }));

  app.use('/discussions', discussionsRouter);
  app.use('/lists', listsRouter);
  app.use('/news', newsRouter);
  app.use('/profile', profileRouter);
  app.use('/reviews', reviewsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
