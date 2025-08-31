// fix-pharmacy-medicines.js

const mongoose = require("mongoose");
const Medicine = require("../models/Medicine");
const Pharmacy = require("../models/Pharmacy");

const MONGODB_URI = process.env.MONGODB_URI;
// For safety: connection string must be provided via env variable.

async function run() {
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI not set in environment variables.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const allPharmacies = await Pharmacy.find();
    let updatedCount = 0;
    for (let pharmacy of allPharmacies) {
      const meds = await Medicine.find({ pharmacy: pharmacy._id });
      pharmacy.medicines = meds.map((m) => m._id);
      await pharmacy.save();
      updatedCount++;
      console.log(`✅ Updated: ${pharmacy.name} with ${meds.length} medicines.`);
    }
    console.log(`\nAll pharmacies synced! (${updatedCount} pharmacies updated)\n`);
  } catch (err) {
    console.error("❌ Error updating pharmacy medicines:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    // No need to call process.exit(0); script will end naturally.
  }
}

run();
