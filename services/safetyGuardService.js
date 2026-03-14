// services/safetyGuardService.js — GoDavaii 2035 Enhanced Safety Guard
// ✅ Comprehensive red flag patterns
// ✅ Indian emergency context (112, 108 ambulance)
// ✅ Mental health crisis detection
// ✅ Pediatric emergency patterns
// ✅ Pregnancy emergency patterns

const RED_FLAG_PATTERNS = [
  // Cardiac
  { key: "chest pain / possible cardiac event — call 112 or go to nearest ER immediately", re: /\b(chest pain|severe chest tightness|heart attack|dil ka daura)\b/i },
  // Respiratory
  { key: "severe breathing difficulty — seek emergency care immediately", re: /\b(shortness of breath|breathing difficulty|cannot breathe|saans nahi aa rahi|saans phool rahi)\b/i },
  // Neurological
  { key: "stroke warning signs — call 112 immediately (FAST: Face, Arms, Speech, Time)", re: /\b(face droop|slurred speech|one side weakness|stroke|lakwa|paralysis)\b/i },
  { key: "seizure/convulsion — keep patient safe, call emergency", re: /\b(seizure|convulsion|fits|mirgi|epilepsy attack)\b/i },
  { key: "loss of consciousness — call 112 or 108 ambulance", re: /\b(unconscious|not responding|fainting repeatedly|behosh)\b/i },
  // Bleeding
  { key: "severe/uncontrolled bleeding — apply pressure, call emergency", re: /\b(heavy bleeding|severe bleeding|blood loss|khoon band nahi ho raha)\b/i },
  // Fever
  { key: "dangerously high fever — go to ER if not responding to paracetamol", re: /\b(fever\s*(above|over|>|>=)?\s*10[3-6]|104|105)\b/i },
  // Mental health
  { key: "mental health crisis — please reach out: Vandrevala Foundation 1860-2662-345 (24/7), iCall 9152987821", re: /\b(suicidal|self harm|kill myself|marna chahta|marna chahti|zindagi khatam|life end)\b/i },
  // Allergic reaction
  { key: "severe allergic reaction (anaphylaxis) — go to ER immediately", re: /\b(throat swelling|face swelling|cannot swallow|anaphylaxis|severe allergy|poora body pe rash)\b/i },
  // Pediatric emergencies
  { key: "child emergency — seek immediate pediatric care", re: /\b(baby not breathing|infant not feeding|child convulsion|baccha behosh|newborn fever)\b/i },
  // Pregnancy emergencies
  { key: "pregnancy emergency — go to hospital immediately", re: /\b(pregnancy bleeding|vaginal bleeding pregnant|water broke|labor pain|premature labor|placenta)\b/i },
  // Poisoning
  { key: "poisoning suspected — call Poison Control or go to ER immediately", re: /\b(poison|poisoning|zeher|chemical ingested|bleach drink|medicine overdose|overdose)\b/i },
  // Severe pain
  { key: "severe abdominal pain — may need emergency evaluation", re: /\b(severe abdominal|extreme stomach pain|appendicitis|pet me bahut tez dard)\b/i },
  // Trauma
  { key: "severe injury/trauma — call 108 ambulance or go to ER", re: /\b(severe accident|head injury|fracture|bone broken|haddi toot|road accident|fall from height)\b/i },
  // Diabetic emergency
  { key: "diabetic emergency — check sugar level, seek care if very high/low", re: /\b(sugar very high|sugar very low|diabetic coma|sugar 400|sugar 500|hypoglycemia severe)\b/i },
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
  const hasWarning = /(^|\n)\s*(Warning signs|Red flags|When to see doctor)\s*:/i.test(text);

  // If it has assessment + next steps + any warning section, it's structured enough
  if (hasAssessment && hasNextSteps && hasWarning) {
    return text;
  }

  // If it looks like a casual reply (no sections at all), don't force structure
  if (!hasAssessment && !hasNextSteps && !hasWarning) {
    const isCasual = text.length < 300 && !/\b(symptom|medicine|report|prescription|fever|pain|dard)\b/i.test(text);
    if (isCasual) return text;
  }

  // Force structure for medical content
  const assessment = hasAssessment ? "" : `Assessment:\n${text}\n\n`;
  const nextSteps = hasNextSteps
    ? ""
    : "Next steps:\n- Share specific symptoms, duration, severity for better guidance.\n- Monitor your condition and track any changes.\n\n";

  const redFlagLine = redFlags.length
    ? `Warning signs:\n${redFlags.map((x) => `- ${x}`).join("\n")}`
    : "Warning signs:\n- Go to ER immediately: severe chest pain, breathing trouble, confusion, seizures, heavy bleeding.\n- Call 112 (India emergency) or 108 (ambulance) for life-threatening situations.\n- See doctor within 1-2 days if symptoms persist or worsen.";

  if (hasAssessment && hasNextSteps) {
    return `${text}\n\n${redFlagLine}`;
  }

  return `${assessment}${text ? "" : "Need more details for assessment.\n\n"}${nextSteps}${redFlagLine}`;
}

module.exports = {
  detectRedFlags,
  ensureStructuredSections,
};