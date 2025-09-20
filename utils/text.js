// server/utils/text.js
function stripDiacritics(s = "") {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
function toNameKey(s = "") {
  const x = stripDiacritics(String(s).trim()).replace(/\s+/g, " ");
  return x.toUpperCase();
}
function escapeRegex(s = "") {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Very light, safe parsing (best-effort)
function parseTypeStrengthPack(s = "") {
  const txt = String(s || "").toLowerCase();

  const typeMatch = txt.match(
    /\b(tablet|tab|capsule|cap|syrup|suspension|injection|drops?|ointment|cream|gel|lotion|spray|solution)\b/i
  );
  const typeMap = { tab: "Tablet", cap: "Capsule", drops: "Drops", drop: "Drops" };
  const type = typeMatch ? (typeMap[typeMatch[1].toLowerCase()] || capitalize(typeMatch[1])) : undefined;

  const strengthMatch = txt.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|%|iu)/i);
  const strength = strengthMatch ? `${strengthMatch[1]} ${strengthMatch[2].toLowerCase()}` : undefined;

  const packMatch = txt.match(/(\d+)\s*(tablets|capsules|ml|g|units|sachets|drops)\b/i);
  const packLabel = packMatch ? `${packMatch[1]} ${packMatch[2].toLowerCase()}` : undefined;

  return { type, strength, packLabel };
}
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

module.exports = {
  toNameKey,
  escapeRegex,
  parseTypeStrengthPack,
};
