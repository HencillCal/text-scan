const express = require('express');
const { handleUpload } = require('./upload');
const { extractFromFiles } = require('./ocr');
const { apiKeys } = require('../config');

const router = express.Router();

router.get('/ready', (req, res) => {
  res.json({ ready: true, keys: apiKeys.length });
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', keys: apiKeys.length, uptime: Math.floor(process.uptime()) });
});

router.post('/extract', handleUpload, async (req, res) => {
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
