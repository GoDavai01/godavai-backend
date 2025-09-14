// scripts/seedCatalog.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/godavaii';

const FILES = {
  jana: path.join(__dirname, 'janaushadhi_products.csv'),           // name,mrp
  otc:  path.join(__dirname, 'otc_thermometers_apollo.csv'),        // otc_category,title,mrp
  mg:   path.join(__dirname, 'branded_seed_1mg.csv'),               // source,title,mrp,url
};

function toNum(x) {
  if (x == null) return null;
  const n = String(x).replace(/[^0-9.]/g, '');
  return n ? Number(n) : null;
}
function norm(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractStrengthAndForm(title) {
  const t = String(title || '');
  const strength = (t.match(/(\d+(\.\d+)?\s?(mg|mcg|g|ml|iu))/i) || [,''])[1] || '';
  const form = (t.match(/\b(tablet|tab|capsule|cap|syrup|suspension|ointment|cream|gel|drops|injection|spray|solution|powder|lotion|soap|kit|strip|bottle)\b/i) || [,''])[1] || '';
  const pack = (t.match(/\b(\d+['’]s|\d+\s?(tablets|capsules)|\d+\s?ml|pack\s?of\s?\d+)\b/i) || [,''])[1] || '';
  return { strength: strength.trim(), form: form.trim(), packSize: pack.trim() };
}
function commissionFor(category) {
  return category === 'Branded' ? 14 : 19; // Branded=14%, Generic/OTC=19%
}

// dynamic, won’t conflict with your existing models
const medicineSchema = new mongoose.Schema({
  title: String,                 // original display title
  brandName: String,             // for Branded/OTC when applicable
  genericName: String,           // for Janaushadhi (generic)
  strength: String,
  form: String,
  packSize: String,
  category: { type: String, enum: ['Branded','Generic','OTC'] },
  manufacturer: String,
  mrp: Number,
  gstPercent: Number,            // optional, null for now
  commissionPercent: Number,
  source: String,                // 'janaushadhi' | 'apollo' | '1mg'
  sourceUrl: String,
  key: { type: String, index: true, unique: true }, // dedupe key
}, { timestamps: true, collection: 'medicines_catalog' });

const Medicine = mongoose.model('MedicineCatalog', medicineSchema);

// --- loaders ---
function loadCSV(file) {
  if (!fs.existsSync(file)) return [];
  const buf = fs.readFileSync(file);
  return parse(buf, { columns: true, skip_empty_lines: true });
}
function loadJana(file) {
  const rows = loadCSV(file);
  return rows.map(r => {
    const name = r.name || r.product || r.Product || r['Product Name'] || '';
    const mrp = toNum(r.mrp || r.MRP || r.Price);
    const { strength, form, packSize } = extractStrengthAndForm(name);
    const genericName = name.replace(/\s+₹?.*$/,'').trim();
    const title = name;
    const category = 'Generic';
    const source = 'janaushadhi';
    const key = `jana|${norm(title)}`;
    return {
      title, brandName: '', genericName, strength, form, packSize,
      category, mrp, commissionPercent: commissionFor(category),
      source, sourceUrl: '', key
    };
  }).filter(x => x.title);
}
function loadOTC(file) {
  const rows = loadCSV(file);
  return rows.map(r => {
    const title = r.title || r.Title || '';
    const mrp = toNum(r.mrp || r.MRP);
    const { strength, form, packSize } = extractStrengthAndForm(title);
    const category = 'OTC';
    const source = 'apollo';
    const key = `otc|${norm(title)}`;
    return {
      title, brandName: title, genericName: '',
      strength, form, packSize,
      category, mrp, commissionPercent: commissionFor(category),
      source, sourceUrl: '', key
    };
  }).filter(x => x.title);
}
function load1mg(file) {
  const rows = loadCSV(file);
  return rows.map(r => {
    const title = r.title || r.Title || '';
    const mrp = toNum(r.mrp || r.MRP);
    const { strength, form, packSize } = extractStrengthAndForm(title);
    const category = 'Branded';
    const source = '1mg';
    const sourceUrl = r.url || '';
    const key = `1mg|${norm(title)}`;
    return {
      title, brandName: title, genericName: '',
      strength, form, packSize,
      category, mrp, commissionPercent: commissionFor(category),
      source, sourceUrl, key
    };
  }).filter(x => x.title);
}

async function main() {
  await mongoose.connect(MONGO_URI, { autoIndex: true });
  console.log('✅ Connected to Mongo');

  const payload = [
    ...loadJana(FILES.jana),
    ...loadOTC(FILES.otc),
    ...load1mg(FILES.mg),
  ];

  console.log('Loaded items:', payload.length);

  let inserted = 0, updated = 0, skipped = 0;
  for (const doc of payload) {
    try {
      const res = await Medicine.updateOne(
        { key: doc.key },
        { $set: doc },
        { upsert: true }
      );
      if (res.upsertedCount) inserted++;
      else if (res.modifiedCount) updated++;
      else skipped++;
    } catch (e) {
      console.warn('Skip error:', e.message);
      skipped++;
    }
  }

  console.log(`Done → inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
