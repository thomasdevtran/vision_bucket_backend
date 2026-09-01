const cors = require('cors');
const express = require('express');
const discussionsRouter = require('./routes/discussions');
const newsRouter = require('./routes/news');
const profileRouter = require('./routes/profile');
const reviewsRouter = require('./routes/reviews');

const createApp = () => {
  const app = express();

  app.use(cors({ origin: 'http://localhost:3000' }));
  app.use(express.json());
  app.use('/discussions', discussionsRouter);
  app.use('/news', newsRouter);
  app.use('/profile', profileRouter);
  app.use('/reviews', reviewsRouter);

  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
};

module.exports = { createApp };
