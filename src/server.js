const { createApp } = require('./app');

const port = Number(process.env.PORT) || 5000;
const server = createApp().listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

module.exports = { server };
