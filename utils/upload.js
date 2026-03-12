const multer = require('multer');
const multerS3 = require('multer-s3');
const s3 = require('./s3-setup');
const path = require("path");
const fs = require("fs");

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/octet-stream'];
const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf", ".heic", ".heif"]);

const haveS3 =
  !!process.env.AWS_BUCKET_NAME &&
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY &&
  !!process.env.AWS_REGION;

const localDir = path.join(process.cwd(), "uploads", "misc");
try { fs.mkdirSync(localDir, { recursive: true }); } catch (_) {}

const storage = haveS3
  ? multerS3({
      s3: s3,
      bucket: process.env.AWS_BUCKET_NAME,
      metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
      key: (req, file, cb) => {
        let folder = 'other';
        if (file.fieldname === 'image' || req.baseUrl.includes('medicines')) folder = 'medicines';
        else if (file.fieldname === 'prescription') folder = 'prescriptions';
        else if (file.fieldname === 'deliveryDoc') folder = 'delivery-docs';
        else if (file.fieldname === 'invoice') folder = 'invoices';
        else if (file.fieldname === 'pharmacyDoc') folder = 'pharmacy';
        else if (file.fieldname === 'pharmacyPhoto' || req.baseUrl.includes('pharmacies')) folder = 'pharmacies';

        const filename = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
        cb(null, `${folder}/${filename}`);
      }
    })
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, localDir),
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, "_")}`),
    });

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || "")).toLowerCase();
    const typeOk = allowedTypes.includes(file.mimetype);
    const extOk = allowedExt.has(ext);
    if (!(typeOk || extOk)) {
      return cb(new Error("Invalid file type (only jpg/png/pdf/webp)"));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;
