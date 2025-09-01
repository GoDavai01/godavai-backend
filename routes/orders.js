// routes/orders.js
const express = require("express");
const axios = require("axios");
const router = express.Router();
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Pharmacy = require("../models/Pharmacy");
const DeliveryPartner = require("../models/DeliveryPartner");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { notifyUser, saveInAppNotification } = require("../utils/notify");
const { createPaymentRecord } = require("../controllers/paymentsController");
const Payment = require("../models/Payment");
const { markOrderDelivered } = require("../controllers/orderController");

// Use server-side env var (not a React one)
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

// ---- Auto-assign constants (tunable) ----
const AUTOASSIGN_FRESH_MINUTES = 15; // partner pinged within last 15 mins
const WAVES = [
  { delayMs: 0, km: 4.5, k: 8 },      // Wave 1
  { delayMs: 30_000, km: 6.0, k: 6 }, // Wave 2
  { delayMs: 60_000, km: 8.0, k: 6 }, // Wave 3
];

async function findCandidateNear(lng, lat, km, k) {
  const freshSince = new Date(Date.now() - AUTOASSIGN_FRESH_MINUTES * 60 * 1000);

  // Nearest active & approved partners inside radius
  const nearby = await DeliveryPartner.find({
    status: "approved",
    active: true,
    $or: [
      { lastSeenAt: { $gte: freshSince } },              // root freshness (new)
      { "location.lastUpdated": { $gte: freshSince } },  // nested freshness (back-compat)
    ],
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: km * 1000,
      },
    },
  })
    .limit(Math.max(30, k))
    .lean();

  // Debug: nearby pool size
  console.log(`[auto-assign] nearby candidates count=${nearby.length}`);

  // Prefer those with autoAccept and with no active order
  for (const p of nearby) {
    // capacity check: skip if already busy on an active order
    const busy = await Order.exists({
      deliveryPartner: p._id,
      status: { $in: ["assigned", "accepted", "out_for_delivery"] },
    });
    if (!busy) return p; // pick first free (already distance-sorted by $near)
  }
  return null;
}

async function assignOrderToPartner(order, partner) {
  order.deliveryPartner = partner._id;
  order.assignmentHistory = order.assignmentHistory || [];
  const acceptedNow = !!partner.autoAccept;
  order.deliveryAssignmentStatus = acceptedNow ? "accepted" : "assigned";
  order.status = acceptedNow ? "accepted" : "assigned";
  if (!order.assignedAt) order.assignedAt = new Date();
  if (acceptedNow && !order.partnerAcceptedAt) order.partnerAcceptedAt = new Date();
  await order.save();
  try {
    await Payment.updateOne(
      { orderId: order._id },
      { $set: { deliveryPartnerId: partner._id } }
    );
  } catch {}
  return acceptedNow;
}

function scheduleAutoAssign(orderId, baseLng, baseLat) {
  // Fire three waves; each checks if still unassigned before acting
  WAVES.forEach(({ delayMs, km, k }) => {
    setTimeout(async () => {
      try {
        const order = await Order.findById(orderId);
        if (!order) return;
        if (
          order.deliveryPartner ||
          order.deliveryAssignmentStatus !== "unassigned" ||
          order.status !== "processing"
        )
          return;

        // Debug: wave starting
        console.log(`[auto-assign] wave: ${km}km k=${k} for order ${orderId}`);

        const partner = await findCandidateNear(baseLng, baseLat, km, k);
        if (partner) await assignOrderToPartner(order, partner);
      } catch (e) {
        console.error("auto-assign wave error:", e?.message || e);
      }
    }, delayMs);
  });
}

