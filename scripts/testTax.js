// scripts/testTax.js
// Quick manual tester for classifyHSNandGST.
// Usage:
//   node scripts/testTax.js
//   node scripts/testTax.js "Paracetamol 650 mg Tablet"
//   node scripts/testTax.js "Digital Thermometer"
//
// Requires .env with MONGO_URI (and your web search keys for best results).

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const { classifyHSNandGST } = require("../utils/tax/taxClassifier");

const DEFAULT_ITEMS = [
  { name: "Paracetamol 650 mg Tablet", form: "tablet" },
  { name: "Insulin Glargine 100 IU/ml Injection", form: "injection" },
  { name: "Cetirizine 10 mg Tablet", form: "tablet" },
  { name: "Disposable Syringe 5 ml", form: "device" },
  { name: "Digital Thermometer", form: "device" },
  { name: "Glucometer Test Strips (50)", form: "device" },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    });

    const args = process.argv.slice(2);
    const items = args.length ? [{ name: args.join(" ") }] : DEFAULT_ITEMS;

    for (const it of items) {
      const res = await classifyHSNandGST(it);
      console.log("\nItem:", it.name);
      console.log(res);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
