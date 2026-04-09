const fs = require('fs');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const OpenAI = require('openai');
const { geminiKeys, aimlKeys, openaiKeys, groqKeys } = require('../config');

const MAX_DIMENSION = 1600;
const PROMPT = 'Extract ALL text from this image exactly as written. Preserve the original structure and line breaks. Output only the extracted text, nothing else. Do not add any commentary or formatting.';

/* ── Gemini setup ── */
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash'];
const geminiClients = geminiKeys.map(key => new GoogleGenAI({ apiKey: key }));

/* ── OpenAI-compatible setup (OpenAI, AI/ML API, Groq) ── */
function makeOpenAIClients(keys, baseURL) {
  return keys.map(key => new OpenAI({ apiKey: key, ...(baseURL ? { baseURL } : {}) }));
}

const aimlClients  = makeOpenAIClients(aimlKeys,  'https://api.aimlapi.com/v1');
const openaiClients = makeOpenAIClients(openaiKeys);
const groqClients  = makeOpenAIClients(groqKeys,  'https://api.groq.com/openai/v1');

/* Log loaded providers */
console.log(`✅ Providers loaded — Gemini:${geminiKeys.length} AIML:${aimlKeys.length} OpenAI:${openaiKeys.length} Groq:${groqKeys.length}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(err) {
  const m = (err.message || '').toLowerCase();
  return m.includes('503') || m.includes('unavailable') || m.includes('high demand') || m.includes('try again later') || m.includes('overloaded');
}
function isQuota(err) {
  const m = (err.message || '').toLowerCase();
  return m.includes('quota') || m.includes('rate limit') || m.includes('resource exhausted') || m.includes('429') || m.includes('run out of credits') || m.includes('top up') || m.includes('billing') || (err.status === 429);
}
function isNotFound(err) {
  const m = (err.message || '').toLowerCase();
  return m.includes('404') || m.includes('not found') || m.includes('not supported');
}

/* ── Image prep ── */
async function prepareImage(filePath, mimeType) {
  const stats = fs.statSync(filePath);
  if (stats.size <= 500 * 1024) {
    const data = fs.readFileSync(filePath);
    return { base64: data.toString('base64'), mimeType };
  }
  const resized = await sharp(filePath)
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  console.log(`✅ Resized: ${Math.round(stats.size / 1024)}KB → ${Math.round(resized.length / 1024)}KB`);
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

/* ── Try a single key+model, returns text or throws ── */
async function tryWithRetry(fn, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryable(err) && attempt < 3) {
        const delay = attempt * 3000;
        console.warn(`😡 ${label} overloaded (attempt ${attempt}) — retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

/* ── Gemini provider ── */
async function tryGemini(base64, mimeType) {
  if (geminiClients.length === 0) return null;
  let lastErr;
  for (const model of GEMINI_MODELS) {
    for (let ki = 0; ki < geminiClients.length; ki++) {
      try {
        const label = `Gemini model=${model} key=#${ki + 1}`;
        console.log(`🔵 Trying ${label}`);
        const text = await tryWithRetry(async () => {
          const res = await geminiClients[ki].models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text: PROMPT }] }],
          });
          return res.text?.trim() || '';
        }, label);
        console.log(`✅ Gemini success — ${text.length} chars`);
        return text;
      } catch (err) {
        lastErr = err;
        if (isNotFound(err)) { console.warn(`😡 Gemini ${model} not found — trying next model`); break; }
        if (isQuota(err))    { console.warn(`😡 Gemini key #${ki + 1} quota — trying next key`); continue; }
        console.warn(`😡 Gemini key #${ki + 1} error: ${err.message}`);
      }
    }
  }
  console.warn('😡 All Gemini keys/models exhausted — trying next provider...');
  return null; // signal to try next provider
}

/* ── Generic OpenAI-compatible provider ── */
async function tryOpenAICompatible(clients, models, providerName, base64, mimeType) {
  if (clients.length === 0) return null;
  let lastErr;
  for (const model of models) {
    for (let ki = 0; ki < clients.length; ki++) {
      try {
        const label = `${providerName} model=${model} key=#${ki + 1}`;
        console.log(`🟣 Trying ${label}`);
        const text = await tryWithRetry(async () => {
          const res = await clients[ki].chat.completions.create({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                { type: 'text', text: PROMPT },
              ],
            }],
            max_tokens: 4096,
          });
          return res.choices?.[0]?.message?.content?.trim() || '';
        }, label);
        console.log(`✅ ${providerName} success — ${text.length} chars`);
        return text;
      } catch (err) {
        lastErr = err;
        if (isNotFound(err)) { console.warn(`😡 ${providerName} ${model} not found — trying next model`); break; }
        if (isQuota(err))    { console.warn(`😡 ${providerName} key #${ki + 1} quota — trying next key`); continue; }
        console.warn(`😡 ${providerName} key #${ki + 1} error: ${err.message}`);
      }
    }
  }
  console.warn(`😡 All ${providerName} keys/models exhausted — trying next provider...`);
  return null;
}

/* ── Main cascade ── */
async function callAI(base64, mimeType) {
  // 1. Gemini
  const geminiResult = await tryGemini(base64, mimeType);
  if (geminiResult !== null) return geminiResult;

  // 2. AI/ML API
  const aimlResult = await tryOpenAICompatible(
    aimlClients,
    ['gpt-4o', 'gpt-4-turbo', 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo'],
    'AI/ML API',
    base64, mimeType
  );
  if (aimlResult !== null) return aimlResult;

  // 3. OpenAI
  const openaiResult = await tryOpenAICompatible(
    openaiClients,
    ['gpt-4o', 'gpt-4-turbo'],
    'OpenAI',
    base64, mimeType
  );
  if (openaiResult !== null) return openaiResult;

  // 4. Groq
  const groqResult = await tryOpenAICompatible(
    groqClients,
    ['llama-3.2-90b-vision-preview', 'llama-3.2-11b-vision-preview'],
    'Groq',
    base64, mimeType
  );
  if (groqResult !== null) return groqResult;

  throw new Error('All AI providers failed or have no keys configured. Please add API keys to settings.json.');
}

/* ── Public entry point ── */
async function extractFromFiles(files) {
  const results = [];
  for (const file of files) {
    const t0 = Date.now();
    try {
      console.log(`🔥 OCR start: ${file.originalname} (${Math.round(file.size / 1024)}KB)`);
      const { base64, mimeType } = await prepareImage(file.path, file.mimetype || 'image/jpeg');
      console.log(`🔥 Prepared in ${Date.now() - t0}ms`);
      const t1 = Date.now();
      const text = await callAI(base64, mimeType);
      console.log(`🔥 Done in ${Date.now() - t1}ms — ${text.length} chars`);
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
