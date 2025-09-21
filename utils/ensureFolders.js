// utils/ensureFolders.js
if (!process.env.AWS_BUCKET_NAME) {
  const fs = require("fs");
  const path = require("path");

  // same base logic as app.js (short version)
  const wanted = process.env.UPLOADS_DIR?.trim();
  const base = wanted
    ? (path.isAbsolute(wanted) ? wanted : path.join(process.cwd(), wanted))
    : path.join(process.cwd(), "uploads");

  const uploadDirs = [
    path.join(base, "medicines"),
    path.join(base, "prescriptions"),
    path.join(base, "delivery-docs"),
    path.join(base, "invoices"),
    path.join(base, "pharmacy"),
    path.join(base, "pharmacies"),
  ];

  uploadDirs.forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
} else {
  console.log("[INFO] AWS_BUCKET_NAME detected – ensureFolders.js: Skipping local folder creation (S3 storage in use)");
}
