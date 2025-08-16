const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = "mongodb+srv://pg19pururvaagarwal:Pururva%4017@akarv.ohy8ebq.mongodb.net/medicineApp?retryWrites=true&w=majority&appName=Akarv";
const userEmail = "pg19pururva.agarwal@isbm.ac.in";  // <--- fix typo if any!
const newPassword = "Godavai12"; // The plain new password

async function resetPassword() {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    const User = mongoose.model(
      'User',
      new mongoose.Schema({ email: String, password: String }, { collection: 'users' })
    );
    const hash = await bcrypt.hash(newPassword, 10);
    const res = await User.updateOne({ email: userEmail }, { password: hash });

    if (res.matchedCount === 0 && res.n === 0) {
      console.error("❌ No user found with email:", userEmail);
    } else {
      console.log("✅ Password updated for", userEmail, res);
    }
  } catch (err) {
    console.error("❌ Error updating password:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

resetPassword();
