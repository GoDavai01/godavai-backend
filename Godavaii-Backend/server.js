// server.js
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

// 🔒 Make 100% sure we're using the edited app file:
const APP_PATH = path.join(__dirname, "Godavaii-Backend", "app");
const app = require(APP_PATH);
console.log("[BOOT] Using app file:", APP_PATH);

const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not set. Add it to your environment.");
  process.exit(1);
}

mongoose.set("strictQuery", true);

(async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");

    // Ensure geo index (idempotent)
    const Pharmacy = require("./models/Pharmacy");
    try {
      await Pharmacy.collection.createIndex({ location: "2dsphere" });
      console.log("✅ Ensured 2dsphere index on Pharmacy.location");
    } catch (e) {
      console.warn("⚠️ Could not ensure 2dsphere index:", e.message);
    }

    const server = app.listen(PORT, () => {
      console.log(`🚀 GoDavaii backend listening on port ${PORT}`);
    });

    // Graceful shutdowns
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

    // Extra safety nets
    process.on("unhandledRejection", (err) => {
      console.error("💥 Unhandled Rejection:", err);
    });
    process.on("uncaughtException", (err) => {
      console.error("💥 Uncaught Exception:", err);
      shutdown();
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.stack || err.message);
    process.exit(1);
  }
})();
