'use strict';
require('dotenv').config({ quiet: true });

  /*
   API KEYS
   Set API_KEYS=key1,key2,key3 in .env
   Keys are tried in order; if one hits its quota the next is used automatically.
    */
const apiKeys = (process.env.API_KEYS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
  
  /* 
   ALLOWED ORIGINS
   Hardcoded defaults + comma-separated ALLOWED_ORIGINS in .env
    */
const allowedOrigins = [
  'http://localhost:7432',
  'https://ocr.giftedtech.co.ke',
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : []),
];

// Pattern-based: allow common preview / deploy domains
const allowedPatterns = [
  /^https?:\/\/[a-z0-9-]+\.giftedtech\.co\.ke$/,
  /^https?:\/\/[a-z0-9-]+\.replit\.app$/,
  /^https?:\/\/[a-z0-9-]+\.repl\.co$/,
  /^https?:\/\/[a-z0-9-]+-\d+\.[a-z0-9]+\.replit\.dev$/,
  /^https?:\/\/.*\.replit\.dev$/,
];

/** True when the Origin is allowed (or absent — same-origin browser tabs). */
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return allowedPatterns.some(p => p.test(origin));
}

/** Blocks curl / wget / Python-requests / bots. Not foolproof, raises the bar. */
function looksLikeBrowser(ua) {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  const blocked = ['curl', 'wget', 'python-requests', 'axios', 'node-fetch', 'go-http', 'java/', 'okhttp'];
  if (blocked.some(b => lower.includes(b))) return false;
  return lower.includes('mozilla');
}

  /*
   RATE LIMITING
 */
const rateLimit = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,                   // requests per window per IP
};

  /* 
   SERVER
 */
const port = parseInt(process.env.PORT || '7432', 10);

module.exports = {
  apiKeys,
  allowedOrigins,
  isAllowedOrigin,
  looksLikeBrowser,
  rateLimit,
  port,
};
