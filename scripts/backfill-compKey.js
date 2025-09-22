// scripts/backfill-compKey.js
require("dotenv").config();
const mongoose = require("mongoose");
const Medicine = require("../models/Medicine");
const buildCompositionKey = require("../utils/buildCompositionKey");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
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
  await mongoose.model("Medicine").syncIndexes(); // <-- rebuild new compound index
  console.log("Updated docs:", n);
  process.exit(0);
})();
