const { createMovieDemoApp } = require('../src/movie-demo-app');

const port = process.env.PORT || 5000;
createMovieDemoApp().listen(port, '127.0.0.1', () => {
  console.log(`Movie demo API listening at http://127.0.0.1:${port}`);
});
