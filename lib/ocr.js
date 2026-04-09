const fs = require('fs');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const { apiKeys } = require('../config');

if (apiKeys.length === 0) {
  console.warn('😡 [OCR] WARNING: No API keys found. Set API_KEYS=key1,key2 in .env');
}

const clients = apiKeys.map(key => new GoogleGenAI({ apiKey: key }));

const MAX_DIMENSION = 1600;

// Models tried in order — lite has the highest free-tier quota
const MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
];

const PROMPT = 'Extract ALL text from this image exactly as written. Preserve the original structure and line breaks. Output only the extracted text, nothing else. Do not add any commentary or formatting.';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('503') || msg.includes('unavailable') || msg.includes('high demand') || msg.includes('try again later');
}

function isSkippable(err) {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('resource exhausted') ||
    msg.includes('429') ||
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('not supported')
  );
}

async function prepareImage(filePath, mimeType) {
  const stats = fs.statSync(filePath);
  const originalKB = Math.round(stats.size / 1024);

  if (stats.size <= 500 * 1024) {
    const data = fs.readFileSync(filePath);
    return { base64: data.toString('base64'), mimeType };
  }

  const resized = await sharp(filePath)
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();

  console.log(`✅ Resized: ${originalKB}KB → ${Math.round(resized.length / 1024)}KB`);
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

async function callGemini(base64, mimeType) {
  let lastErr;

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`✅ Trying model: ${model}, attempt: ${attempt}`);
        const client = clients[0]; // rotate keys if more than one
        const response = await client.models.generateContent({
          model,
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: PROMPT },
            ],
          }],
        });
        const text = response.text?.trim() || '';
        console.log(`✅ Success with model: ${model} — ${text.length} chars`);
        return text;
      } catch (err) {
        lastErr = err;
        if (isRetryable(err)) {
          if (attempt < 3) {
            const delay = attempt * 3000;
            console.warn(`😡 ${model} overloaded (attempt ${attempt}) — retrying in ${delay}ms...`);
            await sleep(delay);
            continue;
          }
          console.warn(`😡 ${model} still overloaded after retries — trying next model...`);
          break;
        }
        if (isSkippable(err)) {
          console.warn(`😡 ${model} skipped (quota/not found) — trying next model...`);
          break;
        }
        // Unknown error — try next model anyway
        console.warn(`😡 ${model} error: ${err.message} — trying next model...`);
        break;
      }
    }
  }

  throw lastErr;
}

async function extractFromFiles(files) {
  const results = [];
  for (const file of files) {
    const t0 = Date.now();
    try {
      console.log(`🔥 OCR start: ${file.originalname} (${Math.round(file.size / 1024)}KB)`);
      const { base64, mimeType } = await prepareImage(file.path, file.mimetype || 'image/jpeg');
      console.log(`🔥 Prepared in ${Date.now() - t0}ms — sending to AI...`);
      const t1 = Date.now();
      const text = await callGemini(base64, mimeType);
      console.log(`🔥 Done in ${Date.now() - t1}ms`);
      results.push({ name: file.originalname, text, confidence: text.length > 0 ? 99 : 0, success: true });
    } catch (err) {
      console.error(`😡 OCR failed for ${file.originalname}:`, err.message);
      results.push({ name: file.originalname, text: '', confidence: 0, success: false, error: err.message });
    } finally {
      fs.unlink(file.path, () => {});
    }
  }
  return results;
}

module.exports = { extractFromFiles };
