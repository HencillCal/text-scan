const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const { port } = require('./config');
const { ensureUploadDir } = require('./lib/upload');
const routes = require('./lib/routes');

const app = express();

app.set('trust proxy', 1);
app.set('json spaces', 2);

ensureUploadDir();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://fonts.googleapis.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https://files.giftedtech.co.ke"],
      fontSrc:    ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());

app.use((req, res, next) => {
  if (req.path === '/' || req.path.startsWith('/extract') || req.path === '/ready') {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use(express.json());
app.use(routes);

app.use((req, res) => res.status(404).json({ error: '😡 Not found' }));
app.use((err, req, res, next) => {
  console.error('😡 Unhandled error:', err.message);
  res.status(500).json({ error: '😡 Internal server error' });
});

// Start server only when run directly (not on Vercel)
if (require.main === module) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ TextScan ready on port ${port}`);
    console.log(`✅ ApiKey slots loaded: ${require('./config').apiKeys.length}`);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT',  () => server.close(() => process.exit(0)));
} else {
  console.log(`✅ TextScan loaded as serverless function`);
  console.log(`✅ ApiKey slots loaded: ${require('./config').apiKeys.length}`);
}

// Export for Vercel serverless
module.exports = app;
