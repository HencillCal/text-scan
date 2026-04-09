const fs = require('fs');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const { apiKeys } = require('../config');

if (apiKeys.length === 0) {
  console.warn('😡 [OCR] WARNING: No API keys found. Set API_KEYS=key1,key2 in .env');
}

// Build one client per key so we can rotate instantly on quota exhaustion
const clients = apiKeys.map(key => new GoogleGenAI({ apiKey: key }));

const MAX_DIMENSION = 1600; // px — crisp text without huge payloads
const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];

function isQuotaError(err) {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('resource exhausted') ||
    msg.includes('429') ||
    err.status === 429
  );
}

function isTemporaryError(err) {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('try again') ||
    err.status === 503
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const resizedKB = Math.round(resized.length / 1024);
  console.log(`✅ Resized: ${originalKB}KB → ${resizedKB}KB`);
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

async function callGeminiWithModel(client, model, base64, mimeType) {
  const response = await client.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: 'Extract ALL text from this image exactly as written. Preserve the original structure and line breaks. Output only the extracted text, nothing else. Do not add any commentary or formatting.' },
      ],
    }],
  });
  return response.text?.trim() || '';
}

async function callGemini(base64, mimeType) {
  let lastErr;

  for (let keyIdx = 0; keyIdx < clients.length; keyIdx++) {
    for (const model of MODELS) {
      // Try each model up to 3 times for temporary errors
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`✅ Key #${keyIdx + 1}, model: ${model}, attempt: ${attempt}`);
          const text = await callGeminiWithModel(clients[keyIdx], model, base64, mimeType);
          return text;
        } catch (err) {
          lastErr = err;
          const msg = err.message || '';

          if (isQuotaError(err)) {
            console.warn(`😡 Key #${keyIdx + 1} hit quota — trying next key...`);
            break; // break model loop, try next key
          }

          if (isTemporaryError(err)) {
            if (attempt < 3) {
              const delay = attempt * 2000;
              console.warn(`😡 Model ${model} temporarily unavailable — retrying in ${delay}ms...`);
              await sleep(delay);
              continue;
            } else {
              console.warn(`😡 Model ${model} still unavailable after retries — trying next model...`);
              break; // break attempt loop, try next model
            }
          }

          if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('not found')) {
            console.warn(`😡 Model ${model} not found — trying next model...`);
            break; // try next model
          }

          throw err; // unexpected error, rethrow
        }
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
      console.log(`🔥 Gemini responded in ${Date.now() - t1}ms — ${text.length} chars extracted`);
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
