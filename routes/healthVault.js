const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const multer = require("multer");
const auth = require("../middleware/auth");
const HealthVault = require("../models/HealthVault");
const User = require("../models/User");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const BASE_UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
let REPORTS_DIR = path.join(BASE_UPLOADS_DIR, "health-vault");
let REPORTS_PUBLIC_PREFIX = "/uploads/health-vault";

function ensureReportsDir() {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  } catch (_) {
    REPORTS_DIR = path.join(os.tmpdir(), "godavaii-health-vault");
    REPORTS_PUBLIC_PREFIX = "";
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function nowId() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function safeText(v) {
  return String(v == null ? "" : v).trim();
}

function normalizeMember(input = {}) {
  return {
    id: safeText(input.id) || nowId(),
    relation: safeText(input.relation) || "Family",
    profile: {
      name: safeText(input?.profile?.name),
      dob: safeText(input?.profile?.dob),
      gender: safeText(input?.profile?.gender),
      bloodGroup: safeText(input?.profile?.bloodGroup),
      heightCm: safeText(input?.profile?.heightCm),
      weightKg: safeText(input?.profile?.weightKg),
    },
    emergency: {
      name: safeText(input?.emergency?.name),
      relation: safeText(input?.emergency?.relation),
      phone: safeText(input?.emergency?.phone),
    },
    conditions: Array.isArray(input.conditions) ? input.conditions.map(safeText).filter(Boolean) : [],
    allergies: Array.isArray(input.allergies) ? input.allergies.map(safeText).filter(Boolean) : [],
    medications: Array.isArray(input.medications)
      ? input.medications.map((m) => ({
        id: safeText(m?.id) || nowId(),
        name: safeText(m?.name),
        dose: safeText(m?.dose),
        timing: safeText(m?.timing),
      }))
      : [],
    reports: Array.isArray(input.reports)
      ? input.reports.map((r) => ({
        id: safeText(r?.id) || nowId(),
        title: safeText(r?.title),
        type: safeText(r?.type),
        date: safeText(r?.date),
        category: safeText(r?.category) || "Lab Report",
        fileName: safeText(r?.fileName),
        mimeType: safeText(r?.mimeType),
        fileSize: Number(r?.fileSize) || 0,
        fileUrl: safeText(r?.fileUrl),
        fileKey: safeText(r?.fileKey),
      }))
      : [],
    notes: safeText(input.notes),
  };
}

function buildDefaultVaultForUser(user) {
  const self = normalizeMember({
    relation: "Self",
    profile: {
      name: user?.name || "",
      dob: user?.dob || "",
      gender: user?.gender || "",
    },
  });
  return {
    members: [self],
    activeMemberId: self.id,
  };
}

async function getOrCreateVault(userId) {
  let vault = await HealthVault.findOne({ userId });
  if (vault) return vault;
  const user = await User.findById(userId).select("name dob gender").lean();
  const base = buildDefaultVaultForUser(user);
  vault = await HealthVault.create({ userId, ...base });
  return vault;
}

function publicUrlForReport(fileName) {
  ensureReportsDir();
  if (REPORTS_PUBLIC_PREFIX) return `${REPORTS_PUBLIC_PREFIX}/${fileName}`;
  return path.join(REPORTS_DIR, fileName);
}

function findMember(vault, memberId) {
  const idx = vault.members.findIndex((m) => m.id === memberId);
  if (idx < 0) return null;
  return { idx, member: vault.members[idx] };
}

router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const vault = await getOrCreateVault(userId);
    res.json({
      members: vault.members || [],
      activeMemberId: vault.activeMemberId || vault.members?.[0]?.id || "",
    });
  } catch (err) {
    console.error("GET /health-vault/me error:", err?.message || err);
    res.status(500).json({ error: "Failed to load health vault" });
  }
});

router.put("/me", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};
    const members = Array.isArray(body.members) ? body.members.map(normalizeMember) : [];
    if (!members.length) {
      return res.status(400).json({ error: "At least one member is required" });
    }

    let activeMemberId = safeText(body.activeMemberId);
    if (!members.some((m) => m.id === activeMemberId)) {
      activeMemberId = members[0].id;
    }

    const vault = await HealthVault.findOneAndUpdate(
      { userId },
      { $set: { members, activeMemberId } },
      { upsert: true, new: true }
    );

    res.json({
      members: vault.members || [],
      activeMemberId: vault.activeMemberId,
      updatedAt: vault.updatedAt,
    });
  } catch (err) {
    console.error("PUT /health-vault/me error:", err?.message || err);
    res.status(500).json({ error: "Failed to save health vault" });
  }
});

router.post("/me/members/:memberId/reports/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const userId = req.user.userId;
    const memberId = safeText(req.params.memberId);
    if (!req.file) return res.status(400).json({ error: "file is required" });

    const vault = await getOrCreateVault(userId);
    const found = findMember(vault, memberId);
    if (!found) return res.status(404).json({ error: "Member not found" });

    ensureReportsDir();
    const safeBase = path.basename(req.file.originalname || "report.bin").replace(/[^\w.\-]/g, "_");
    const key = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeBase}`;
    const abs = path.join(REPORTS_DIR, key);
    await fs.promises.writeFile(abs, req.file.buffer);

    const report = {
      id: nowId(),
      title: safeText(req.body?.title) || safeBase,
      type: safeText(req.body?.type),
      date: safeText(req.body?.date),
      category: safeText(req.body?.category) || "Lab Report",
      fileName: req.file.originalname || safeBase,
      mimeType: req.file.mimetype || "",
      fileSize: req.file.size || 0,
      fileUrl: publicUrlForReport(key),
      fileKey: key,
    };

    vault.members[found.idx].reports.push(report);
    await vault.save();

    res.status(201).json({ report });
  } catch (err) {
    console.error("POST /health-vault/me/members/:memberId/reports/upload error:", err?.message || err);
    res.status(500).json({ error: "Failed to upload report" });
  }
});

router.delete("/me/members/:memberId/reports/:reportId", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const memberId = safeText(req.params.memberId);
    const reportId = safeText(req.params.reportId);

    const vault = await getOrCreateVault(userId);
    const found = findMember(vault, memberId);
    if (!found) return res.status(404).json({ error: "Member not found" });

    const reports = found.member.reports || [];
    const idx = reports.findIndex((r) => r.id === reportId);
    if (idx < 0) return res.status(404).json({ error: "Report not found" });

    const target = reports[idx];
    if (target?.fileKey) {
      const abs = path.join(REPORTS_DIR, target.fileKey);
      fs.promises.unlink(abs).catch(() => {});
    }
    reports.splice(idx, 1);
    vault.markModified("members");
    await vault.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /health-vault report error:", err?.message || err);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

module.exports = router;
