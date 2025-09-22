// scripts/backfill-compKey.js
require("dotenv").config();
const mongoose = require("mongoose");
const Medicine = require("../models/Medicine");
const buildCompositionKey = require("../utils/buildCompositionKey");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ Missing MONGO_URI (or MONGODB_URI) in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const cursor = Medicine.find({}).cursor();
  let n = 0;
  for await (const m of cursor) {
    const ck = buildCompositionKey(m.composition || "");
    if (m.compositionKey !== ck) {
      m.compositionKey = ck;
      await m.save();
      n++;
    }
  }
  await Medicine.syncIndexes(); // rebuild new compound index
  console.log("✅ Updated docs:", n);
  process.exit(0);
})();
