// routes/prescriptions.js
const express = require('express');
const router = express.Router();
const PrescriptionOrder = require('../models/PrescriptionOrder');
const Pharmacy = require('../models/Pharmacy');
const upload = require('../utils/upload');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const Order = require("../models/Order");
const User = require("../models/User");
const { findPharmaciesNearby } = require('../utils/pharmacyGeo');

const path = require('path');

// === A) AI imports ===
const { extractTextPlus } = require('../utils/ocr');
const { parse: parseMeds } = require('../utils/ai/medParser');

// CRON: Prevent double schedule in dev
let cronRegistered = global.__GODAVAI_CRON_REGISTERED__;
if (!cronRegistered) {
  const cron = require('node-cron');
  const axios = require('axios');
  const SERVER_BASE = process.env.SERVER_BASE_URL || "http://localhost:5000";

  cron.schedule('*/2 * * * *', async () => {
    try {
      console.log("[CRON] Checking for expired prescription quote assignments...");
      await axios.post(`${SERVER_BASE}/api/prescriptions/cron/auto-assign-next`);
    } catch (err) {
      console.error("[CRON] Failed to run auto-assign-next:", err.message, err);
    }
  });
  global.__GODAVAI_CRON_REGISTERED__ = true;
}

// Utility to validate ObjectId
function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// === B) AI parse helper ===
async function runAiParseForOrder(order) {
  try {
    const url = order.prescriptionUrl?.startsWith('/uploads/')
      ? `${process.env.SERVER_BASE_URL || "http://localhost:5000"}${order.prescriptionUrl}`
      : order.prescriptionUrl;

    const { text, engine } = await extractTextPlus(url);
    if (process.env.DEBUG_OCR) {
      console.log(`[AI parse] engine=${engine}, chars=${(text||"").length}, order=${order._id}`);
    }
    const items = parseMeds(text || "");
    order.ai = {
      parser: engine,
      parsedAt: new Date(),
      rawText: (text || "").slice(0, 100000),
      items
    };
    // Optional legacy field (won't persist if not in schema, but harmless)
    order.medicinesRequested = items.map(i => ({
      name: i.name,
      quantity: i.quantity || 1,
      brand: "",
    }));
    await order.save();
  } catch (err) {
    console.error("[AI parse] failed:", err.message);
  }
}

// Find next best pharmacy (not in excludeIds)
async function findNextBestPharmacy({ address, excludeIds = [] }) {
  if (address && address.lat && address.lng) {
    const nearby = await findPharmaciesNearby({
      lat: address.lat,
      lng: address.lng,
      maxDistance: 5000,
      excludeIds
    });
    return nearby[0] || null;
  }
  // (Optional: fallback to old city/area logic, but not recommended)
  return null;
}

// Assign to next pharmacy, or cancel if limit reached (max 5)
async function assignNextPharmacy(order) {
  order.pharmaciesTried = order.pharmaciesTried || [];
  if (order.pharmacyCandidates && order.pharmacyCandidates.length)
    order.pharmaciesTried.push(order.pharmacyCandidates[0]);
  if (order.pharmaciesTried.length >= 5) {
    order.status = "cancelled";
    order.timeline.push({ status: "cancelled", date: new Date() });
    await order.save();
    return false;
  }
  const nextPharmacy = await findNextBestPharmacy({
    address: order.address,
    excludeIds: order.pharmaciesTried
  });
  if (!nextPharmacy) {
    order.status = "cancelled";
    order.timeline.push({ status: "cancelled", date: new Date() });
    await order.save();
    return false;
  }
  order.pharmacyCandidates = [nextPharmacy._id];
  order.quoteExpiry = new Date(Date.now() + 9.5 * 60 * 1000);
  order.pharmaciesTried.push(nextPharmacy._id);
  order.timeline.push({ status: "waiting_for_quotes", date: new Date() });
  await order.save();
  return true;
}

