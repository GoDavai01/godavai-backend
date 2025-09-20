// server/scripts/importMastersFromExcel.js
require("dotenv").config();
const mongoose = require("mongoose");
const xlsx = require("xlsx");
const path = require("path");
const MasterBrand = require("../models/MasterBrand");
const MasterComposition = require("../models/MasterComposition");
const { toNameKey, parseTypeStrengthPack } = require("../utils/text");

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb";

(async () => {
  await mongoose.connect(MONGO_URL);
  console.log("Connected to Mongo");

  const brandsPath = path.join(__dirname, "..", "data", "brands.xlsx");
  const compsPath = path.join(__dirname, "..", "data", "compositions.xlsx");

  let brandUpserts = 0;
  try {
    const wb = xlsx.readFile(brandsPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    // Try to find a likely column
    const guessCols = ["Brand/Trade Names", "Brand", "Trade Name", "Name"];
    const header = rows.length ? Object.keys(rows[0]) : [];
    const nameCol = guessCols.find((c) => header.includes(c)) || header[0];

    for (const r of rows) {
      const raw = String(r[nameCol] || "").trim();
      if (!raw) continue;

      const nameKey = toNameKey(raw);
      const parsed = parseTypeStrengthPack(raw);

      await MasterBrand.findOneAndUpdate(
        { nameKey },
        {
          $setOnInsert: { name: raw, nameKey },
          ...(parsed.type ? { type: parsed.type } : {}),
          ...(parsed.strength ? { strength: parsed.strength } : {}),
          ...(parsed.packLabel ? { packLabel: parsed.packLabel } : {}),
        },
        { upsert: true }
      );
      brandUpserts++;
    }
    console.log(`Brands upserted: ${brandUpserts}`);
  } catch (e) {
    console.error("Brand import failed:", e.message);
  }

  let compUpserts = 0;
  try {
    const wb = xlsx.readFile(compsPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    const guessCols = ["Composition/Generic Names", "Composition", "Generic Name", "Name"];
    const header = rows.length ? Object.keys(rows[0]) : [];
    const nameCol = guessCols.find((c) => header.includes(c)) || header[0];

    for (const r of rows) {
      const raw = String(r[nameCol] || "").trim();
      if (!raw) continue;

      const nameKey = toNameKey(raw);
      const parsed = parseTypeStrengthPack(raw);
      const addToSet = {};
      if (parsed.type) addToSet.dosageForms = parsed.type;
      if (parsed.packLabel) {
        const unit = parsed.packLabel.split(" ").slice(1).join(" ");
        if (unit) addToSet.packUnits = unit;
      }
      if (parsed.strength) addToSet.commonStrengths = parsed.strength;

      await MasterComposition.findOneAndUpdate(
        { nameKey },
        {
          $setOnInsert: { name: raw, nameKey },
          ...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
        },
        { upsert: true }
      );
      compUpserts++;
    }
    console.log(`Compositions upserted: ${compUpserts}`);
  } catch (e) {
    console.error("Composition import failed:", e.message);
  }

  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
})();