// 1. Create a new order
router.post("/", auth, async (req, res) => {
  try {
    const {
      items,
      address,
      dosage,
      paymentMethod,
      pharmacyId,
      total,
      prescription,
      instructions,
      coupon,
      tip,
      donate,
      deliveryInstructions,
      paymentStatus,
      paymentDetails,
    } = req.body;

    if (!items || !address || !pharmacyId || !total) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!address || typeof address.lat !== "number" || typeof address.lng !== "number") {
      return res.status(400).json({ error: "Address must include lat and lng (map pin)." });
    }

    const order = await Order.create({
      items,
      address,
      dosage,
      paymentMethod,
      pharmacy: pharmacyId,
      total,
      prescription,
      instructions,
      coupon,
      tip,
      donate,
      deliveryInstructions,
      userId: req.user.userId || req.user._id,
      status: "pending",
      paymentStatus: paymentStatus || "NOT_PAID",
      paymentDetails: paymentDetails || {},
      quote: null,
      createdAt: new Date(),

      // ---- A. initialize assignment state ----
      deliveryAssignmentStatus: "unassigned",
      deliveryPartner: undefined,
    });

    try {
      await createPaymentRecord(order._id, { method: paymentMethod });
    } catch (err) {
      console.error("Failed to create payment record:", err);
    }

    const pharmacy = await Pharmacy.findById(pharmacyId);
    const orderUser = await User.findById(order.userId);

    if (pharmacy && pharmacy._id) {
      await notifyUser(
        pharmacy._id.toString(),
        "New Prescription Order",
        `New order #${order._id} has been placed and awaits your quote.`,
        `/pharmacy/orders`
      );
      await saveInAppNotification({
        userId: pharmacy._id,
        title: "New Prescription Order",
        message: `Order #${order._id} needs your quote.`,
      });
    }

    if (orderUser && orderUser._id) {
      await notifyUser(
        orderUser._id.toString(),
        "Prescription Uploaded",
        `Your order #${order._id} is waiting for a quote.`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: orderUser._id,
        title: "Order Placed",
        message: `Order #${order._id} has been created and is pending quote.`,
      });
    }

    res.status(201).json(order);
  } catch (err) {
    console.error("Error placing order:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// --------------- EXACT ROUTES FIRST (before any /:orderId*) ---------------

// Get all orders for logged-in user (JWT protected)
router.get("/myorders", auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user._id;
    if (!userId) return res.status(401).json({ error: "User ID missing from token" });
    const orders = await Order.find({ userId }).populate("pharmacy");
    res.json(orders);
  } catch (err) {
    console.error("Fetch myorders failed:", err?.message || err);
    res.status(500).json({ error: "Fetch order failed" });
  }
});

// Debug/status/utility routes
router.get("/debug", (req, res) => res.json({ ok: true }));
router.get("/test", (req, res) => res.json({ ok: true }));
router.get("/alive", (req, res) => res.json({ status: "orders route alive" }));
router.get("/allorders", async (req, res) => {
  try {
    const orders = await Order.find().limit(5);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Fetch all orders failed" });
  }
});

// --------------------------------------------------------------------------

// 2. Pharmacy submits quote
router.put("/:orderId/quote", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { quoteItems, unavailableItems, price, message } = req.body;

    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        quote: {
          items: quoteItems,
          unavailable: unavailableItems,
          price,
          message,
          quotedAt: new Date(),
        },
        status: "quoted",
      },
      { new: true }
    );

    if (!order) return res.status(404).json({ error: "Order not found" });

    const user = await User.findById(order.userId);
    if (user && user._id) {
      await notifyUser(
        user._id.toString(),
        "Quote Ready for Your Order",
        `Quote for order #${order._id} is ready. Review and confirm!`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: user._id,
        title: "Quote Ready",
        message: `Order #${order._id} has a quote.`,
      });
    }

    res.json(order);
  } catch (err) {
    console.error("Error quoting order:", err);
    res.status(500).json({ error: "Quote submission failed" });
  }
});

