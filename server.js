const mongoose = require("mongoose");
require("dotenv").config();

const app = require("./app"); // Import the app

const PORT = process.env.PORT || 5000;

// NEVER log secrets in production!
if (process.env.NODE_ENV !== "production") {
  console.log("ENV PORT:", process.env.PORT);
  console.log("MONGO_URI:", process.env.MONGO_URI ? "set" : "missing");
  console.log("JWT_SECRET:", process.env.JWT_SECRET ? "set" : "missing");
}

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`GoDavai backend running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
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
    process.exit(1); // Exit if DB connection fails
  });
