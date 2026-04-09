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

async function callGemini(base64, mimeType) {
  let lastErr;
  for (let i = 0; i < clients.length; i++) {
    try {
      console.log(`✅ Using key slot #${i + 1} of ${clients.length}`);
      const response = await clients[i].models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'Extract ALL text from this image exactly as written. Preserve the original structure and line breaks. Output only the extracted text, nothing else. Do not add any commentary or formatting.' },
          ],
        }],
      });
      return response.text?.trim() || '';
    } catch (err) {
      lastErr = err;
      if (isQuotaError(err) && i < clients.length - 1) {
        console.warn(`😡 Key slot #${i + 1} hit quota/rate-limit — trying next key...`);
        continue;
      }
      throw err;
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