// 3. User accepts quote and pays
router.put("/:orderId/accept", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentStatus, paymentDetails } = req.body;

    let updateObj = {
      confirmedAt: new Date(),
    };

    if (paymentStatus === "PARTIAL_PAID") {
      updateObj.status = "processing";
      updateObj.paymentStatus = "PARTIAL_PAID";
      updateObj.paymentDetails = paymentDetails;
    } else if (paymentStatus === "PAID") {
      updateObj.status = "processing";
      updateObj.paymentStatus = "PAID";
      updateObj.paymentDetails = paymentDetails;
    } else {
      updateObj.status = "processing";
    }

    const orderBefore = await Order.findById(orderId);
    if (!orderBefore.pharmacyAcceptedAt) {
      updateObj.pharmacyAcceptedAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        ...updateObj,
      },
      { new: true }
    );

    if (!order) return res.status(404).json({ error: "Order not found" });

    const pharmacy = await Pharmacy.findById(order.pharmacy);
    const user = await User.findById(order.userId);

    if (pharmacy && pharmacy._id) {
      await notifyUser(
        pharmacy._id.toString(),
        "Order Confirmed",
        `Order #${order._id} is confirmed and payment received.`,
        `/pharmacy/orders`
      );
      await saveInAppNotification({
        userId: pharmacy._id,
        title: "Order Confirmed",
        message: `Order #${order._id} is now confirmed and ready to process.`,
      });
    }

    if (user && user._id) {
      await notifyUser(
        user._id.toString(),
        "Order Confirmed",
        `Your order #${order._id} has been confirmed and is being processed.`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: user._id,
        title: "Order Confirmed",
        message: `Order #${order._id} has been confirmed and payment is successful.`,
      });
    }

    res.json(order);

    // ---- Auto-assign start (non-blocking) ----
    try {
      const full = await Order.findById(order._id).populate("pharmacy");
      // Prefer pharmacy location; fallback to user address
      const baseLng = full?.pharmacy?.location?.coordinates?.[0] ?? full?.address?.lng;
      const baseLat = full?.pharmacy?.location?.coordinates?.[1] ?? full?.address?.lat;
      if (typeof baseLng === "number" && typeof baseLat === "number") {
        if (
          !full.deliveryPartner &&
          (full.deliveryAssignmentStatus === "unassigned" || !full.deliveryAssignmentStatus) &&
          full.status === "processing"
        ) {
          scheduleAutoAssign(full._id, baseLng, baseLat);
        }
      }
    } catch (e) {
      console.error("auto-assign schedule (accept) failed:", e?.message || e);
    }
  } catch (err) {
    console.error("Error accepting order:", err);
    res.status(500).json({ error: "Order accept failed" });
  }
});

// 4. Update order status (PUT + POST alias share the same handler)
async function handleStatusUpdate(req, res) {
  try {
    const { orderId } = req.params;
    const { status, statusText } = req.body;

    let updateObj = { status };
    const orderBefore = await Order.findById(orderId);

    // a. Pharmacy Accepts/Starts Processing
    if (status === "processing" && !orderBefore.pharmacyAcceptedAt) {
      updateObj.pharmacyAcceptedAt = new Date();
      orderBefore.assignmentHistory = orderBefore.assignmentHistory || [];
      orderBefore.assignmentHistory.push({
        status: "pharmacy_accepted",
        at: updateObj.pharmacyAcceptedAt,
      });
      await orderBefore.save();
    }

    if (status === "assigned" && !orderBefore.assignedAt) {
      updateObj.assignedAt = new Date();
    }

    if ((status === "accepted" || status === "out_for_delivery") && !orderBefore.partnerAcceptedAt) {
      updateObj.partnerAcceptedAt = new Date();
    }

    if (status === "picked_up" && !orderBefore.pickedUpAt) {
      updateObj.pickedUpAt = new Date();
    }

    if (status === "delivered" && !orderBefore.deliveredAt) {
      updateObj.deliveredAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(orderId, updateObj, { new: true });
    if (!order) return res.status(404).json({ error: "Order not found" });

    // If we just moved to processing and it's still unassigned, schedule auto-assign
    if (
      status === "processing" &&
      !order.deliveryPartner &&
      (order.deliveryAssignmentStatus === "unassigned" || !order.deliveryAssignmentStatus)
    ) {
      try {
        const withPharmacy = await Order.findById(order._id).populate("pharmacy");
        const baseLng =
          withPharmacy?.pharmacy?.location?.coordinates?.[0] ?? withPharmacy?.address?.lng;
        const baseLat =
          withPharmacy?.pharmacy?.location?.coordinates?.[1] ?? withPharmacy?.address?.lat;
        if (typeof baseLng === "number" && typeof baseLat === "number") {
          scheduleAutoAssign(withPharmacy._id, baseLng, baseLat);
        }
      } catch (e) {
        console.error("auto-assign schedule (status=processing) failed:", e?.message || e);
      }
    }

    // If delivered, call controller (also generates invoice) and return
    if (typeof status === "string" && status.toLowerCase() === "delivered") {
      await markOrderDelivered({ params: { id: orderId } }, res);
      return; // Prevent sending response twice!
    }

    const pharmacy = await Pharmacy.findById(order.pharmacy);
    const user = await User.findById(order.userId);

    if (user && user._id) {
      await notifyUser(
        user._id.toString(),
        "Order Status Updated",
        `Your order #${order._id} is now "${statusText || status}".`,
        `/orders/${order._id}`
      );
      await saveInAppNotification({
        userId: user._id,
        title: "Order Status Updated",
        message: `Order #${order._id} is now "${statusText || status}".`,
      });
    }

    if (pharmacy && pharmacy._id) {
      await notifyUser(
        pharmacy._id.toString(),
        "Order Status Updated",
        `Order #${order._id} is now "${statusText || status}".`,
        `/pharmacy/orders`
      );
      await saveInAppNotification({
        userId: pharmacy._id,
        title: "Order Status Updated",
        message: `Order #${order._id} is now "${statusText || status}".`,
      });
    }

    res.json(order);
  } catch (err) {
    console.error("Error updating order status:", err);
    res.status(500).json({ error: "Order status update failed" });
  }
}

router.put("/:orderId/status", handleStatusUpdate);
router.post("/:orderId/status", handleStatusUpdate); // B. POST alias for dashboard

// Get order by id (hardened with ObjectId validation)
router.get("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    const order = await Order.findById(orderId).populate("pharmacy");
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Fetch order failed" });
  }
});

