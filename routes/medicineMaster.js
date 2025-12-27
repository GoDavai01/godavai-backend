import express from "express";
import MedicineMaster from "../models/MedicineMaster.js";
import PharmacyInventory from "../models/PharmacyInventory.js";

// NOTE: apne project ke middleware names ke hisaab se adjust karna
// In your pasted file it was: isAdmin, isPharmacyAuth
import { isAdmin, isPharmacyAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * ✅ SEARCH approved master medicines (pharmacy + admin)
 * GET /api/medicine-master?q=
 */
router.get("/", isPharmacyAuth, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const filter = {
      status: "approved",
      active: true,
      ...(q ? { name: { $regex: q, $options: "i" } } : {}),
    };

    const meds = await MedicineMaster.find(filter).sort({ name: 1 }).limit(50);
    res.json(meds);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch medicine master." });
  }
});

/**
 * ✅ ADMIN: list all master meds (including pending)
 * GET /api/medicine-master/admin/all?q=&status=
 */
router.get("/admin/all", isAdmin, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const status = (req.query.status || "").trim(); // approved/pending/rejected

    const filter = {
      ...(status ? { status } : {}),
      ...(q ? { name: { $regex: q, $options: "i" } } : {}),
    };

    const meds = await MedicineMaster.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json(meds);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch admin master list." });
  }
});

/**
 * ✅ ADMIN: create master medicine (full fields)
 * POST /api/medicine-master/admin
 */
router.post("/admin", isAdmin, async (req, res) => {
  try {
    const payload = {
      ...req.body,
      status: "approved",
      createdByType: "admin",
      createdByPharmacyId: null,
    };

    const med = await MedicineMaster.create(payload);
    res.json(med);
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to create master medicine." });
  }
});

/**
 * ✅ PHARMACY: add new medicine request (pending approval)
 * POST /api/medicine-master/request
 */
router.post("/request", isPharmacyAuth, async (req, res) => {
  try {
    const payload = {
      ...req.body,
      status: "pending",
      createdByType: "pharmacy",
      createdByPharmacyId: req.user?.pharmacyId || null,
      active: true,
    };

    const med = await MedicineMaster.create(payload);
    res.json({ success: true, med });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to submit request." });
  }
});

/**
 * ✅ ADMIN: approve pending request
 * PATCH /api/medicine-master/:id/approve
 */
router.patch("/:id/approve", isAdmin, async (req, res) => {
  try {
    const med = await MedicineMaster.findByIdAndUpdate(
      req.params.id,
      { status: "approved" },
      { new: true }
    );

    res.json({ success: true, med });
  } catch (e) {
    res.status(400).json({ error: "Failed to approve." });
  }
});

/**
 * ✅ ADMIN: reject pending request
 * PATCH /api/medicine-master/:id/reject
 */
router.patch("/:id/reject", isAdmin, async (req, res) => {
  try {
    const med = await MedicineMaster.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );

    res.json({ success: true, med });
  } catch (e) {
    res.status(400).json({ error: "Failed to reject." });
  }
});

export default router;
