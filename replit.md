# TextScan

A free, open-source web application for extracting text from images (OCR) powered by Google Gemini Vision AI.

## Tech Stack

- **Runtime:** Node.js 18+
- **Backend:** Express.js
- **AI:** Google Gemini AI (`gemini-2.5-flash` model) via `@google/genai`
- **Image Processing:** Sharp
- **File Uploads:** Multer
- **Frontend:** Vanilla HTML/CSS/JS (static files in `public/`)

## Project Structure

```
textscan/
├── server.js          # Express app entry point (listens on 0.0.0.0:5000)
├── config.js          # Config: API keys, allowed origins, rate limits, port
├── lib/
│   ├── routes.js      # API routes (/extract, /health, /ready)
│   ├── ocr.js         # Gemini AI OCR logic with key rotation
│   ├── upload.js      # Multer file upload configuration
│   └── ipLimit.js     # Daily per-IP rate limiting
├── public/            # Static frontend assets
│   ├── index.html     # Main page
│   └── history/       # Scan history page
└── uploads/           # Temp directory for uploaded images
```

## Configuration

- **PORT:** Set to 5000 (Replit standard)
- **API_KEYS:** Comma-separated Gemini API keys (set as a secret `API_KEYS`)
- **ALLOWED_ORIGINS:** Optional extra allowed origins; Replit domains are pre-configured

## Key Features

- Multi-image OCR with Gemini Vision AI
- API key rotation for quota management
- Dual-layer rate limiting (burst + daily per-IP)
- Browser-side scan history (localStorage)
- Anti-scraping protection (User-Agent + Origin validation)

## Running

```bash
node server.js
```

## Deployment

Configured for Replit autoscale deployment with `node server.js`.
The API key (`API_KEYS`) must be set as a secret for the OCR feature to work.
