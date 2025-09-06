// server.js
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

/** Resolve an app.js in a few common layouts and log what we pick */
function loadExpressApp() {
  const here = __dirname;
  const candidates = [
    path.join(here, "app.js"),
    path.join(here, "app"),                     // extensionless
    path.join(here, "Godavaii-Backend", "app.js"),
    path.join(here, "Godavaii-Backend", "app"),
    path.join(here, "src", "app.js"),
    path.join(here, "src", "app"),
  ];

  // try each with and without ".js"
  for (const p of candidates) {
    const withJs = p.endsWith(".js") ? p : p + ".js";
    if (fs.existsSync(withJs)) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const app = require(withJs);
      if (typeof app !== "function") {
        throw new Error(`[BOOT] Found ${withJs} but it did not export an express app function`);
      }
      console.log("[BOOT] Using app file:", withJs);
      return app;
    }
  }
  throw new Error("[BOOT] Could not find app.js. Tried:\n- " + candidates.map(c => (c.endsWith(".js") ? c : c + ".js")).join("\n- "));
}

const app = loadExpressApp();

const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not set. Add it to your .env / Render env vars.");
  process.exit(1);
}

mongoose.set("strictQuery", true);

(async () => {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("✅ MongoDB connected");

    // 🔤 Load/prime pharma dictionary and log size/path
    try {
      const Medicine = require("./models/Medicine");
      const { primeFromDB, dictSize, dictLoadedFromFile } = require("./utils/pharma/spellfix");
      console.log(`[spellfix] loading dict… file=${dictLoadedFromFile()} path=${process.env.PHARMA_DICTIONARY_PATH || "(none)"}`);
      await primeFromDB(Medicine);
      console.log(`[spellfix] dictionary ready. size=${dictSize()}`);
    } catch (e) {
      console.warn("⚠️ Pharma dict prime/log failed:", e.message);
    }

    // 🔒 GUARANTEE INDEXES (best practice): run on connection "open"
    // This will (idempotently) create the 2dsphere index on Pharmacy.location if missing.
    mongoose.connection.once("open", async () => {
      try {
        const Pharmacy = require("./models/Pharmacy");
        await Pharmacy.syncIndexes(); // safe + idempotent
        console.log("✅ Pharmacy indexes synchronized (2dsphere on location included).");
      } catch (e) {
        console.error("❌ Failed to sync Pharmacy indexes:", e.message);
      }
    });

    // Ensure geo/indexes (idempotent)
    try {
      const Pharmacy = require("./models/Pharmacy");
      if (Pharmacy?.collection?.createIndex) {
        await Pharmacy.collection.createIndex({ location: "2dsphere" });
        console.log("✅ Ensured 2dsphere index on Pharmacy.location");
      }
    } catch (e) {
      console.warn("⚠️ Could not ensure Pharmacy 2dsphere index:", e.message);
    }

    // ✅ Ensure all indexes on DeliveryPartner (includes 2dsphere on location)
    try {
      const DeliveryPartner = require("./models/DeliveryPartner");
      if (DeliveryPartner?.syncIndexes) {
        await DeliveryPartner.syncIndexes();
        console.log("✅ Ensured indexes on DeliveryPartner (syncIndexes)");
      } else if (DeliveryPartner?.collection?.createIndex) {
        // Fallback for older Mongoose
        await DeliveryPartner.collection.createIndex({ location: "2dsphere" });
        console.log("✅ Ensured 2dsphere index on DeliveryPartner.location");
      }
    } catch (e) {
      console.warn("⚠️ Could not ensure DeliveryPartner indexes:", e.message);
    }

    const server = app.listen(PORT, () => {
      console.log(`🚀 GoDavaii backend listening on port ${PORT}`);
      console.log("👉 Try GET /__up and /__routes to verify runtime routes.");
    });

    const shutdown = () => {
      console.log("🔄 Shutting down server…");
      server.close(() => {
        mongoose.disconnect().then(() => {
          console.log("✅ MongoDB disconnected. Server closed.");
          process.exit(0);
        });
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("unhandledRejection", (err) => console.error("💥 Unhandled Rejection:", err));
    process.on("uncaughtException", (err) => {
      console.error("💥 Uncaught Exception:", err);
      shutdown();
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.stack || err.message);
    process.exit(1);
  }
})();

module.exports = app;
