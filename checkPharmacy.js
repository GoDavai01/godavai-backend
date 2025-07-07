require("dotenv").config();
const mongoose = require("mongoose");
const Pharmacy = require("./models/Pharmacy"); // adjust path if needed

async function checkPharmacy() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const pharmacy = await Pharmacy.findOne({ email: "delhi@healthplus.com" });
    if (!pharmacy) {
      console.log("❌ Pharmacy not found");
    } else {
      // Never print password/hash in prod logs
      console.log("✅ Pharmacy exists. Email:", pharmacy.email);
      // If you need to verify password hash, do it here securely (not shown)
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkPharmacy();
