// routes/ocrJobs.js
const express = require("express");
const { extractPrescriptionItems } = require("../utils/ocr");
const router = express.Router();

// simple in-memory job store (OK for a single dyno)
const JOBS = new Map(); // id -> { status, result, error, startedAt }

function makeId() { return Math.random().toString(36).slice(2, 10); }

// POST /ocr/start  { url: "https://..." }  -> { jobId }
router.post("/start", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!url) return res.status(400).json({ ok: false, error: "url required" });

  const id = makeId();
  JOBS.set(id, { status: "running", startedAt: Date.now() });

  // run in background
  setImmediate(async () => {
    try {
      const result = await extractPrescriptionItems(url);
      JOBS.set(id, { status: "done", result, startedAt: JOBS.get(id)?.startedAt });
    } catch (e) {
      JOBS.set(id, { status: "error", error: e.message, startedAt: JOBS.get(id)?.startedAt });
    }
    // auto-expire after 15 minutes
    setTimeout(() => JOBS.delete(id), 15 * 60 * 1000).unref();
  });

  res.json({ ok: true, jobId: id });
});

// GET /ocr/status/:id  -> { status, result? }
router.get("/status/:id", (req, res) => {
  const j = JOBS.get(String(req.params.id || ""));
  if (!j) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, ...j });
});

module.exports = router;
