// server.js
const mongoose = require("mongoose");
require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  // ✅ Ensure the geo index exists (idempotent)
  const Pharmacy = require("./models/Pharmacy");
  try {
    await Pharmacy.collection.createIndex({ location: "2dsphere" });
    console.log("✅ Ensured 2dsphere index on Pharmacy.location");
  } catch (e) {
    console.error("❌ Could not ensure 2dsphere index:", e.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`GoDavai backend running on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    console.log("🔄 Shutting down server...");
    server.close(() => {
      mongoose.disconnect().then(() => {
        console.log("✅ MongoDB disconnected. Server closed.");
        process.exit(0);
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})
.catch((err) => {
  console.error("❌ MongoDB connection error:", err.stack || err.message);
  process.exit(1);
});
