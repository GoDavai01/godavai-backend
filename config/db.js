const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }

  // Optional: extra connection event listeners for production monitoring
  mongoose.connection.on("disconnected", () => {
    console.error("MongoDB disconnected!");
  });
  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error event:", err);
  });
};

module.exports = connectDB;
