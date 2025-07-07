// verify-auth-export.js
const path = require("path");
const auth = require("./middleware/authMiddleware");

try {
  console.log("✅ Type of authMiddleware:", typeof auth);
  console.log("📄 Loaded from:", require.resolve("./middleware/authMiddleware"));

  if (typeof auth !== "function") {
    console.warn("⚠️  Export is not a function! Check your middleware.");
    process.exit(2);
  }

  process.exit(0);
} catch (err) {
  console.error("❌ Error loading authMiddleware:", err.message);
  process.exit(1);
}
