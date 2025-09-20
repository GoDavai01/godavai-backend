// scripts/importMastersFromExcel.js
require("dotenv").config();
const mongoose = require("mongoose");
const xlsx = require("xlsx");
const path = require("path");

const MasterBrand = require("../models/MasterBrand");
const MasterComposition = require("../models/MasterComposition");
const { toNameKey, parseTypeStrengthPack } = require("../utils/text");

const MONGO_URL =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  "mongodb://127.0.0.1:27017/godavaii";

// simple argv parser: --brands= --compositions= --batch= --dry
const argv = Object.fromEntries(
  process.argv.slice(2).map(kv => {
    const [k, ...rest] = kv.split("=");
    return [k.replace(/^--/, ""), rest.join("=")];
  })
);

const BATCH = Math.max(1, parseInt(argv.batch || "1000", 10));

function resolveOrDefault(arg, defParts) {
  return path.resolve(argv[arg] || path.join(...defParts));
}

const brandsPath = resolveOrDefault("brands", [__dirname, "..", "data", "brands.xlsx"]);
const compsPath  = resolveOrDefault("compositions", [__dirname, "..", "data", "compositions.xlsx"]);

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

(async () => {
  const safe = MONGO_URL.replace(/\/\/[^@]+@/, "//***:***@");
  console.log("Connecting to", safe);
  await mongoose.connect(MONGO_URL, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    // dbName: "godavai-prod", // <- uncomment if you want to force a db name
  });
  console.log("Connected to Mongo");

  // Ensure indexes (quick if already present)
  await Promise.all([
    MasterBrand.collection.createIndex({ nameKey: 1 }),
    MasterBrand.collection.createIndex({ popularity: -1 }),
    MasterComposition.collection.createIndex({ nameKey: 1 }),
    MasterComposition.collection.createIndex({ popularity: -1 }),
  ]);

  /* -------------------- BRands -------------------- */
  try {
    const wb = xlsx.readFile(brandsPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    const guessCols = ["Brand/Trade Names", "Brand", "Trade Name", "Name"];
    const header = rows.length ? Object.keys(rows[0]) : [];
    const nameCol = guessCols.find(c => header.includes(c)) || header[0];

    // de-dupe by nameKey before writing
    const seen = new Set();
    const ops = [];
    for (const r of rows) {
      const raw = String(r[nameCol] || "").trim();
      if (!raw) continue;
      const nameKey = toNameKey(raw);
      if (seen.has(nameKey)) continue;
      seen.add(nameKey);

      const { type, strength, packLabel } = parseTypeStrengthPack(raw);

      const $set = {};
      if (type) $set.type = type;
      if (strength) $set.strength = strength;
      if (packLabel) $set.packLabel = packLabel;

      ops.push({
        updateOne: {
          filter: { nameKey },
          update: {
            $setOnInsert: { name: raw, nameKey },
            ...(Object.keys($set).length ? { $set } : {}),
          },
          upsert: true,
        },
      });
    }

    console.log(`Brands to upsert: ${ops.length} (batch=${BATCH})`);
    if (!argv.dry) {
      let done = 0;
      for (const part of chunk(ops, BATCH)) {
        await MasterBrand.bulkWrite(part, { ordered: false });
        done += part.length;
        if (done % (BATCH * 2) === 0 || done === ops.length) {
          const pct = Math.round((done / ops.length) * 100);
          console.log(`  Brands: ${done}/${ops.length} (${pct}%)`);
        }
      }
    } else {
      console.log("  (dry run — nothing written)");
    }
  } catch (e) {
    console.error("Brand import failed:", e.message);
  }

  /* -------------------- Compositions -------------------- */
  try {
    const wb = xlsx.readFile(compsPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    const guessCols = ["Composition/Generic Names", "Composition", "Generic Name", "Name"];
    const header = rows.length ? Object.keys(rows[0]) : [];
    const nameCol = guessCols.find(c => header.includes(c)) || header[0];

    const seen = new Set();
    const ops = [];
    for (const r of rows) {
      const raw = String(r[nameCol] || "").trim();
      if (!raw) continue;
      const nameKey = toNameKey(raw);
      if (seen.has(nameKey)) continue;
      seen.add(nameKey);

      const { type, strength, packLabel } = parseTypeStrengthPack(raw);

      const $addToSet = {};
      if (type) $addToSet.dosageForms = type;
      if (strength) $addToSet.commonStrengths = strength;
      if (packLabel) {
        const unit = packLabel.split(" ").slice(1).join(" ");
        if (unit) $addToSet.packUnits = unit;
      }

      const update = { $setOnInsert: { name: raw, nameKey } };
      if (Object.keys($addToSet).length) update.$addToSet = $addToSet;

      ops.push({
        updateOne: {
          filter: { nameKey },
          update,
          upsert: true,
        },
      });
    }

    console.log(`Compositions to upsert: ${ops.length} (batch=${BATCH})`);
    if (!argv.dry) {
      let done = 0;
      for (const part of chunk(ops, BATCH)) {
        await MasterComposition.bulkWrite(part, { ordered: false });
        done += part.length;
        if (done % (BATCH * 2) === 0 || done === ops.length) {
          const pct = Math.round((done / ops.length) * 100);
          console.log(`  Compositions: ${done}/${ops.length} (${pct}%)`);
        }
      }
    } else {
      console.log("  (dry run — nothing written)");
    }
  } catch (e) {
    console.error("Composition import failed:", e.message);
  }

  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
})();
