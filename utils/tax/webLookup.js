// utils/tax/webLookup.js
// Google CSE → fetch HTML → extract HSN/GST → consensus with domain weighting.

const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");

// ---- ENV ----
const ENABLE_WEB      = process.env.TAX_WEBSEARCH_ENABLE !== "0"; // default ON
const STRICT_GOV_ONLY = process.env.TAX_WEB_STRICT_GOV === "1";   // accept only *.gov.in
const FETCH_PAGES     = process.env.TAX_WEB_FETCH_PAGES !== "0";  // default ON
const TIMEOUT_MS      = Number(process.env.TAX_WEB_TIMEOUT_MS || 4500);
const MAX_RESULTS     = Number(process.env.TAX_WEB_MAX_RESULTS || 10);

const GOOGLE_CSE_KEY  = process.env.GOOGLE_CSE_KEY;
const GOOGLE_CSE_ID   = process.env.GOOGLE_CSE_ID;

// ---- Helpers ----
const ALLOWED_RATES = new Set([0,5,12,18,28]);

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function isGov(h) { return /\.gov\.in$/i.test(h) || /(cbic|gst)\.gov\.in$/i.test(h); }

function domainWeight(h) {
  if (!h) return 0.2;
  if (isGov(h)) return 1.0;
  if (/janaushadhi\.gov\.in/i.test(h)) return 0.9;
  if (/(drugtoday|cdsco|ipc\.gov\.in)/i.test(h)) return 0.8;
  if (/(1mg|pharmeasy|netmeds|apollo|medplus)\./i.test(h)) return 0.55; // retail, lower trust
  return 0.4;
}

