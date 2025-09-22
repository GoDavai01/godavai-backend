// utils/buildCompositionKey.js
module.exports = function buildCompositionKey(raw = "") {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9+.%/ ]+/g, " ")
    .replace(/\b(ip|bp|usp|sr|er|mr|od)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return "";

  const parts = s
    .split("+")
    .map((p) =>
      p
        .trim()
        .replace(/\s*mg\b/g, "mg")
        .replace(/\s*ml\b/g, "ml")
        .replace(/\s*g\b/g, "g")
        .replace(/\s*mcg\b/g, "mcg")
        .replace(/\s+/, " ")
        .trim()
    )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return parts.join(" + ");
};
