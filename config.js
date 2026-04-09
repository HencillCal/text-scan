'use strict';
require('dotenv').config({ quiet: true });

const fs   = require('fs');
const path = require('path');

/* Load settings.json */
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'settings.json'), 'utf8'));
} catch (_) {}

function loadKeys(section, envFallback) {
  const keys = (settings[section] && settings[section].apiKeys) || [];
  const valid = keys.map(s => s.trim()).filter(s => s && !s.startsWith('your-'));
  if (valid.length > 0) return valid;
  // Env var fallback
  return (process.env[envFallback] || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* ── API Keys per provider ── */
const geminiKeys  = loadKeys('gemini',    'API_KEYS');
const aimlKeys    = loadKeys('aimlapi',   'AIML_API_KEYS');
const openaiKeys  = loadKeys('openai',    'OPENAI_API_KEYS');
const groqKeys    = loadKeys('groq',      'GROQ_API_KEYS');

/* Legacy: top-level apiKeys in settings (old format) */
const legacyKeys = ((settings.apiKeys || []).map(s => s.trim()).filter(s => s && !s.startsWith('your-')));
if (geminiKeys.length === 0 && legacyKeys.length > 0) geminiKeys.push(...legacyKeys);

/* Used by server.js for startup log */
const apiKeys = geminiKeys;

/* ── Allowed Origins ── */
const allowedOrigins = [
  'http://localhost:7432',
  'http://localhost:5000',
  'https://ocr.giftedtech.co.ke',
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : []),
];

const allowedPatterns = [
  /^https?:\/\/[a-z0-9-]+\.giftedtech\.co\.ke$/,
  /^https?:\/\/[a-z0-9-]+\.replit\.app$/,
  /^https?:\/\/[a-z0-9-]+\.repl\.co$/,
  /^https?:\/\/.*\.replit\.dev$/,
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return allowedPatterns.some(p => p.test(origin));
}

function looksLikeBrowser(ua) {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  const blocked = ['curl', 'wget', 'python-requests', 'axios', 'node-fetch', 'go-http', 'java/', 'okhttp'];
  if (blocked.some(b => lower.includes(b))) return false;
  return lower.includes('mozilla');
}

/* ── Server ── */
const port = parseInt(process.env.PORT || '7432', 10);

module.exports = {
  apiKeys,
  geminiKeys,
  aimlKeys,
  openaiKeys,
  groqKeys,
  allowedOrigins,
  isAllowedOrigin,
  looksLikeBrowser,
  port,
};