// For split (partial) orders auto assign
async function autoSplitAndAssignUnavailable(prescriptionOrder, parentOrder = null, splitLevel = 1) {
  if (!prescriptionOrder.unavailableItems || !prescriptionOrder.unavailableItems.length) return null;
  prescriptionOrder.pharmaciesTried = prescriptionOrder.pharmaciesTried || [];
  if (prescriptionOrder.pharmacyCandidates && prescriptionOrder.pharmacyCandidates.length)
    prescriptionOrder.pharmaciesTried.push(prescriptionOrder.pharmacyCandidates[0]);
  if (prescriptionOrder.pharmaciesTried.length >= 5) return null;
  const nextPharmacy = await findNextBestPharmacy({
    address: prescriptionOrder.address,
    excludeIds: prescriptionOrder.pharmaciesTried
  });

  if (!nextPharmacy) return null;
  const newCandidates = [nextPharmacy._id];
  const quoteExpiry = new Date(Date.now() + 7.25 * 60 * 1000);

  const unavailableMeds = prescriptionOrder.tempQuote
    ? prescriptionOrder.tempQuote.items.filter(i => prescriptionOrder.unavailableItems.includes(i.medicineName))
    : prescriptionOrder.unavailableItems.map(name => ({ medicineName: name, quantity: 1 }));

  const fulfilledMeds = prescriptionOrder.tempQuote
    ? prescriptionOrder.tempQuote.items.filter(i => i.available !== false && !prescriptionOrder.unavailableItems.includes(i.medicineName))
    : [];

  const splitOrder = await PrescriptionOrder.create({
    user: prescriptionOrder.user,
    prescriptionUrl: prescriptionOrder.prescriptionUrl,
    city: prescriptionOrder.city,
    area: prescriptionOrder.area,
    pharmacyCandidates: newCandidates,
    pharmaciesTried: prescriptionOrder.pharmaciesTried.concat([nextPharmacy._id]),
    quotes: [],
    status: "waiting_for_quotes",
    notes: prescriptionOrder.notes,
    uploadType: "auto",
    quoteExpiry,
    address: prescriptionOrder.address || null,
    timeline: [{ status: 'waiting_for_quotes', date: new Date() }],
    parentOrder: parentOrder ? parentOrder._id : prescriptionOrder._id,
    tempQuote: {
      items: unavailableMeds,
      approxPrice: 0,
      brands: [],
      message: "[Auto split from partial fulfill]",
    },
    alreadyFulfilledItems: fulfilledMeds,
  });
  return splitOrder;
}

// 1. UPLOAD PRESCRIPTION FILE
router.post('/upload', upload.single('prescription'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    // S3: req.file.location is the public URL
    // Local: req.file.path (as fallback)
    const url = req.file.location || (req.file.path.replace(/\\/g, '/').replace(/^.*uploads/, '/uploads'));
    res.json({ url });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: 'Upload failed.', details: err.message });
  }
});

// 2. CREATE PRESCRIPTION ORDER
router.post('/order', auth, async (req, res) => {
  try {
    const { prescriptionUrl, city, area, notes, uploadType, chosenPharmacyId, address } = req.body;
    let pharmacyIds = [];
    let pharmaciesTried = [];
    if (uploadType === "manual") {
      if (!chosenPharmacyId || !mongoose.Types.ObjectId.isValid(chosenPharmacyId)) {
        return res.status(400).json({ message: "Invalid or missing chosenPharmacyId" });
      }
      pharmacyIds = [new mongoose.Types.ObjectId(chosenPharmacyId)];
      pharmaciesTried = [new mongoose.Types.ObjectId(chosenPharmacyId)];
    } 
    else {
      // Find nearest pharmacy by map, within 5km
      if (!address || !address.lat || !address.lng) {
        return res.status(400).json({ message: "Please select a valid address with location." });
      }
      const nearby = await findPharmaciesNearby({ lat: address.lat, lng: address.lng, maxDistance: 5000 });
      if (!nearby.length) {
        return res.status(404).json({ message: "No pharmacies found within 5km of your location." });
      }
      pharmacyIds = [nearby[0]._id];
      pharmaciesTried = [nearby[0]._id];
    }
    const expiryMins = 9.5;
    const quoteExpiry = new Date(Date.now() + expiryMins * 60 * 1000);

    const order = await PrescriptionOrder.create({
      user: req.user.userId,
      prescriptionUrl,
      city,
      area,
      pharmacyCandidates: pharmacyIds,
      pharmaciesTried,
      quotes: [],
      status: "waiting_for_quotes",
      notes,
      uploadType,
      quoteExpiry,
      address: address || null,
      timeline: [{ status: 'waiting_for_quotes', date: new Date() }]
    });

    // Non-blocking but not at the mercy of timers
    Promise.resolve().then(() => runAiParseForOrder(order)).catch(() => {});

    res.json(order);
  } catch (err) {
    console.error("Prescription order creation error:", err);
    res.status(500).json({ message: "Order creation failed", error: err.message });
  }
});

