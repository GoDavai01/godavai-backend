const RED_FLAG_PATTERNS = [
  { key: "chest pain", re: /\b(chest pain|severe chest tightness)\b/i },
  { key: "breathing issue", re: /\b(shortness of breath|breathing difficulty|cannot breathe)\b/i },
  { key: "stroke signs", re: /\b(face droop|slurred speech|one side weakness|stroke)\b/i },
  { key: "seizure", re: /\b(seizure|convulsion|fits)\b/i },
  { key: "unconsciousness", re: /\b(unconscious|not responding|fainting repeatedly)\b/i },
  { key: "severe bleeding", re: /\b(heavy bleeding|severe bleeding|blood loss)\b/i },
  { key: "very high fever", re: /\b(fever\s*(above|over|>|>=)?\s*103|104)\b/i },
  { key: "suicidal intent", re: /\b(suicidal|self harm|kill myself)\b/i },
];

function detectRedFlags(text) {
  const src = String(text || "");
  const out = [];
  for (const rule of RED_FLAG_PATTERNS) {
    if (rule.re.test(src)) out.push(rule.key);
  }
  return out;
}

function ensureStructuredSections(reply, opts = {}) {
  const text = String(reply || "").trim();
  const redFlags = Array.isArray(opts.redFlags) ? opts.redFlags : [];

  const hasAssessment = /(^|\n)\s*Assessment\s*:/i.test(text);
  const hasNextSteps = /(^|\n)\s*Next steps\s*:/i.test(text);
  const hasRedFlags = /(^|\n)\s*Red flags\s*:/i.test(text);
  const hasDoctor = /(^|\n)\s*When to see doctor\s*:/i.test(text);

  if (hasAssessment && hasNextSteps && hasRedFlags && hasDoctor) {
    return text;
  }

  const assessment = text || "Need more details to provide accurate guidance.";
  const nextSteps =
    "Share age, symptom duration, fever readings, ongoing medicines, and known conditions for better triage.";
  const redFlagLine = redFlags.length
    ? `Possible urgent signals detected: ${redFlags.join(", ")}.`
    : "Go to ER immediately for severe chest pain, trouble breathing, stroke signs, seizures, or heavy bleeding.";
  const doctorLine =
    "Consult a doctor today if symptoms persist, worsen, or if there are high-risk conditions (pregnancy, age >60, chronic disease).";

  return [
    `Assessment: ${assessment}`,
    `Next steps: ${nextSteps}`,
    `Red flags: ${redFlagLine}`,
    `When to see doctor: ${doctorLine}`,
  ].join("\n\n");
}

module.exports = {
  detectRedFlags,
  ensureStructuredSections,
};

