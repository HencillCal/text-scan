const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = (process.env.VERCEL || process.env.RENDER) ? '/tmp' : path.join(__dirname, '..', 'uploads');

// Always ensure uploads folder exists on startup
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`✅ Created uploads directory: ${UPLOAD_DIR}/`);
  }
}

const ALLOWED_MIME = /^image\/(jpeg|jpg|png|gif|bmp|webp|tiff|heic|heif)$/i;
const ALLOWED_EXT  = /\.(jpg|jpeg|png|gif|bmp|webp|tiff|heic|heif)$/i;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR + '/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, unique + ext);
  }
});

const uploader = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const okMime = ALLOWED_MIME.test(file.mimetype);
    const okExt  = ALLOWED_EXT.test(file.originalname);
    if (okMime || okExt || file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error(`😡 Unsupported file type: ${file.mimetype}`));
  }
});

// Middleware wrapper with proper multer error handling
function handleUpload(req, res, next) {
  uploader.array('images', 20)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `😡 Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

module.exports = { ensureUploadDir, handleUpload };
