const express = require('express');
const rateLimit = require('express-rate-limit');
const { handleUpload } = require('./upload');
const { extractFromFiles } = require('./ocr');
const { ipDailyLimit } = require('./ipLimit');
const { rateLimit: rlCfg, apiKeys } = require('../config');

const router = express.Router();

/* ── Rate limiter ── */
const extractLimiter = rateLimit({
  windowMs: rlCfg.windowMs,
  max: rlCfg.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '😡 Too many requests. Please wait a moment and try again.' },
});

/* ── Routes ── */
router.get('/ready', (req, res) => {
  res.json({ ready: true, keys: apiKeys.length });
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', keys: apiKeys.length, uptime: Math.floor(process.uptime()) });
});

router.post('/extract', extractLimiter, ipDailyLimit, handleUpload, async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '😡 No images uploaded. Please select at least one image.' });
  }
  try {
    const results = await extractFromFiles(req.files);
    res.json({ results });
  } catch (err) {
    console.error('😡 Extraction error:', err.message);
    res.status(500).json({ error: '😡 Extraction failed: ' + err.message });
  }
});

module.exports = router;
