const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const auth = require("../middleware/auth");
const LabTest = require("../models/LabTest");
const LabPackage = require("../models/LabPackage");
const LabBooking = require("../models/LabBooking");
const { DEFAULT_TESTS, DEFAULT_PACKAGES, SLOT_WINDOWS } = require("../data/labCatalog");

const router = express.Router();

const HOLD_MINUTES = Number(process.env.LAB_BOOKING_HOLD_MINUTES || 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

let LAB_UPLOAD_DIR = path.join(process.cwd(), "uploads", "lab-bookings");
let catalogSeeded = false;

function asText(v) {
  return String(v == null ? "" : v).trim();
}

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v) {
  if (typeof v === "boolean") return v;
  const s = asText(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function parseJSON(v, fallback) {
  if (v == null) return fallback;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function parseISODateOnly(v) {
  const s = asText(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateLabel(dateISO) {
  const d = parseISODateOnly(dateISO);
  if (!d) return dateISO;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureUploadDir() {
  try {
    fs.mkdirSync(LAB_UPLOAD_DIR, { recursive: true });
  } catch (_) {
    LAB_UPLOAD_DIR = path.join(os.tmpdir(), "godavaii-lab-bookings");
    fs.mkdirSync(LAB_UPLOAD_DIR, { recursive: true });
  }
}

async function ensureCatalogSeeded() {
  if (catalogSeeded) return;

  await LabTest.bulkWrite(
    DEFAULT_TESTS.map((test) => ({
      updateOne: {
        filter: { testId: test.testId },
        update: { $setOnInsert: test },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  await LabPackage.bulkWrite(
    DEFAULT_PACKAGES.map((pack) => ({
      updateOne: {
        filter: { packageId: pack.packageId },
        update: { $setOnInsert: pack },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  catalogSeeded = true;
}

function getUserId(req) {
  return req.user?.userId || req.user?._id || "";
}

function mapTest(doc) {
  return {
    id: doc.testId,
    _id: doc._id,
    name: doc.name,
    short: doc.short,
    category: doc.category,
    reportTime: doc.reportTime,
    prep: doc.prep,
    price: doc.price,
    oldPrice: doc.oldPrice,
    homeCollection: !!doc.homeCollection,
    trending: !!doc.trending,
    desc: doc.desc,
    idealFor: doc.idealFor || [],
    badges: doc.badges || [],
    sampleType: doc.sampleType,
    fastingRequired: !!doc.fastingRequired,
    why: doc.why,
    includes: doc.includes || [],
  };
}

function mapPackage(doc) {
  return {
    id: doc.packageId,
    _id: doc._id,
    name: doc.name,
    category: doc.category,
    tests: doc.tests || [],
    reportTime: doc.reportTime,
    price: doc.price,
    oldPrice: doc.oldPrice,
    homeCollection: !!doc.homeCollection,
    tag: doc.tag,
    desc: doc.desc,
  };
}

function mapBooking(doc) {
  return {
    id: doc.bookingId,
    _id: doc._id,
    items: doc.items || [],
    total: doc.total,
    discount: doc.discount,
    whoFor: doc.whoFor,
    profileName: doc.profileName,
    phone: doc.phone,
    address: doc.address,
    landmark: doc.landmark,
    cityArea: doc.cityArea,
    date: doc.date,
    dateLabel: doc.dateLabel,
    slot: doc.slot,
    notes: doc.notes,
    paymentMethod: doc.paymentMethod,
    paymentStatus: doc.paymentStatus,
    transactionId: doc.transactionId,
    paymentRef: doc.paymentRef,
    holdExpiresAt: doc.holdExpiresAt,
    status: doc.status,
    reportEta: doc.reportEta,
    collectionType: doc.collectionType,
    processedBy: doc.processedBy,
    attachedFileName: doc.attachedFileName || null,
    attachedFile: doc.attachedFile || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function buildDateOptions(days = 4) {
  const options = [];
  const lim = Math.min(Math.max(Number(days) || 4, 1), 30);
  for (let i = 0; i < lim; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    options.push({
      iso,
      day: d.toLocaleDateString("en-IN", { weekday: "short" }),
      date: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      full: d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }),
    });
  }
  return options;
}

router.get("/catalog", async (req, res) => {
  try {
    await ensureCatalogSeeded();

    const q = asText(req.query.q).toLowerCase();
    const category = asText(req.query.category || "All");
    const homeOnly = asBool(req.query.homeCollection);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const testFilter = { active: true };
    if (homeOnly) testFilter.homeCollection = true;
    if (category && category !== "All" && category !== "Popular") testFilter.category = category;
    if (category === "Popular") testFilter.trending = true;
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      testFilter.$or = [{ name: re }, { short: re }, { desc: re }, { idealFor: re }, { category: re }];
    }

    const packFilter = { active: true };
    if (homeOnly) packFilter.homeCollection = true;
    if (category && category !== "All" && category !== "Popular") packFilter.category = category;
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      packFilter.$or = [{ name: re }, { desc: re }, { tests: re }, { category: re }, { tag: re }];
    }

    const [tests, packages] = await Promise.all([
      LabTest.find(testFilter).sort({ trending: -1, price: 1, createdAt: -1 }).limit(limit).lean(),
      LabPackage.find(packFilter).sort({ price: 1, createdAt: -1 }).limit(limit).lean(),
    ]);

    res.json({
      tests: tests.map(mapTest),
      packages: packages.map(mapPackage),
      slotWindows: SLOT_WINDOWS,
      dateOptions: buildDateOptions(4),
    });
  } catch (err) {
    console.error("GET /labs/catalog error:", err?.message || err);
    res.status(500).json({ error: "Failed to load lab catalog" });
  }
});

router.get("/tests", async (req, res) => {
  try {
    await ensureCatalogSeeded();
    const q = asText(req.query.q);
    const category = asText(req.query.category || "All");
    const homeOnly = asBool(req.query.homeCollection);
    const filter = { active: true };
    if (homeOnly) filter.homeCollection = true;
    if (category && category !== "All" && category !== "Popular") filter.category = category;
    if (category === "Popular") filter.trending = true;
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: re }, { short: re }, { desc: re }, { idealFor: re }, { category: re }];
    }
    const tests = await LabTest.find(filter).sort({ trending: -1, price: 1, createdAt: -1 }).lean();
    res.json({ tests: tests.map(mapTest) });
  } catch (err) {
    console.error("GET /labs/tests error:", err?.message || err);
    res.status(500).json({ error: "Failed to load tests" });
  }
});

router.get("/packages", async (req, res) => {
  try {
    await ensureCatalogSeeded();
    const q = asText(req.query.q);
    const category = asText(req.query.category || "All");
    const homeOnly = asBool(req.query.homeCollection);
    const filter = { active: true };
    if (homeOnly) filter.homeCollection = true;
    if (category && category !== "All" && category !== "Popular") filter.category = category;
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: re }, { desc: re }, { tests: re }, { category: re }, { tag: re }];
    }
    const packages = await LabPackage.find(filter).sort({ price: 1, createdAt: -1 }).lean();
    res.json({ packages: packages.map(mapPackage) });
  } catch (err) {
    console.error("GET /labs/packages error:", err?.message || err);
    res.status(500).json({ error: "Failed to load packages" });
  }
});

router.get("/autocomplete", async (req, res) => {
  try {
    await ensureCatalogSeeded();
    const q = asText(req.query.q);
    if (!q) return res.json([]);
    const re = new RegExp(escapeRegex(q), "i");
    const [tests, packs] = await Promise.all([
      LabTest.find({ active: true, $or: [{ name: re }, { short: re }, { category: re }, { idealFor: re }] })
        .select("name short")
        .limit(10)
        .lean(),
      LabPackage.find({ active: true, $or: [{ name: re }, { category: re }, { tests: re }] })
        .select("name")
        .limit(10)
        .lean(),
    ]);

    const merged = [
      ...tests.flatMap((t) => [t.name, t.short].filter(Boolean)),
      ...packs.map((p) => p.name),
    ];
    const deduped = [...new Set(merged.map((x) => asText(x)).filter(Boolean))].slice(0, 10);
    return res.json(deduped);
  } catch (err) {
    console.error("GET /labs/autocomplete error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load suggestions" });
  }
});

router.get("/slots", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 4, 1), 30);
    return res.json({ dateOptions: buildDateOptions(days), slotWindows: SLOT_WINDOWS });
  } catch (err) {
    console.error("GET /labs/slots error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load slot windows" });
  }
});

async function resolveBookingItems(body) {
  const directItems = parseJSON(body.items, []);
  if (Array.isArray(directItems) && directItems.length) {
    return directItems
      .map((row) => ({
        itemId: asText(row.itemId || row.id),
        type: asText(row.type || "test").toLowerCase() === "package" ? "package" : "test",
        name: asText(row.name),
        price: asNumber(row.price, 0),
        reportTime: asText(row.reportTime || "24 hrs"),
      }))
      .filter((row) => row.itemId && row.name);
  }

  await ensureCatalogSeeded();

  const selectedPackageId = asText(body.selectedPackageId || body.packageId || body.selectedPackage);
  if (selectedPackageId) {
    const packFilter = { active: true, $or: [{ packageId: selectedPackageId }] };
    if (mongoose.Types.ObjectId.isValid(selectedPackageId)) packFilter.$or.push({ _id: selectedPackageId });
    const pack = await LabPackage.findOne(packFilter).lean();
    if (!pack) return [];
    return [{ itemId: pack.packageId, type: "package", name: pack.name, price: Number(pack.price || 0), reportTime: pack.reportTime || "24 hrs" }];
  }

  const selectedTestsRaw = parseJSON(body.selectedTests || body.testIds || body.selectedTestIds, []);
  const selectedTests = Array.isArray(selectedTestsRaw) ? selectedTestsRaw.map((x) => asText(x)).filter(Boolean) : [];
  if (!selectedTests.length) return [];

  const objectIds = selectedTests.filter((x) => mongoose.Types.ObjectId.isValid(x));
  const tests = await LabTest.find({
    active: true,
    $or: [{ testId: { $in: selectedTests } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])],
  }).lean();

  const byId = new Map(tests.map((t) => [t.testId, t]));
  const byMongoId = new Map(tests.map((t) => [String(t._id), t]));

  return selectedTests
    .map((id) => byId.get(id) || byMongoId.get(id))
    .filter(Boolean)
    .map((test) => ({
      itemId: test.testId,
      type: "test",
      name: test.name,
      price: Number(test.price || 0),
      reportTime: test.reportTime || "24 hrs",
    }));
}

async function calculateDiscount(items) {
  if (!Array.isArray(items) || !items.length) return 0;

  const packageIds = items.filter((i) => i.type === "package").map((i) => i.itemId);
  if (packageIds.length) {
    const packs = await LabPackage.find({ packageId: { $in: packageIds }, active: true }).select("packageId oldPrice price").lean();
    const map = new Map(packs.map((p) => [p.packageId, Math.max(0, Number(p.oldPrice || 0) - Number(p.price || 0))]));
    return packageIds.reduce((sum, id) => sum + Number(map.get(id) || 0), 0);
  }

  const testIds = items.filter((i) => i.type === "test").map((i) => i.itemId);
  if (!testIds.length) return 0;
  const tests = await LabTest.find({ testId: { $in: testIds }, active: true }).select("testId oldPrice price").lean();
  const map = new Map(tests.map((t) => [t.testId, Math.max(0, Number(t.oldPrice || 0) - Number(t.price || 0))]));
  return testIds.reduce((sum, id) => sum + Number(map.get(id) || 0), 0);
}

router.post("/bookings/create", auth, upload.single("file"), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ error: "Invalid user token" });
    }

    const items = await resolveBookingItems(req.body || {});
    if (!items.length) return res.status(400).json({ error: "At least one test or package is required" });

    const date = asText(req.body?.date);
    const slot = asText(req.body?.slot);
    const phone = asText(req.body?.phone);
    const address = asText(req.body?.address);
    if (!parseISODateOnly(date)) return res.status(400).json({ error: "Valid date is required (YYYY-MM-DD)" });
    if (!slot) return res.status(400).json({ error: "slot is required" });
    if (!phone) return res.status(400).json({ error: "phone is required" });
    if (!address) return res.status(400).json({ error: "address is required" });

    const whoFor = asText(req.body?.whoFor || "self").toLowerCase();
    const paymentMethod = asText(req.body?.paymentMethod).toLowerCase();
    if (paymentMethod && !["upi", "card", "netbanking", "cash"].includes(paymentMethod)) {
      return res.status(400).json({ error: "paymentMethod must be upi/card/netbanking/cash" });
    }

    const total = items.reduce((sum, row) => sum + Number(row.price || 0), 0);
    const discount = await calculateDiscount(items);
    const reportEta = [...new Set(items.map((x) => asText(x.reportTime)).filter(Boolean))].join(", ") || "24 hrs";

    let attachedFile = null;
    if (req.file) {
      ensureUploadDir();
      const safeName = path.basename(req.file.originalname || "lab-file.bin").replace(/[^\w.\-]/g, "_");
      const fileKey = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeName}`;
      const abs = path.join(LAB_UPLOAD_DIR, fileKey);
      await fs.promises.writeFile(abs, req.file.buffer);
      attachedFile = {
        fileName: req.file.originalname || safeName,
        mimeType: req.file.mimetype || "",
        fileSize: Number(req.file.size || 0),
        fileKey,
        fileUrl: `/uploads/lab-bookings/${fileKey}`,
      };
    }

    const confirmNow = asBool(req.body?.confirmNow) || asText(req.body?.paymentStatus).toLowerCase() === "paid";
    const paymentRef = `LAB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const booking = await LabBooking.create({
      bookingId: `lab-${Date.now()}`,
      userId,
      items,
      total,
      discount,
      whoFor: ["self", "family", "new"].includes(whoFor) ? whoFor : "self",
      profileName: asText(req.body?.profileName) || (whoFor === "self" ? "Self" : "Family Member"),
      phone,
      address,
      landmark: asText(req.body?.landmark),
      cityArea: asText(req.body?.cityArea),
      date,
      dateLabel: toDateLabel(date),
      slot,
      notes: asText(req.body?.notes),
      paymentMethod: paymentMethod || "",
      paymentStatus: confirmNow ? "paid" : "pending",
      transactionId: confirmNow ? asText(req.body?.transactionId || `LABTXN-${Date.now()}`) : "",
      paymentRef,
      holdExpiresAt: confirmNow ? null : new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
      status: confirmNow ? "sample_scheduled" : "pending_payment",
      reportEta,
      collectionType: "Home Sample Collection",
      processedBy: asText(req.body?.processedBy) || "GoDavaii Verified Diagnostic Partner",
      attachedFileName: attachedFile?.fileName || null,
      attachedFile: attachedFile || undefined,
    });

    return res.status(201).json({
      booking: mapBooking(booking),
      paymentIntent: confirmNow
        ? null
        : {
            paymentRef,
            amount: total,
            currency: "INR",
            methods: ["upi", "card", "netbanking"],
            holdExpiresAt: booking.holdExpiresAt,
          },
    });
  } catch (err) {
    console.error("POST /labs/bookings/create error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create lab booking" });
  }
});

