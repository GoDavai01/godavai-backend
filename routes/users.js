const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

router.get("/", async (req, res) => {
  try {
    const users = await User.find().select("-password -otp -pin");
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Fetch users failed" });
  }
});

router.get("/:id/addresses", async (req, res) => {
  if (!isValidObjectId(req.params.id))
    return res.status(400).json({ error: "Invalid user id" });

  try {
    const user = await User.findById(req.params.id).select("addresses");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user.addresses || []);
  } catch (err) {
    console.error("Error fetching user addresses:", err);
    res.status(500).json({ error: "Failed to fetch addresses" });
  }
});

router.put("/:id/addresses", async (req, res) => {
  if (!isValidObjectId(req.params.id))
    return res.status(400).json({ error: "Invalid user id" });

  try {
    const { addresses } = req.body;
    if (!Array.isArray(addresses))
      return res.status(400).json({ error: "Addresses must be array" });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { addresses },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user.addresses);
  } catch (err) {
    console.error("Error updating user addresses:", err);
    res.status(500).json({ error: "Failed to update addresses" });
  }
});

router.put("/:id", async (req, res) => {
  if (!isValidObjectId(req.params.id))
    return res.status(400).json({ error: "Invalid user id" });

  try {
    const updates = {};
    ["name", "email", "dob", "avatar"].forEach(field => {
      if (field in req.body) updates[field] = req.body[field];
    });
    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Error updating user profile:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
