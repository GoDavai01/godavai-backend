// utils/upload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload folder exists
const uploadDir = path.join(__dirname, '../uploads/prescriptions');
fs.mkdirSync(uploadDir, { recursive: true });

// Storage engine for local uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Save unique filenames to avoid collision
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const unique = `${base}-${Date.now()}${ext}`;
    cb(null, unique);
  }
});

// Multer middleware
const upload = multer({ storage });

module.exports = upload;
