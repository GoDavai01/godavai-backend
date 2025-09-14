// scripts/testTax.js
const mongoose = require("mongoose");
require("dotenv").config();

// <-- FIXED PATH (one level up from scripts/)
const { classifyHSNandGST } = require("../utils/tax/taxClassifier"); 
// If you placed it elsewhere, try one of these instead:
// const { classifyHSNandGST } = require("../utils/taxClassifier");
// const { classifyHSNandGST } = require("../taxClassifier");

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || undefined });

  const tests = [
    "paracetamol 500 mg tablet",
    "human insulin 40 iu/ml injection",
    "digital thermometer",
    "crepe bandage 10 cm x 4 m",
  ];

  for (const name of tests) {
    const r = await classifyHSNandGST({ name });
    console.log(name, "->", r);
  }

  await mongoose.disconnect();
  process.exit(0);
})();
