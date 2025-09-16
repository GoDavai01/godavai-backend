"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const TaxMap = require("../models/TaxMap");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || undefined });

    const p = path.resolve(__dirname, "..", "data", "gst-zero-33.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const list = Array.isArray(j) ? j : (j.items || []).map(name => ({ name, hsn: j.hsn || "3004" }));

    for (const e of list) {
      const key = String(e.name).toLowerCase();
      await TaxMap.updateOne(
        { key },
        { $set: {
            key,
            displayName: e.name,
            hsn: String(e.hsn || "3004"),
            gstRate: 0,
            source: "static.zero",
            confidence: 1,
            approved: true,
            updatedAt: new Date()
          }},
        { upsert: true }
      );
      console.log("Seeded:", e.name);
    }
    console.log("Done.");
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
