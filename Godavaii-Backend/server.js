// server.js
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

/** Try a few likely locations for app.js and use the first that resolves */
function loadExpressApp() {
  const candidates = [
    path.join(__dirname, "app"),                       // ./app.js
    path.join(__dirname, "app.js"),                    // explicit file
    path.join(__dirname, "Godavaii-Backend", "app"),   // ./Godavaii-Backend/app.js
    path.join(__dirname, "src", "app"),                // ./src/app.js
  ];

  for (const p of candidates) {
    try {
      const resolved = require.resolve(p);
      console.log("[BOOT] Using app file:", resolved);
      return require(resolved);
    } catch (_) {
      // keep trying
    }
  }
  throw new Error(
    "Could not find app.js. Tried:\n- " + candidates.join("\n- ")
  );
}

const app = loadExpressApp();

const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not set.");
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
    try {
      const Pharmacy = require("./models/Pharmacy");
      await Pharmacy.collection.createIndex({ location: "2dsphere" });
      console.log("✅ Ensured 2dsphere index on Pharmacy.location");
    } catch (e) {
      console.warn("⚠️ Could not ensure 2dsphere index:", e.message);
    }

    const server = app.listen(PORT, () => {
      console.log(`🚀 GoDavaii backend listening on port ${PORT}`);
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
    process.on("unhandledRejection", (err) =>
      console.error("💥 Unhandled Rejection:", err)
    );
    process.on("uncaughtException", (err) => {
      console.error("💥 Uncaught Exception:", err);
      shutdown();
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.stack || err.message);
    process.exit(1);
  }
})();