// User rejects quote
router.put("/:orderId/reject", async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        status: "rejected",
        "quote.rejectedAt": new Date(),
      },
      { new: true }
    );
  if (!order) return res.status(404).json({ error: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Quote rejection failed" });
  }
});

// Order ETA using Google Maps Directions
router.get("/:orderId/eta", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order || !order.driverLocation || !order.address) {
      return res.status(400).json({ error: "Order/location info missing" });
    }
    const userLat = order.address.lat || 28.4595;
    const userLng = order.address.lng || 77.0266;
    const driverLat = order.driverLocation.lat;
    const driverLng = order.driverLocation.lng;

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${driverLat},${driverLng}&destination=${userLat},${userLng}&key=${apiKey}`;
    const resp = await axios.get(url);
    const eta = resp.data.routes?.[0]?.legs?.[0]?.duration?.text || "N/A";
    res.json({ eta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADMIN: Assign delivery partner to order
router.patch("/:orderId/assign-delivery-partner", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { deliveryPartnerId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (
      (order.paymentStatus === "COD" ||
        order.paymentStatus === "PAID" ||
        order.paymentStatus === "PARTIAL_PAID") &&
      !order.pharmacyAcceptedAt
    ) {
      order.pharmacyAcceptedAt = order.confirmedAt || order.createdAt || new Date();
      order.assignmentHistory = order.assignmentHistory || [];
      if (!order.assignmentHistory.find((h) => h.status === "pharmacy_accepted")) {
        order.assignmentHistory.push({ status: "pharmacy_accepted", at: order.pharmacyAcceptedAt });
      }
      if (order.status === "pending" || order.status === "quoted") {
        order.status = "processing";
      }
      await order.save();
    }

    order.deliveryPartner = deliveryPartnerId;
    order.deliveryAssignmentStatus = "assigned";
    order.status = "assigned";
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      deliveryPartner: deliveryPartnerId,
      status: "assigned",
      at: new Date(),
    });
    if (!order.assignedAt) {
      order.assignedAt = new Date();
    }
    await order.save();

    await Payment.updateOne(
      { orderId: order._id },
      { $set: { deliveryPartnerId: deliveryPartnerId } }
    );
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: "Failed to assign delivery partner", details: err.message });
  }
});

// Admin/API: retry auto-assign waves immediately
router.post("/:orderId/auto-assign", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).populate("pharmacy");
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.deliveryPartner) return res.json({ ok: true, message: "Already assigned" });

    const lng = order?.pharmacy?.location?.coordinates?.[0] ?? order?.address?.lng;
    const lat = order?.pharmacy?.location?.coordinates?.[1] ?? order?.address?.lat;
    if (typeof lng !== "number" || typeof lat !== "number")
      return res.status(400).json({ error: "Missing base coordinates" });

    scheduleAutoAssign(order._id, lng, lat);
    res.json({ ok: true, message: "Auto-assign scheduled" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET all orders (admin only)
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("userId", "name email mobile address")
      .populate("pharmacy", "name contact city area")
      .populate("deliveryPartner", "name mobile")
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Fetch all orders failed" });
  }
});

// Ratings submission route
router.post("/:orderId/ratings", async (req, res) => {
  try {
    const { pharmacyRating, deliveryRating, deliveryBehavior } = req.body;
    const orderId = req.params.orderId;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    order.pharmacyRating = pharmacyRating;
    order.deliveryRating = deliveryRating;
    order.deliveryBehavior = deliveryBehavior;

    await order.save();
    res.json({ message: "Ratings submitted successfully!" });
  } catch (e) {
    res.status(500).json({ error: "Failed to submit ratings." });
  }
});

router.post("/:id/deliver", markOrderDelivered);

module.exports = router;
