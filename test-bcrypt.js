// test-bcrypt.js
const bcrypt = require('bcryptjs'); // Ensure this is in your package.json

const hash = "$2a$10$Jw3Y43pPMSt1TCqoqFjwoOqQfpYBl47sPi8TwR3Leiw4RTqJKWBVm";
const password = "Godavai12";

bcrypt.compare(password, hash, (err, result) => {
  if (err) {
    console.error("❌ Error comparing password:", err);
    process.exit(1);
  }
  console.log("✅ Password matches?", result); // true or false
  process.exit(result ? 0 : 2);
});