function normHSN(raw) {
  const s = String(raw || "").replace(/\D+/g, "");
  if (s.length < 4) return null;
  return s.slice(0, 8);
}
function normRate(raw) {
  const n = Number(String(raw || "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || !ALLOWED_RATES.has(n)) return null;
  return n;
}
function pick(regex, text) {
  const m = regex.exec(text || "");
  return m ? (m[1] || m[2]) : null;
}

// Extract from title/snippet blob
function extractFromSnippet(title, snippet) {
  const blob = `${title} — ${snippet}`;
  const hsn = normHSN(pick(/\bHSN(?:\s*code)?\s*[:\-]?\s*([0-9]{4,8})\b/i, blob));
  const rate = normRate(pick(/\b(?:GST|IGST|CGST|SGST|tax)\s*(?:rate)?\s*[:\-]?\s*([0-9]{1,2}(?:\.\d+)?)\s?%/i, blob));
  return { hsn, gstRate: rate };
}

// Parse HTML for tables / labels like HSN, GST, Rate
function extractFromHtml(html) {
  if (!html) return { hsn: null, gstRate: null };
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");

  let hsn  = normHSN(pick(/\bHSN(?:\s*code)?\s*[:\-]?\s*([0-9]{4,8})\b/i, text));
  let rate = normRate(pick(/\b(?:GST|IGST|CGST|SGST|tax)\s*(?:rate)?\s*[:\-]?\s*([0-9]{1,2}(?:\.\d+)?)\s?%/i, text));

  if ((!hsn || rate == null) && $("table").length) {
    $("table").each((_i, tbl) => {
      const t = $(tbl).text().replace(/\s+/g, " ");
      if (!hsn)    hsn  = normHSN(pick(/\bHSN(?:\s*code)?\s*[:\-]?\s*([0-9]{4,8})\b/i, t));
      if (rate==null) rate = normRate(pick(/\b(?:GST|IGST|CGST|SGST|tax)\s*(?:rate)?\s*[:\-]?\s*([0-9]{1,2}(?:\.\d+)?)\s?%/i, t));
    });
  }
  return { hsn, gstRate: rate };
}

function consensus(cands) {
  const key = (h, r) => `${h||"?"}|${r??"?"}`;
  const buckets = new Map();
  for (const c of cands) {
    const k = key(c.hsn, c.gstRate);
    const prev = buckets.get(k) || { weight: 0, hits: 0, any: c };
    const boostSrc = c.from === "html" ? 1.15 : 1.0; // html parse > snippet
    prev.weight += (c.domainWeight || 0.4) * boostSrc;
    prev.hits += 1;
    buckets.set(k, prev);
  }
  let best = null;
  for (const [k, v] of buckets) {
    if (!best || v.weight > best.weight) { best = v; }
  }
  if (!best) return null;

  const [hsn, rateStr] = (best.any.hsn || "?") + "|" + (best.any.gstRate ?? "?");
  const hsnOut = best.any.hsn || null;
  const rateOut = best.any.gstRate ?? null;

  const govBonus  = cands.some(c => c.isGov) ? 0.15 : 0.0;
  const bothBonus = (hsnOut && rateOut != null) ? 0.15 : 0.0;
  const hitsBonus = Math.min(0.15, (best.hits - 1) * 0.05);
  let conf = Math.max(0, Math.min(1, (best.weight / 3) + govBonus + bothBonus + hitsBonus));

  return { hsn: hsnOut, gstRate: rateOut, confidence: conf, any: best.any };
}

// ---- Google CSE ----
async function google(q) {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_ID) return [];
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_CSE_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(q)}`;
  try {
    const { data } = await axios.get(url, { timeout: TIMEOUT_MS });
    const arr = data.items || [];
    return arr.slice(0, MAX_RESULTS).map(v => ({ url: v.link, title: v.title, snippet: v.snippet }));
  } catch {
    return [];
  }
}

async function fetchHtml(u) {
  try {
    const { data, headers } = await axios.get(u, {
      timeout: TIMEOUT_MS,
      maxContentLength: 512 * 1024,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GodavaiiBot/1.0)" }
    });
    const ct = String(headers["content-type"] || "");
    if (!/text\/html|application\/xhtml\+xml/i.test(ct)) return null;
    return String(data);
  } catch {
    return null;
  }
}

function queryList(name) {
  return [
    `${name} HSN code GST rate site:gov.in`,
    `${name} HSN code site:gov.in`,
    `${name} GST rate site:gov.in`,
    `${name} HSN code GST rate`,
  ];
}

// ---- MAIN ----
async function webLookup(name) {
  if (!ENABLE_WEB) return null;

  const queries = queryList(name);
  const candidates = [];

  for (const q of queries) {
    const results = await google(q);

    for (const r of results) {
      const h = host(r.url);
      if (STRICT_GOV_ONLY && !isGov(h)) continue;

      // quick from snippet/title
      const sn = extractFromSnippet(r.title || "", r.snippet || "");
      if (sn.hsn || sn.gstRate != null) {
        candidates.push({
          ...sn, url: r.url, title: r.title, snippet: r.snippet,
          domain: h, domainWeight: domainWeight(h), isGov: isGov(h), from: "snippet"
        });
      }

      // fetch & parse HTML (stronger)
      if (FETCH_PAGES) {
        const html = await fetchHtml(r.url);
        if (html) {
          const ex = extractFromHtml(html);
          if (ex.hsn || ex.gstRate != null) {
            candidates.push({
              ...ex, url: r.url, title: r.title, snippet: r.snippet,
              domain: h, domainWeight: domainWeight(h), isGov: isGov(h), from: "html"
            });
          }
        }
      }
    }

    if (candidates.filter(c => c.isGov).length >= 3) break;
  }

  if (!candidates.length) return null;
  const best = consensus(candidates);
  if (!best) return null;

  candidates.sort((a,b) =>
    (Number(b.isGov)-Number(a.isGov)) ||
    ((b.from==="html") - (a.from==="html")) ||
    (b.domainWeight - a.domainWeight)
  );
  const ev = candidates[0];

  return {
    hsn: best.hsn,
    gstRate: best.gstRate,
    confidence: best.confidence,
    source: `web:${ev.domain}`,
    evidence: { url: ev.url, title: ev.title, snippet: ev.snippet }
  };
}

module.exports = { webLookup };