router.post("/payments/verify", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ error: "Invalid user token" });
    }

    const bookingId = asText(req.body?.bookingId || req.body?.id);
    const paymentRef = asText(req.body?.paymentRef);
    if (!bookingId && !paymentRef) {
      return res.status(400).json({ error: "bookingId or paymentRef is required" });
    }

    const paymentMethod = asText(req.body?.paymentMethod).toLowerCase();
    if (!["upi", "card", "netbanking", "cash"].includes(paymentMethod)) {
      return res.status(400).json({ error: "paymentMethod is required" });
    }

    const filter = { userId, ...(bookingId ? { bookingId } : { paymentRef }) };
    const booking = await LabBooking.findOne(filter);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (booking.status !== "pending_payment") {
      return res.status(409).json({ error: "Booking is not pending payment" });
    }

    if (booking.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() < Date.now()) {
      booking.status = "failed";
      booking.paymentStatus = "failed";
      await booking.save();
      return res.status(409).json({ error: "Payment window expired" });
    }

    booking.paymentMethod = paymentMethod;
    booking.paymentStatus = "paid";
    booking.transactionId = asText(req.body?.transactionId || `LABTXN-${Date.now()}`);
    booking.status = "sample_scheduled";
    booking.holdExpiresAt = null;
    await booking.save();

    return res.json({ booking: mapBooking(booking) });
  } catch (err) {
    console.error("POST /labs/payments/verify error:", err?.message || err);
    return res.status(500).json({ error: "Failed to verify payment" });
  }
});

