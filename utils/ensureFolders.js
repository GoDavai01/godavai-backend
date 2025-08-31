// utils/ensureFolders.js
if (!process.env.AWS_BUCKET_NAME) {
  // Only ensure local folders if not using S3
  const fs = require("fs");
  const path = require("path");

  const uploadDirs = [
    path.join(__dirname, "../uploads/medicines"),
    path.join(__dirname, "../uploads/prescriptions"),
    path.join(__dirname, "../uploads/delivery-docs"),
    path.join(__dirname, "../uploads/invoices"),
    path.join(__dirname, "../uploads/pharmacy"),
    path.join(__dirname, "../uploads/pharmacies"),
  ];

  uploadDirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
} else {
  console.log("[INFO] AWS_BUCKET_NAME detected – ensureFolders.js: Skipping local folder creation (S3 storage in use)");
}
