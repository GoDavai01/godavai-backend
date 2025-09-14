// Usage: node scripts/seedTaxMapFromCsv.js ./data/taxmap-starter.csv
// (works with CSV or TSV; header must be:
//  key,displayName,hsn,gstRate,source,confidence,approved)

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const TaxMap = require("../models/TaxMap"); // ensure this file exists

function bool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function detectDelim(headerLine) {
  const comma = (headerLine.match(/,/g) || []).length;
  const tab = (headerLine.match(/\t/g) || []).length;
  return tab > comma ? "\t" : ",";
}

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error("Pass a path: node scripts/seedTaxMapFromCsv.js ./data/taxmap-starter.csv");
    process.exit(1);
  }
  const raw = fs.readFileSync(path.resolve(file), "utf8").replace(/\r\n/g, "\n");
  const [header, ...rows] = raw.split("\n").filter(Boolean);

  const delim = detectDelim(header);
  const cols = header.split(delim).map(s => s.trim().toLowerCase());
  const need = ["key","displayname","hsn","gstrate","source","confidence","approved"];
  for (const n of need) if (!cols.includes(n)) {
    console.error("Bad header. Need:", need.join(", "));
    console.error("Got:", cols.join(", "));
    process.exit(1);
  }

  const idx = Object.fromEntries(cols.map((c,i)=>[c,i]));

  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || undefined });
  let upserts = 0, skipped = 0;

  for (const line of rows) {
    const parts = line.split(delim);
    if (parts.length < 7) { skipped++; continue; }

    const key = (parts[idx.key] || "").trim();
    if (!key) { skipped++; continue; }

    const doc = {
      key,
      displayName: (parts[idx.displayname] || "").trim(),
      hsn: String((parts[idx.hsn] || "").trim()),
      gstRate: Number((parts[idx.gstrate] || "").trim()),
      source: (parts[idx.source] || "").trim() || "static",
      confidence: Number((parts[idx.confidence] || "0.9").trim()),
      approved: bool(parts[idx.approved]),
      updatedAt: new Date()
    };

    await TaxMap.updateOne({ key: doc.key }, { $set: doc }, { upsert: true });
    upserts++;
  }

  console.log(`Upserted ${upserts} rows. Skipped ${skipped}.`);
  await mongoose.disconnect();
  process.exit(0);
})();