router.get("/bookings/my", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ error: "Invalid user token" });
    }

    const status = asText(req.query.status || "all").toLowerCase();
    const q = { userId };
    if (status !== "all") q.status = status;

    const rows = await LabBooking.find(q).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ bookings: rows.map(mapBooking) });
  } catch (err) {
    console.error("GET /labs/bookings/my error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load bookings" });
  }
});

router.get("/bookings/:id", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ error: "Invalid user token" });
    }

    const id = asText(req.params.id);
    const byMongoId = mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : [];
    const booking = await LabBooking.findOne({ userId, $or: [{ bookingId: id }, ...byMongoId] }).lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    return res.json({ booking: mapBooking(booking) });
  } catch (err) {
    console.error("GET /labs/bookings/:id error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load booking" });
  }
});

router.patch("/bookings/:id/cancel", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ error: "Invalid user token" });
    }

    const id = asText(req.params.id);
    const byMongoId = mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : [];
    const booking = await LabBooking.findOne({ userId, $or: [{ bookingId: id }, ...byMongoId] });
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (["completed", "cancelled", "report_ready"].includes(booking.status)) {
      return res.status(409).json({ error: "Booking cannot be cancelled in current state" });
    }

    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    booking.cancelReason = asText(req.body?.reason || "Cancelled by user");
    if (booking.paymentStatus === "paid") booking.paymentStatus = "refunded";
    await booking.save();

    return res.json({ booking: mapBooking(booking) });
  } catch (err) {
    console.error("PATCH /labs/bookings/:id/cancel error:", err?.message || err);
    return res.status(500).json({ error: "Failed to cancel booking" });
  }
});

module.exports = router;