// 3. PHARMACY ADDS QUOTE
router.post('/quote/:orderId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const pharmacyId = req.user.pharmacyId;
    const { quote, message } = req.body;
    const quoteTotal = Array.isArray(quote)
      ? quote.filter(i => i.available !== false).reduce((a, b) => a + ((b.price || 0) * (b.quantity || 1)), 0)
      : 0;
    const unavailableItems = Array.isArray(quote)
      ? quote.filter(i => !i.available).map(i => i.medicineName)
      : [];

    const order = await PrescriptionOrder.findById(req.params.orderId);
    if (!order || !order.pharmacyCandidates.map(String).includes(String(pharmacyId))) {
      return res.status(403).json({ error: "Not eligible for this order." });
    }
    const now = new Date();
    if (
      order.status !== "waiting_for_quotes" ||
      !order.quoteExpiry || order.quoteExpiry < now
    ) {
      return res.status(400).json({ error: "Quote window has expired or already submitted." });
    }
    if (order.quotes.some(q => q.pharmacy.toString() === pharmacyId.toString())) {
      return res.status(400).json({ error: "Already quoted." });
    }

    const newQuoteObj = {
      pharmacy: pharmacyId,
      items: quote,
      price: quoteTotal,
      message: message || "",
      unavailableItems,
      createdAt: new Date()
    };

    order.tempQuote = newQuoteObj;
    order.quotes.push(newQuoteObj);
    order.status = "pending_user_confirm";
    order.unavailableItems = unavailableItems;
    order.pharmacy = pharmacyId;
    order.timeline.push({ status: "pending_user_confirm", date: new Date() });

    await order.save();
    res.json(order);
  } catch (err) {
    console.error("QUOTE SUBMIT ERROR", err);
    res.status(500).json({ error: 'Failed to submit quote.', details: err.message });
  }
});

// 4. USER RESPONDS TO QUOTE
router.post('/respond/:orderId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const { response } = req.body;
    const order = await PrescriptionOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (response === 'rejected' && order.uploadType === "auto" && order.status === "pending_user_confirm") {
      const assigned = await assignNextPharmacy(order);
      if (!assigned) {
        order.status = "cancelled";
        order.userResponse = "rejected";
        order.timeline.push({ status: "cancelled", date: new Date() });
        await order.save();
        return res.json(order);
      } else {
        order.status = "waiting_for_quotes";
        order.userResponse = "rejected";
        order.timeline.push({ status: "waiting_for_quotes", date: new Date() });
        await order.save();
        return res.json(order);
      }
    } else {
      let status = response === 'accepted' ? 'confirmed' : 'cancelled';
      order.userResponse = response;
      order.status = status;
      order.timeline.push({ status, date: new Date() });
      await order.save();
      return res.json(order);
    }
  } catch (err) {
    console.error("Respond to quote error:", err);
    res.status(500).json({ error: 'Failed to process response.', details: err.message });
  }
});

// 5. GET USER PRESCRIPTION ORDERS
router.get('/user-orders', auth, async (req, res) => {
  try {
    const orders = await PrescriptionOrder.find({ user: req.user.userId }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("User orders fetch error:", err);
    res.status(500).json({ error: 'Failed to get user orders.', details: err.message });
  }
});

// 6. GET PHARMACY PRESCRIPTION ORDERS
router.get('/pharmacy-orders', auth, async (req, res) => {
  try {
    if (!req.user.pharmacyId) return res.status(403).json({ error: "Not authorized" });
    const orders = await PrescriptionOrder.find({
      pharmacyCandidates: req.user.pharmacyId
    }).sort({ createdAt: -1 });
// Fire-and-forget OCR for any order that doesn't have AI yet
orders.forEach(o => {
  if (!o.ai && o.prescriptionUrl) {
    Promise.resolve().then(() => runAiParseForOrder(o)).catch(() => {});
  }
});
    res.json(orders);
  } catch (err) {
    console.error("Pharmacy orders fetch error:", err);
    res.status(500).json({ error: 'Failed to get pharmacy orders.', details: err.message });
  }
});

// 7. GET SINGLE PRESCRIPTION ORDER (with quote/pharmacy details)
router.get('/order/:orderId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const order = await PrescriptionOrder.findById(req.params.orderId)
      .populate('quotes.pharmacy', 'name area city')
      .populate('pharmacy', 'name area city');
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    console.error("Fetch prescription order error:", err);
    res.status(500).json({ error: 'Failed to get order.', details: err.message });
  }
});

// === D) Utility endpoints ===

