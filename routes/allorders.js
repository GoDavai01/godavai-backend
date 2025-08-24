// routes/allorders.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const PrescriptionOrder = require('../models/PrescriptionOrder');
const Pharmacy = require('../models/Pharmacy');

// GET /api/allorders/myorders-userid/:userId
router.get('/myorders-userid/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    // 1. Fetch direct orders (populate pharmacy)
    const orders = await Order.find({ userId }).populate("pharmacy");
    // 2. Fetch prescription orders (populate pharmacy)
    const rxOrders = await PrescriptionOrder.find({ user: userId }).populate("pharmacy");
    // 3. Add a type field for easy frontend rendering
    const norm = (orders || []).map(o => ({ ...o.toObject(), orderType: "normal" }));
    const rx = (rxOrders || []).map(o => ({ ...o.toObject(), orderType: "prescription" }));
    // 4. Merge and sort (newest first)
    const all = [...norm, ...rx].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    res.json(all);
  } catch (err) {
    console.error("Fetch all orders error:", err);
    res.status(500).json({ error: 'Fetch all orders failed' });
  }
});

module.exports = router;
