const multer = require('multer');
const multerS3 = require('multer-s3');
const s3 = require('./s3-setup');

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
     // acl: 'public-read',  // <-- Gone!
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
      // Choose folder based on fieldname or route
      let folder = 'other';

      // Folder based on common fieldnames (customize as needed)
      if (file.fieldname === 'image' || req.baseUrl.includes('medicines')) folder = 'medicines';
      else if (file.fieldname === 'prescription') folder = 'prescriptions';
      else if (file.fieldname === 'deliveryDoc') folder = 'delivery-docs';
      else if (file.fieldname === 'invoice') folder = 'invoices';
      else if (file.fieldname === 'pharmacyDoc') folder = 'pharmacy';
      else if (file.fieldname === 'pharmacyPhoto' || req.baseUrl.includes('pharmacies')) folder = 'pharmacies';

      const filename = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
      cb(null, `${folder}/${filename}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Invalid file type (only jpg/png/pdf/webp)"));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;