// Re-run AI on demand
router.post('/reparse/:orderId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const order = await PrescriptionOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    await runAiParseForOrder(order);
    res.json({ ok: true, ai: order.ai });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get AI result
router.get('/ai/:orderId', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ error: "Invalid orderId" });
    const order = await PrescriptionOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order.ai || { items: [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. ACCEPT PRESCRIPTION ORDER
router.put("/:prescriptionOrderId/accept", async (req, res) => {
  try {
    if (!isValidId(req.params.prescriptionOrderId)) return res.status(400).json({ error: "Invalid prescriptionOrderId" });
    const { prescriptionOrderId } = req.params;
    const { paymentStatus, paymentDetails } = req.body;
    const order = await PrescriptionOrder.findById(prescriptionOrderId).populate("pharmacy");
    if (!order) return res.status(404).json({ error: "Prescription order not found" });

    order.paymentStatus = paymentStatus || "PAID";
    order.paymentDetails = paymentDetails || {};
    order.confirmedAt = new Date();
    order.status = "processing";
    await order.save();

    if (order.unavailableItems && order.unavailableItems.length) {
      await autoSplitAndAssignUnavailable(order, order, 1);
    }
    res.json(order);
  } catch (err) {
    console.error("Accept prescription order error:", err);
    res.status(500).json({ error: "Prescription order accept failed", details: err.message });
  }
});

// 9. CONVERT TO NORMAL ORDER
router.post("/:prescriptionOrderId/convert-to-order", auth, async (req, res) => {
  try {
    if (!isValidId(req.params.prescriptionOrderId)) return res.status(400).json({ error: "Invalid prescriptionOrderId" });
    const { prescriptionOrderId } = req.params;
    const prescriptionOrder = await PrescriptionOrder.findById(prescriptionOrderId).populate("pharmacy");
    if (!prescriptionOrder) return res.status(404).json({ error: "Prescription order not found" });

    let tempQuote = prescriptionOrder.tempQuote;
    if ((!tempQuote || !tempQuote.items || !tempQuote.items.length) && Array.isArray(prescriptionOrder.quotes) && prescriptionOrder.quotes.length) {
      tempQuote = prescriptionOrder.quotes[prescriptionOrder.quotes.length - 1];
    }
    const items = (tempQuote?.items || []).filter(i => i.available !== false).map(i => ({
      name: i.medicineName,
      quantity: i.quantity || 1,
      price: i.price || 0,
    }));

    if (!prescriptionOrder.pharmacy || !prescriptionOrder.pharmacy._id) {
      return res.status(400).json({ error: "Pharmacy not assigned" });
    }
    if (!items.length) return res.status(400).json({ error: "No available medicines in quote" });

    let address = req.body.address || prescriptionOrder.address || { addressLine: "", name: "", phone: "" };
    if (!address.addressLine && prescriptionOrder.area) {
      address.addressLine = prescriptionOrder.area;
    }

    const newOrder = new Order({
      userId: prescriptionOrder.user,
      pharmacy: prescriptionOrder.pharmacy._id,
      address: address,
      items,
      total: prescriptionOrder.tempQuote?.approxPrice || items.reduce((sum, i) => sum + (i.price * i.quantity), 0),
      status: "processing",
      prescription: prescriptionOrder.prescriptionUrl,
      paymentStatus: prescriptionOrder.paymentStatus || "PAID",
      paymentMethod: prescriptionOrder.paymentDetails?.method || "",
      paymentDetails: prescriptionOrder.paymentDetails || {},
      createdAt: new Date(),
      note: prescriptionOrder.notes || "",
    });

    await newOrder.save();
    prescriptionOrder.status = "converted_to_order";
    prescriptionOrder.convertedOrderId = newOrder._id;
    await prescriptionOrder.save();

    res.json({ orderId: newOrder._id });
  } catch (err) {
    console.error("Convert to normal order error:", err);
    res.status(500).json({ error: "Failed to convert prescription order", details: err.message });
  }
});

// 10. CRON: AUTO-ASSIGN NEXT PHARMACY ON QUOTE EXPIRY
router.post('/cron/auto-assign-next', async (req, res) => {
  try {
    const now = new Date();
    const pending = await PrescriptionOrder.find({
      status: "waiting_for_quotes",
      quoteExpiry: { $lt: now }
    });
    let reassigned = 0;
    for (const order of pending) {
      if (order.quotes && order.quotes.length > 0) continue;
      const ok = await assignNextPharmacy(order);
      if (ok) reassigned++;
    }
    res.json({ ok: true, reassigned });
  } catch (err) {
    console.error("CRON auto-assign error:", err);
    res.status(500).json({ error: "Cron failed", details: err.message });
  }
});

module.exports = router;
