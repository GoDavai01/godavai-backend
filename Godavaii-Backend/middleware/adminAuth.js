// middleware/adminAuth.js
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

module.exports = async function(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(payload.adminId);
    if (!admin) return res.status(401).json({ message: "Not admin" });
    req.admin = admin;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};
