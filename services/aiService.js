// services/aiService.js — GoDavaii 2035 Health OS AI Service
// ✅ FIX: Reply language preference respected
// ✅ FIX: Hindi script medical intent expanded
// ✅ FIX: Hindi script casual greetings expanded
// ✅ FIX: Marathi detection order fixed
// ✅ FIX: No other architecture changes

const AiSession = require("../models/AiSession");
const { buildHealthContext } = require("./healthContextService");
const { detectRedFlags, ensureStructuredSections } = require("./safetyGuardService");

let cachedClient = null;

function getOpenAIClient() {
  if (cachedClient) return cachedClient;
  if (!process.env.OPENAI_API_KEY) return null;

  let OpenAI = require("openai");
  OpenAI = OpenAI?.default || OpenAI;
  cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cachedClient;
}

function clampTemperature(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.55;
  return Math.max(0.35, Math.min(0.7, n));
}

function compactHistory(history, limit = 16) {
  const arr = Array.isArray(history) ? history : [];
  return arr
    .slice(-Math.max(1, Math.min(limit, 20)))
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: String(m?.text || m?.content || "").trim(),
    }))
    .filter((m) => m.content);
}

function inferPromptIntent(text) {
  const src = String(text || "").toLowerCase();

  if (/(report|cbc|lipid|tsh|vitamin|platelet|hba1c|creatinine|hemoglobin|wbc|rbc|uric acid|bilirubin|sgpt|sgot|lab report|blood test|liver function|kidney function|thyroid profile|complete blood)/.test(src)) {
    return "lab";
  }
  if (/(prescription|rx|dose|tablet|capsule|bd|tid|od|syrup|tab\b|cap\b)/.test(src)) {
    return "rx";
  }
  if (/(medicine|drug|dawai|paracetamol|azithromycin|tramadol|amoxicillin|pantoprazole|ibuprofen|cetirizine|metformin|atorvastatin)/.test(src)) {
    return "medicine";
  }
  return "symptom";
}

function hasMedicalIntent(text) {
  const src = String(text || "").toLowerCase();
  return /(
    symptom|bukhar|fever|cold|cough|khansi|pain|dard|headache|migraine|
    vomit|ultee|diarrhea|loose motion|sugar|bp|oxygen|report|lab|xray|x-ray|
    scan|prescription|rx|medicine|dawai|tablet|capsule|hba1c|cbc|cholesterol|
    thyroid|creatinine|hemoglobin|infection|allergy|rash|pimple|acne|skin|
    stomach|gas|acidity|back pain|joint|muscle|weakness|fatigue|thakan|nausea|
    constipation|kabz|weight|mota|patla|hair fall|dandruff|anxiety|tension|
    depression|sleep|neend|insomnia|diabetes|asthma|dama|period|masik dharm|
    pregnancy|baby|bacha|blood pressure|heart|dil|lungs|phephde|kidney|gurda|
    liver|jigar|eyes|aankh|ear|kaan|throat|gala|nose|naak|teeth|daant|bone|haddi|
    बुखार|ताप|दर्द|सर दर्द|खांसी|सर्दी|जुकाम|उल्टी|दस्त|रिपोर्ट|दवाई|इलाज|पिंपल|मुहांसे|
    त्वचा|गला|छाती|पेट|कमजोरी|थकान|एलर्जी|शुगर|बीपी|नींद|मासिक|गर्भ|बच्चा|खून|हड्डी
  )/ix.test(src);
}

function isCasualConversation(text) {
  const src = String(text || "").toLowerCase().trim();
  if (!src) return true;
  if (hasMedicalIntent(src)) return false;
  return /^(hi|hii|hello|hey|yo|namaste|namaskar|kaise ho|kya haal|kya hal|kya scene|how are you|good morning|good evening|good night|thanks|thank you|thx|ok|okay|acha|accha|hmm|hmmm|bro|bhai|sup|what's up|wassup|hola|bye|goodbye|see you|take care|हेलो|नमस्ते|नमस्कार|कैसे हो|क्या हाल|धन्यवाद)\b/i.test(src);
}

/* ── Intelligent Desi Ilaaj — contextual, varied, never repetitive ── */
function shouldIncludeDesiIlaaj({ message, ctx }) {
  const src = String(message || "").toLowerCase();
  if (!src) return false;
  if (/(desi|gharelu|home remedy|nuskh|kadha|ilaaj|ayurved|natural|herbal|इलाज|घरेलू)/.test(src)) return true;
  if (isCasualConversation(src)) return false;
  if (hasMedicalIntent(src)) return true;

  const focus = String(ctx?.focus || "").toLowerCase();
  return ["lab", "rx", "medicine", "xray", "symptom"].includes(focus);
}

function looksLikeFollowupToPreviousFile(message) {
  const src = String(message || "").toLowerCase().trim();
  if (!src) return false;

  return (
    /^(yeh|ye|is|iss|isme|isme kya|isko|iska|iski|ye report|ye prescription|same|continue|continue karo|aur batao|aur samjhao|detail me batao|is hisaab se|according to this|according to report|according to prescription)\b/.test(src) ||
    /\b(iss report|is report|iss prescription|is prescription|iss medicine|is medicine|same report|same prescription|same medicine|uploaded file|previous file|upar wali report|upar wali prescription|report ke hisaab se|prescription ke hisaab se|same file)\b/.test(src)
  );
}

function shouldReuseRecentAttachment({ message, attachment, context, recalledAttachment }) {
  if (attachment) return false;
  if (!recalledAttachment?.text) return false;

  const currentIntent = inferPromptIntent(message);
  const focus = String(context?.focus || "").toLowerCase();
  const followup = looksLikeFollowupToPreviousFile(message);

  if (followup) return true;
  if (isVaultReportAnalysisRequest(message)) return false;
  if (currentIntent === "symptom") return false;
  if (focus === "symptom") return false;

  return ["lab", "rx", "medicine", "xray"].includes(currentIntent) || focus === "xray";
}

function isVaultReportAnalysisRequest(text) {
  const src = String(text || "").toLowerCase();
  return (
    /(health vault|healthvault|vault)/.test(src) &&
    /(latest|recent|last|naya|new|upload|attached|saved)/.test(src) &&
    /(lab report|report|xray|x-ray|scan|test)/.test(src) &&
    /(analy|explain|samjha|interpret)/.test(src)
  );
}

/* ── Language Detection — supports 10+ Indian languages ── */
function detectUserLanguage(text) {
  const src = String(text || "").trim();
  if (!src) return "auto";

  if (/[\u0900-\u097F]/.test(src)) {
    if (/\b(आहे|नाही|काय|कसे|माझे|तुमचे)\b/.test(src)) return "marathi";
    return "hindi";
  }

  if (/[\u0980-\u09FF]/.test(src)) return "bengali";
  if (/[\u0B80-\u0BFF]/.test(src)) return "tamil";
  if (/[\u0C00-\u0C7F]/.test(src)) return "telugu";
  if (/[\u0C80-\u0CFF]/.test(src)) return "kannada";
  if (/[\u0D00-\u0D7F]/.test(src)) return "malayalam";
  if (/[\u0A80-\u0AFF]/.test(src)) return "gujarati";
  if (/[\u0A00-\u0A7F]/.test(src)) return "punjabi";
  if (/[\u0B00-\u0B7F]/.test(src)) return "odia";

  const lower = src.toLowerCase();
  const hasLatin = /[a-z]/.test(lower);
  const hinglishHints = [
    "hai", "kya", "kaise", "mujhe", "mera", "meri", "hum", "aap", "isko", "isse",
    "kar", "karo", "kr", "samjha", "batao", "kyu", "nahi", "acha", "sahi", "bolo",
    "dekho", "suno", "pata", "lagta", "hota", "karun", "chahiye", "abhi", "zaroor",
    "dard", "bukhar", "dawai", "ilaaj", "sehat", "bimari", "theek", "tabiyet",
  ];

  const hintCount = hinglishHints.reduce((n, w) => {
    const re = new RegExp(`\\b${w}\\b`, "i");
    return re.test(lower) ? n + 1 : n;
  }, 0);

  if (hasLatin && hintCount >= 2) return "hinglish";
  return "english";
}

function resolveReplyLanguage(message, context = {}) {
  const pref = String(
    context?.replyLanguagePreference ||
    context?.languagePreference ||
    context?.language ||
    "auto"
  ).toLowerCase();

  if (pref && pref !== "auto") return pref;
  return detectUserLanguage(message);
}

/* ── World-class System Prompt with WHO + Indian Govt Guidelines ── */
function buildSystemPrompt(ctx) {
  const whoLabel = ctx.whoForLabel || (ctx.whoFor === "self" ? "self" : ctx.whoFor);
  const profileBits = [];
  const detectedLang = String(ctx?.detectedLanguage || ctx?.replyLanguage || ctx?.language || "auto").toLowerCase();

  let languageRule = "";
  switch (detectedLang) {
    case "hindi":
      languageRule = "FORCED LANGUAGE: Reply strictly in Hindi (Devanagari script). Do not use English or Roman Hindi.";
      break;
    case "hinglish":
      languageRule = "FORCED LANGUAGE: Reply strictly in Hinglish (Roman Hindi + simple English mix). Do not reply in full English or full Hindi.";
      break;
    case "english":
      languageRule = "FORCED LANGUAGE: Reply strictly in English. Do not mix Hindi words.";
      break;
    case "bengali":
      languageRule = "FORCED LANGUAGE: Reply in Bengali (বাংলা). Use Bengali script. Keep medical terms in English where needed.";
      break;
    case "tamil":
      languageRule = "FORCED LANGUAGE: Reply in Tamil (தமிழ்). Use Tamil script. Keep medical terms in English where needed.";
      break;
    case "telugu":
      languageRule = "FORCED LANGUAGE: Reply in Telugu (తెలుగు). Use Telugu script. Keep medical terms in English where needed.";
      break;
    case "kannada":
      languageRule = "FORCED LANGUAGE: Reply in Kannada (ಕನ್ನಡ). Use Kannada script. Keep medical terms in English where needed.";
      break;
    case "malayalam":
      languageRule = "FORCED LANGUAGE: Reply in Malayalam (മലയാളം). Use Malayalam script. Keep medical terms in English where needed.";
      break;
    case "gujarati":
      languageRule = "FORCED LANGUAGE: Reply in Gujarati (ગુજરાતી). Use Gujarati script. Keep medical terms in English where needed.";
      break;
    case "punjabi":
      languageRule = "FORCED LANGUAGE: Reply in Punjabi. Use Gurmukhi or Roman Punjabi based on user input.";
      break;
    case "marathi":
      languageRule = "FORCED LANGUAGE: Reply in Marathi (मराठी). Use Devanagari script. Keep medical terms in English where needed.";
      break;
    case "odia":
      languageRule = "FORCED LANGUAGE: Reply in Odia (ଓଡ଼ିଆ). Use Odia script. Keep medical terms in English where needed.";
      break;
    default:
      languageRule = "";
  }

  if (ctx.userSummary && Object.keys(ctx.userSummary).length) {
    profileBits.push(`userSummary=${JSON.stringify(ctx.userSummary)}`);
  }
  if (ctx.healthProfile) {
    profileBits.push(`healthProfile=${JSON.stringify(ctx.healthProfile)}`);
  }

  return [
    "You are GoDavaii AI — India's most trusted AI health assistant, equivalent to consulting a senior doctor with 20+ years experience.",
    "Your goal: Give such thorough, caring, and practical guidance that users genuinely feel they spoke to a real doctor — and often don't need to visit one for non-emergency issues.",
    "",
    "═══ IDENTITY & PERSONALITY ═══",
    "- You are NOT a chatbot. You are a senior doctor-friend who happens to know everything.",
    "- Speak like a warm, experienced family physician who truly cares about the patient.",
    "- NEVER sound robotic, templated, or copy-paste. Every response must feel personally crafted.",
    "- Use the patient's name if available. Be empathetic. Acknowledge their worry/pain first.",
    "- NEVER overuse 'consult doctor' — you ARE the consultation. Only mention doctor/ER for genuinely concerning cases.",
    "- Be reassuring when findings are mild. Patients are often anxious — calm them with knowledge.",
    "",
    "═══ LANGUAGE RULE (HIGHEST PRIORITY) ═══",
    "- DETECT the language of the user's CURRENT message and reply in EXACTLY that language.",
    "- If user writes in English → reply fully in English. NO Hindi mixing.",
    "- If user writes in Hindi (Devanagari) → reply fully in Hindi.",
    "- If user writes in Hinglish (Roman Hindi-English mix) → reply in Hinglish.",
    "- If user writes in Bengali/Tamil/Telugu/Kannada/Malayalam/Gujarati/Punjabi/Marathi/Odia → reply in THAT language using its native script. Keep medical terms in English.",
    "- The CURRENT message language wins. Ignore previous messages' language.",
    languageRule ? `- ${languageRule}` : "",
    "",
    `═══ PATIENT CONTEXT ═══`,
    `Audience: ${ctx.whoFor} (${whoLabel}). Focus mode: ${ctx.focus}.`,
    profileBits.length ? `Known data: ${profileBits.join(" | ")}` : "Patient data: limited — ask key details if needed.",
    "",
    "═══ CLINICAL GUIDELINES (WHO + INDIAN GOVERNMENT + ICMR) ═══",
    "Follow these evidence-based standards in ALL responses:",
    "",
    "FEVER MANAGEMENT (WHO/IAP Guidelines):",
    "- Paracetamol: Adults 500-1000mg every 4-6 hrs (max 4g/day). Children: 15mg/kg/dose every 4-6 hrs.",
    "- Ibuprofen: Adults 200-400mg every 6-8 hrs with food. Children: 5-10mg/kg/dose.",
    "- DO NOT recommend aspirin for children under 18 (Reye's syndrome risk).",
    "- Tepid sponging for fever >102°F. NOT cold water baths.",
    "- Dengue suspected: ONLY paracetamol. NO ibuprofen/aspirin (bleeding risk).",
    "",
    "DIARRHEA (WHO/UNICEF Protocol):",
    "- ORS: Full glass after each loose stool. Adults 2-3L/day. Children 50-100ml/kg over 4 hrs.",
    "- Zinc: Children 6mo-5yr: 20mg/day x 10-14 days. Under 6mo: 10mg/day.",
    "- BRAT diet progression. Continue breastfeeding in infants.",
    "- Red flag: >6 stools/day, blood in stool, severe dehydration, no urine 6+ hrs.",
    "",
    "RESPIRATORY (ICMR/WHO):",
    "- Common cold: symptomatic relief only. NO antibiotics.",
    "- Cough >2 weeks: consider TB screening (sputum test, chest X-ray).",
    "- Steam inhalation: warm (not boiling) water. 10 min, 2-3 times/day.",
    "- Honey (>1yr age): 1 tsp before bed for cough. Evidence-backed.",
    "",
    "HYPERTENSION (Indian HTN Guidelines):",
    "- Normal <120/80, Elevated 120-129/<80, Stage 1: 130-139/80-89, Stage 2: ≥140/≥90.",
    "- Lifestyle: DASH diet, reduce salt <5g/day (WHO), 150 min/week exercise.",
    "- Monitor at home: 2 readings/day, same time, sitting position.",
    "",
    "DIABETES (RSSDI/ICMR Guidelines):",
    "- Fasting glucose: Normal <100, Pre-diabetic 100-125, Diabetic ≥126 mg/dL.",
    "- HbA1c: Normal <5.7%, Pre-diabetic 5.7-6.4%, Diabetic ≥6.5%.",
    "- Post-meal (2hr): Normal <140, Pre-diabetic 140-199, Diabetic ≥200 mg/dL.",
    "- Diet: low GI foods, portion control, regular meals. Indian diet specifics: reduce rice portion, add dal/sabzi first.",
    "",
    "SKIN (Indian Dermatology):",
    "- Acne/pimples: Keep clean, don't squeeze, salicylic acid/benzoyl peroxide OTC.",
    "- Fungal: Keep dry, antifungal powder/cream, cotton clothes.",
    "- Eczema: Moisturize heavily, avoid soap, mild steroid cream short-term.",
    "",
    "WOMEN'S HEALTH (FOGSI Guidelines):",
    "- Period pain: Mefenamic acid 250-500mg with food, hot water bottle.",
    "- Irregular periods: Track 3 months, thyroid check, PCOS screen if needed.",
    "- Pregnancy: Folic acid 400mcg from planning, iron supplements from 2nd trimester.",
    "",
    "CHILD HEALTH (IAP Guidelines):",
    "- Always calculate dose by weight, not age.",
    "- Fever: NO aspirin. Paracetamol or ibuprofen only.",
    "- Dehydration: ORS is first line. NOT glucose water or plain water.",
    "- Vaccination: Follow IAP immunization schedule.",
    "",
    "═══ FORMATTING RULES (STRICT) ═══",
    "- Do NOT use markdown: no **, __, #, ##, ###, ```, or code blocks.",
    "- Write section headers as plain text like 'Assessment:' NOT '**Assessment:**' or '### Assessment'.",
    "- Use - (dash) for bullet points. Keep them readable.",
    "- Do NOT invent values, diagnoses, or dosages not visible in provided data.",
    "- If something is unclear, say: 'not clearly visible in the report/prescription'.",
    "",
    "═══ RESPONSE STRUCTURE (ALWAYS follow this exact order) ═══",
    "",
    "Assessment:",
    "- Start with acknowledging the patient's concern warmly (1 line).",
    "- Then 4-8 detailed bullet points covering ALL relevant findings/explanations.",
    "- Be thorough — this should feel like a doctor explaining face-to-face.",
    "- For lab reports: explain EVERY important value (abnormal FIRST, then normal ones briefly).",
    "- For prescriptions: explain each medicine's purpose, dosage, side effects.",
    "- For symptoms: list 2-3 most likely causes ranked by probability.",
    "- If patient info is limited, still give the best possible assessment and mention what additional info would help.",
    "",
    "Next steps:",
    "- 3-6 SPECIFIC, actionable steps. Not generic advice.",
    "- Include: exact OTC medicine names with dosages, diet specifics, lifestyle changes.",
    "- Example: 'Tab Paracetamol 650mg, 1 tablet every 6 hours if fever above 100°F, max 4 tablets/day, take after food'.",
    "- Example: 'Drink 8-10 glasses warm water daily. Avoid cold drinks, fried food, and dairy for 2-3 days.'",
    "",
    "Warning signs:",
    "- 5-8 items mixing ER triggers + doctor-visit triggers with clear timeframes.",
    "- Format: 'Go to ER immediately if...' or 'See doctor within X days if...'",
    "- Be specific with numbers: temperature thresholds, duration, severity markers.",
    "- Example: 'Go to ER if fever exceeds 103°F and doesn't respond to paracetamol within 2 hours'",
    "- Example: 'See a doctor within 2 days if cough persists with yellow/green phlegm'",
    "",
    "Desi ilaaj:",
    "- Include this section ONLY for medical queries (symptoms, lab reports, medicine, health concerns).",
    "- Do NOT include for casual chat (hi, hello, thanks, etc.).",
    "- CRITICAL: Give 3-5 DIFFERENT, SPECIFIC remedies each time. NEVER repeat the same generic haldi-doodh, adrak-shahad.",
    "- Match remedies to the EXACT condition. Fever remedies for fever, stomach remedies for stomach, skin remedies for skin.",
    "- Include SPECIFIC preparation methods, quantities, timing, and duration.",
    "- Mix Ayurvedic, Unani, Siddha, and grandmother's remedies from across India.",
    "- Mention which remedies have scientific evidence vs traditional use.",
    "- Always end with: 'Ye gharelu nuskhe supportive hain. Serious ya persistent symptoms me doctor zaroor dikhayein.'",
    "",
    "DESI ILAAJ VARIETY EXAMPLES (use these as INSPIRATION, create new ones each time):",
    "- Fever: Tulsi-giloy kadha, coriander seed water, raisin water, khus ki sharbat, sabja seeds in water",
    "- Cough: Mulethi (licorice) tea, black pepper + jaggery, onion juice + honey, betel leaf + honey, baheda powder",
    "- Cold: Turmeric steam, carom (ajwain) potli compress, dry ginger (sonth) tea, pepper rasam, black cardamom tea",
    "- Stomach/Gas: Hing water, pudina-jeera ark, triphala churna, buttermilk with roasted cumin, ginger-lemon-rock salt before meals",
    "- Acidity: Cold milk, fennel (saunf) water, amla murabba, banana, coconut water",
    "- Headache: Clove-cinnamon paste on temples, peppermint oil massage, brahmi tea, lavender steam",
    "- Joint pain: Nirgundi oil massage, fenugreek (methi) water soak, turmeric-ginger paste, Mahanarayan oil",
    "- Skin: Neem paste, turmeric + sandalwood, aloe vera gel, multani mitti pack, rose water toner",
    "- Hair fall: Bhringraj oil, amla-reetha-shikakai wash, onion juice scalp massage, curry leaf coconut oil",
    "- Diabetes support: Jamun seed powder, bitter gourd (karela) juice, fenugreek soaked water, neem leaf extract",
    "- BP support: Garlic cloves morning empty stomach, lauki (bottle gourd) juice, arjun ki chaal tea",
    "- Immunity: Chyawanprash, kadha (tulsi+dalchini+kali mirch+adrak+giloy), ashwagandha milk, moringa powder",
    "- Sleep: Jatamansi powder in warm milk, nutmeg (jaiphal) milk, chamomile-brahmi tea, foot massage with warm oil",
    "- Women's health: Shatavari, dashamoola kwath for period pain, fennel tea for bloating, ajwain water post-delivery",
    "",
    "═══ SPECIAL SCENARIOS ═══",
    "",
    "CASUAL CHAT (hi, hello, how are you, thanks):",
    "- Reply warmly and naturally. Like a friendly doctor greeting you.",
    "- Do NOT include Assessment/Next steps/Warning signs/Desi ilaaj sections.",
    "- Keep it short, warm, and natural.",
    "- Example: 'Hello! Main yahan hoon aapki health ke liye. Kuch puchna ho to batayein!'",
    "",
    "MENTAL HEALTH queries:",
    "- Be extra gentle, validating, and non-judgmental.",
    "- Acknowledge their feelings before giving advice.",
    "- Recommend professional help for persistent issues.",
    "- For suicidal thoughts: Immediately provide Vandrevala Foundation helpline: 1860-2662-345 (24/7) and iCall: 9152987821.",
    "",
    "CHILDREN queries:",
    "- Always ask for age and weight for dosage calculations.",
    "- Be extra cautious with medicine recommendations.",
    "- Emphasize ORS for dehydration, avoid unnecessary antibiotics.",
    "",
    "PREGNANCY queries:",
    "- Extra caution with medicine safety (Category A/B/C/D/X).",
    "- Default to 'consult your OB-GYN before taking any medicine'.",
    "- Safe: Paracetamol. Avoid: Ibuprofen, aspirin, most antibiotics without doctor.",
    "",
    "LAB REPORT Analysis:",
    "- Start with 2-3 line overall summary.",
    "- Explain EVERY abnormal value in simple language with what it means.",
    "- For borderline values, reassure but suggest monitoring.",
    "- Compare with Indian population normal ranges where relevant.",
    "- Practical diet/lifestyle advice for each abnormal finding.",
    "",
    "PRESCRIPTION Analysis:",
    "- Explain each medicine: what it's for, how to take, common side effects.",
    "- Mention food interactions (before/after food, avoid with alcohol, etc.).",
    "- Flag potential drug interactions if multiple medicines listed.",
    "- Practical tips: 'set phone alarm for medicine timing' etc.",
    "",
    "X-RAY / SCAN Analysis:",
    "- Describe visible findings in layman terms.",
    "- Explain if findings look concerning or likely benign.",
    "- Suggest what follow-up might be needed.",
    "- Never claim final radiologist diagnosis.",
    "",
    "═══ WHAT MAKES YOU THE BEST ═══",
    "- You give MORE information than a typical 5-minute doctor visit.",
    "- You explain the WHY behind every recommendation.",
    "- You're available 24/7, multilingual, and infinitely patient.",
    "- You combine modern medicine with traditional Indian wisdom.",
    "- You track patient history and give personalized advice.",
    "- You make health accessible to 1.4 billion Indians in their own language.",
  ].join("\n");
}

function sanitizeReplyFormatting(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/`{1,3}/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSectionBody(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trimRight())
    .join("\n")
    .trim();
}

function extractSection(text, heading) {
  const src = String(text || "");
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headings = ["Assessment", "Next steps", "Warning signs", "Red flags", "When to see doctor", "Desi ilaaj", "Home remedies"];
  const other = headings
    .filter((h) => h !== heading)
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`${esc}:\\s*([\\s\\S]*?)(?=\\n(?:${other.join("|")}):|$)`, "i");
  const m = src.match(re);
  return m ? normalizeSectionBody(m[1]) : "";
}

function ensureUsefulBullets(block, fallbackLines = []) {
  const raw = normalizeSectionBody(block);
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  if (!lines.length) {
    return fallbackLines.map((x) => `- ${x}`).join("\n");
  }

  return lines
    .map((line) => (/^- /.test(line) ? line : `- ${line}`))
    .join("\n");
}

/* ── Context-aware Desi Ilaaj with VARIETY ── */
function getContextualDesiIlaaj(message, focus) {
  const src = String(message || "").toLowerCase();

  const remedyPools = {
    fever: [
      "Giloy (Guduchi) kadha: 4-5 inch giloy stem ko paani me 10 min ubaalein, thoda shahad milayein — immunity booster aur fever reducer. Din me 2 baar.",
      "Tulsi-kali mirch kadha: 10-12 tulsi patti + 4-5 kali mirch + 1 inch adrak ubaalein 10 min — natural antipyretic. Garam garam piyein.",
      "Dhaniya beej (coriander) water: 2 tbsp dhaniya beej raat ko 1 glass paani me bhigoyein, subah chaan ke piyein — body cooling effect.",
      "Munakka (raisin) water: 8-10 munakka raat ko paani me bhigoyein, subah kha lein aur paani pee lein — viral fever me kaam karta hai.",
      "Sabja (basil seeds) in cold water: 1 tsp sabja seeds paani me 15 min bhigoyein — body temperature naturally kam karta hai.",
      "Khus (vetiver) ki sharbat: Thanda karne ke liye natural coolant. 2 tbsp khus syrup thande paani me.",
      "Makoi (black nightshade) ka kaadha: Fever aur liver support ke liye traditionally use hota hai. 5-6 patti ubaalein.",
    ],
    cough: [
      "Mulethi (licorice root) tea: 1 choti stick mulethi ko 1 cup paani me 5 min ubaalein, shahad milayein — throat coating effect, dry cough me bahut effective.",
      "Kali mirch + gur (jaggery): 5-6 kali mirch crush karein + 1 tbsp gur, mix karke chote gole banayein — din me 2-3 baar chusein. Productive cough ke liye.",
      "Pyaz ka ras + shahad: 1 tbsp onion juice + 1 tsp shahad mix — din me 2 baar. Expectorant effect hota hai, balgam nikalta hai.",
      "Paan (betel leaf) + shahad: 1 paan ka patta garam karein, 1/2 tsp shahad lagayein, chew karein — traditional cough remedy.",
      "Baheda powder: 1/2 tsp baheda churna + 1 tsp shahad — din me 2 baar. Triphala ingredient, cough suppressant.",
      "Adusa (Malabar nut) leaves: 5-6 patti ka kaadha, 10 min boil — Ayurvedic cough medicine ka main ingredient yahi hai.",
      "Dry fig (anjeer) milk: 2-3 dry figs garam doodh me boil, soak, then eat — respiratory tract soothe karta hai.",
    ],
    cold: [
      "Ajwain potli: 1 tbsp ajwain + 1 tbsp salt ko tawa pe garam karein, kapde me baandh ke chest/nose pe rakhein — nasal congestion instantly open hota hai.",
      "Sonth (dry ginger) tea: 1/2 tsp sonth powder + shahad + lemon garam paani me — anti-inflammatory aur warming effect.",
      "Pepper rasam: 1 tsp kali mirch + 1 tsp jeera + 2 lehsun + dal ka paani + tamatar — South Indian remedy, cold aur throat infection ke liye proven.",
      "Haldi steam: 1 tsp haldi garam paani me daalein, 10 min steam lein, sir pe towel dhakein — sinus clear karta hai.",
      "Badi elaichi (black cardamom) tea: 2 badi elaichi crush karein, chai me daalein — decongestant effect, chest congestion ke liye.",
      "Garlic-ghee mix: 2-3 lehsun ki kali crush, 1 tsp ghee me fry, garam kha lein — antimicrobial + warming.",
      "Pippali (long pepper) doodh: 1/4 tsp pippali powder garam doodh me — chronic cold aur sinus ke liye Ayurvedic classic.",
    ],
    stomach: [
      "Hing (asafoetida) paani: 1 pinch hing garam paani me — instant gas aur bloating relief. Khana khane ke baad lein.",
      "Pudina-jeera ark: Fresh pudina + bhuna jeera + rock salt + lemon — natural digestive tonic. Indigestion ke liye best.",
      "Triphala churna: 1 tsp raat ko garam paani me — gentle detox + constipation relief + gut health. Roz raat lein.",
      "Ajwain + kala namak: 1/2 tsp ajwain + chutki kala namak garam paani se — gas, bloating, aur stomach cramps ke liye instant relief.",
      "Buttermilk (chaach) + bhuna jeera: 1 glass chaach + 1/2 tsp bhuna jeera + pudina — lunch ke baad best digestive.",
      "Jeera-saunf-mishri mukhwas: Equal parts roasted jeera + saunf + mishri — khana khane ke baad 1 tsp chew karein. Traditional digestive.",
      "Isabgol (psyllium husk) + dahi: 1 tbsp isabgol dahi me — constipation ke liye raat ko lein, diarrhea ke liye pani me.",
    ],
    acidity: [
      "Thanda doodh: 1 glass cold milk (no sugar) — instant acidity neutralizer. Calcium acts as natural antacid.",
      "Saunf (fennel) water: 1 tsp saunf ko 1 cup paani me 10 min ubaalein — cooling, anti-spasmodic. Meals ke baad piyein.",
      "Amla murabba: 1 piece roz subah — Vitamin C + alkalizing effect. Chronic acidity ke liye roz khaein.",
      "Elaichi (cardamom) powder: 2 chhoti elaichi crush, garam paani me — stimulates digestion, reduces acid reflux.",
      "Coconut water: 1-2 glass per day — natural alkaline, stomach lining soothe karta hai.",
      "Banana (kela): 1 ripe banana when acidity hits — natural antacid, pectin helps coat stomach lining.",
      "Jau (barley) water: Jau ko paani me ubaalein, chaan ke piyein — alkalizing + cooling. Summer me especially good.",
    ],
    headache: [
      "Laung (clove) + dalchini paste: 4-5 laung + 1/2 tsp dalchini + paani grind karein, mathe pe lagayein 15-20 min — analgesic effect.",
      "Peppermint oil massage: 2-3 drops temples pe gentle circular massage — menthol dilates blood vessels, pain relief 15 min me.",
      "Brahmi tea: 1 tsp brahmi powder garam paani me — brain tonic, stress headache ke liye. Regular use se chronic headache kam hota hai.",
      "Lavender steam: 3-4 drops lavender oil garam paani me, 10 min steam — tension headache aur sinus headache dono me kaam karta hai.",
      "Cold compress + adrak chai: Thande kapde se forehead pe compress + adrak wali chai — combination therapy jo fast kaam karta hai.",
      "Cinnamon paste: 1 tsp dalchini powder + paani mix, mathe pe lagayein — sinus headache ke liye especially effective.",
      "Camphor-coconut oil: 1/4 tsp kapoor melt in 2 tbsp nariyal tel, temples pe malish — migraine me traditional remedy.",
    ],
    joints: [
      "Nirgundi (five-leaved chaste tree) oil: Patti ka tel garam karein, affected joint pe 15 min malish — most effective Ayurvedic anti-inflammatory.",
      "Methi (fenugreek) soak: 1 tbsp methi raat ko paani me bhigoyein, subah kha lein — anti-inflammatory, joint lubrication badhata hai.",
      "Haldi-adrak paste: 1 tsp haldi + 1 tsp adrak ka ras, paste banayein, joint pe lagayein 20 min — curcumin + gingerol both anti-inflammatory.",
      "Mahanarayan oil malish: Traditional Ayurvedic oil — raat ko garam karke gentle malish, morning tak stiffness kam hoti hai.",
      "Epsom salt soak: 2 cups Epsom salt garam paani me, 20 min soak — magnesium absorption through skin, muscle relaxation.",
      "Til (sesame) oil warm massage: 2 tbsp til ka tel garam, affected area pe 15 min deep tissue massage — calcium + omega fatty acids jo bones strengthen karte hain.",
      "Ashwagandha doodh: 1 tsp ashwagandha powder garam doodh me raat ko — joint inflammation aur overall pain reduce karta hai.",
    ],
    skin: [
      "Neem face pack: Neem patti ka paste + haldi + rose water — antibacterial + anti-inflammatory. Pimples ke liye hafta 2-3 baar.",
      "Haldi + chandan (sandalwood) paste: 1/2 tsp haldi + 1 tsp chandan powder + rose water — glow + anti-acne. 15 min lagayein.",
      "Aloe vera gel (fresh): Aloe patta kaat ke gel nikalein, seedhe skin pe lagayein — burns, rash, sunburn, dryness sab ke liye.",
      "Multani mitti pack: 2 tbsp multani mitti + rose water + 1 tsp shahad — oil control + deep cleansing. Oily skin ke liye weekly.",
      "Tea tree diluted: 2-3 drops tea tree oil in coconut oil — spot treatment for pimples. Direct mat lagayein, always dilute karein.",
      "Papaya face pack: Ripe papaya mash + 1 tsp shahad — papain enzyme dead skin remove karta hai. Natural exfoliator.",
      "Besan-dahi ubtan: 2 tbsp besan + 2 tbsp dahi + chutki haldi — traditional Indian skin brightening. Hafta me 2 baar.",
    ],
    general: [
      "Chyawanprash: 1 tbsp roz subah garam doodh ke saath — 40+ herbs ka combination, Ayurveda ka most proven immunity formula.",
      "Kadha (immunity): Tulsi + dalchini + kali mirch + sonth + giloy + laung ubaalein — AYUSH ministry recommended during COVID. Roz 1 cup.",
      "Ashwagandha milk: 1 tsp ashwagandha churna garam doodh me raat ko — stress reducer, sleep improver, strength builder.",
      "Moringa (drumstick) powder: 1 tsp moringa powder paani/smoothie me — superfood, 7x more Vitamin C than orange.",
      "Amla (Indian gooseberry): 1 amla roz — richest natural source of Vitamin C. Candy, murabba, juice — kisi bhi form me lein.",
      "Haldi doodh (Golden milk): 1/2 tsp haldi + chutki kali mirch (absorption badhata hai) garam doodh me — anti-inflammatory daily tonic.",
      "Triphala tablets/churna: 2 tablets ya 1 tsp raat ko — gut health, eye health, overall detox. Ayurveda ka most versatile formula.",
    ],
  };

  let pool = "general";
  if (/(fever|bukhar|temperature|tapman|बुखार|ताप)/.test(src)) pool = "fever";
  else if (/(cough|khansi|khasi|balgam|phlegm|खांसी)/.test(src)) pool = "cough";
  else if (/(cold|nazla|zukham|sardi|runny nose|blocked nose|congestion|sinus|सर्दी|जुकाम)/.test(src)) pool = "cold";
  else if (/(stomach|pet|gas|bloating|indigestion|badhasmi|constipation|kabz|diarrhea|loose motion|dast|ulcer|पेट|गैस|कब्ज|दस्त)/.test(src)) pool = "stomach";
  else if (/(acidity|acid reflux|heartburn|seene me jalan|gerd|khatta|एसिडिटी)/.test(src)) pool = "acidity";
  else if (/(headache|sir dard|migraine|head pain|सर दर्द)/.test(src)) pool = "headache";
  else if (/(joint|jod|knee|ghutna|back pain|kamar|muscle|shoulder|neck|cervical|arthritis|gathiya|जोड़|घुटना|कमर)/.test(src)) pool = "joints";
  else if (/(skin|pimple|acne|rash|fungal|eczema|ring worm|daad|khujli|itching|hair|baal|dandruff|त्वचा|पिंपल|मुहांसे|खुजली)/.test(src)) pool = "skin";
  else if (focus === "lab") pool = "general";
  else if (focus === "rx" || focus === "medicine") pool = "stomach";

  const remedies = remedyPools[pool] || remedyPools.general;
  const shuffled = [...remedies].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(4, shuffled.length));

  return selected.map((r) => `- ${r}`).join("\n") +
    "\n- Ye gharelu nuskhe supportive hain. Serious ya persistent symptoms me doctor zaroor dikhayein.";
}

function postProcessReply(reply, ctx, redFlags, sourceMessage = "") {
  const raw = sanitizeReplyFormatting(reply);

  if (isCasualConversation(sourceMessage)) {
    const hasStructuredSections = /(^|\n)\s*Assessment\s*:/i.test(raw);
    if (!hasStructuredSections) {
      return raw;
    }
  }

  let assessment = extractSection(raw, "Assessment");
  let nextSteps = extractSection(raw, "Next steps");
  let desiIlaajBody = extractSection(raw, "Desi ilaaj");
  if (!desiIlaajBody) desiIlaajBody = extractSection(raw, "Home remedies");

  let warningSignsBody = extractSection(raw, "Warning signs");

  if (!warningSignsBody) {
    const redFlagsBody = extractSection(raw, "Red flags");
    const whenDoctor = extractSection(raw, "When to see doctor");
    const merged = [redFlagsBody, whenDoctor].filter(Boolean).join("\n");
    if (merged.trim()) warningSignsBody = merged;
  }

  const includeDesiIlaaj = shouldIncludeDesiIlaaj({ message: sourceMessage, ctx });
  const focus = String(ctx?.focus || "").toLowerCase();

  if (includeDesiIlaaj && (!desiIlaajBody || desiIlaajBody.length < 100)) {
    desiIlaajBody = getContextualDesiIlaaj(sourceMessage, focus);
  }

  if (!assessment) {
    assessment = [
      "- Aapki concern samajh me aa gayi hai.",
      "- Better guidance ke liye please thoda aur detail share karein: exact symptom, kab se hai, kitna severe hai.",
      "- Age, existing conditions, aur current medicines bhi batayein.",
    ].join("\n");
  }

  if (!nextSteps) {
    nextSteps = [
      "- Symptoms carefully track karein — kab shuru hua, badh raha hai ya kam.",
      "- Hydration maintain karein — din me 8-10 glass paani.",
      "- Agar condition mild hai to basic care continue karein.",
      "- Agar bigad raha hai to neeche warning signs dekh ke action lein.",
    ].join("\n");
  }

  if (!warningSignsBody) {
    warningSignsBody = redFlags && redFlags.length
      ? redFlags.map((x) => `- ${x}`).join("\n")
      : [
          "- Go to ER immediately: severe chest pain, breathing trouble, confusion, fainting, heavy bleeding.",
          "- Go to ER: high fever (103°F+) not responding to paracetamol for 2+ hours.",
          "- See doctor within 1-2 days: symptoms not improving with home care.",
          "- See doctor: pain severe enough to disrupt sleep or daily activities.",
          "- See doctor: any unusual rash, swelling, or allergic reaction signs.",
          "- See doctor: persistent vomiting (>24 hrs) or inability to keep liquids down.",
        ].join("\n");
  }

  assessment = ensureUsefulBullets(assessment);
  nextSteps = ensureUsefulBullets(nextSteps);
  warningSignsBody = ensureUsefulBullets(warningSignsBody);

  const output = [
    "Assessment:",
    assessment,
    "",
    "Next steps:",
    nextSteps,
    "",
    "Warning signs:",
    warningSignsBody,
  ];

  if (includeDesiIlaaj) {
    desiIlaajBody = ensureUsefulBullets(desiIlaajBody);
    output.push("", "Desi ilaaj:", desiIlaajBody);
  }

  return output.join("\n");
}

function buildFallbackReply(message, ctx, redFlags) {
  const who = ctx.whoForLabel || (ctx.whoFor === "self" ? "you" : ctx.whoFor);
  const focus = String(ctx?.focus || "").toLowerCase();

  if (focus === "lab") {
    return postProcessReply(
      [
        "Assessment:",
        `- ${who} ke liye lab report analysis ke liye readable values chahiye.`,
        "- Agar Hb, WBC, Platelet, TSH, Sugar, Creatinine jaise values visible hain to detail me samjha sakta hoon.",
        "- Jo values clearly nahi dikh rahi unhe guess nahi karunga.",
        "",
        "Next steps:",
        "- Clear image ya PDF upload karein report ka.",
        "- Important values + units + reference ranges share karein.",
        "- Batayein ki weakness, fever, bleeding, ya koi severe symptom hai ya nahi.",
        "",
        "Warning signs:",
        "- Go to ER immediately: severe weakness, heavy bleeding, chest pain, breathing trouble, confusion, fainting.",
        "- See doctor urgently: clearly high/low values with symptoms.",
        "- See doctor within 2-3 days: borderline abnormal values for monitoring.",
        "- See doctor: repeated reports showing worsening pattern.",
      ].join("\n"),
      ctx,
      redFlags,
      message
    );
  }

  if (focus === "rx" || focus === "medicine") {
    return postProcessReply(
      [
        "Assessment:",
        `- ${who} ke liye medicine/prescription simple language me samjha sakta hoon.`,
        "- Har medicine ka use, side effects, aur important cautions bata sakta hoon.",
        "",
        "Next steps:",
        "- Medicine name aur strength share karein (e.g., Paracetamol 650).",
        "- Clear prescription image bhejein.",
        "- Age, pregnancy, allergies, kidney/liver conditions zaroor batayein.",
        "",
        "Warning signs:",
        "- Go to ER: severe allergic reaction (swelling, breathing issue, rash all over body).",
        "- Go to ER: severe vomiting, black stools, extreme drowsiness after medicine.",
        "- See doctor within 2-3 days: medicine se relief nahi mil raha.",
        "- See doctor: troublesome side effects jo daily life affect kar rahe hain.",
      ].join("\n"),
      ctx,
      redFlags,
      message
    );
  }

  if (focus === "xray") {
    return postProcessReply(
      [
        "Assessment:",
        `- ${who} ke liye X-ray/scan findings simple language me explain kar sakta hoon.`,
        "- Fracture, shadow, opacity, swelling, mass — sab samjha sakta hoon.",
        "",
        "Next steps:",
        "- Clear x-ray/scan image ya report upload karein.",
        "- Batayein ki dard hai, injury hui hai, breathing issue hai, ya fever hai.",
        "",
        "Warning signs:",
        "- Go to ER: severe trauma, deformity, numbness, inability to move limb.",
        "- Go to ER: breathing difficulty with chest x-ray abnormality.",
        "- See doctor urgently: suspected fracture ya concerning shadow.",
        "- See doctor: persistent pain ya symptoms worsening despite rest.",
      ].join("\n"),
      ctx,
      redFlags,
      message
    );
  }

  return postProcessReply(
    [
      "Assessment:",
      `- ${who} ke liye first-level health guidance de sakta hoon.`,
      "- Better answer ke liye age, symptom duration, severity, fever reading, current medicines helpful hongi.",
      "",
      "Next steps:",
      "- Main symptom describe karein — kab shuru hua, kitna severe hai.",
      "- Existing diseases aur medicines batayein.",
      "- Fever/sugar/BP/oxygen reading ho to share karein.",
      "",
      "Warning signs:",
      "- Go to ER immediately: severe chest pain, breathing trouble, confusion, seizures.",
      "- Go to ER: fainting, severe dehydration, uncontrolled bleeding.",
      "- See doctor within 2-3 days: symptoms not improving.",
      "- See doctor: severe pain, persistent weakness, ongoing vomiting.",
      "- See doctor: daily activities difficult ho rahe hain.",
    ].join("\n"),
    ctx,
    redFlags,
    message
  );
}

async function upsertSession({ userId, context, userText, assistantText, attachment }) {
  if (!userId) return null;

  const whoFor = context?.whoFor || "self";
  const whoForLabel = String(context?.whoForLabel || "");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let session = await AiSession.findOne({
    userId,
    whoFor,
    whoForLabel,
    updatedAt: { $gte: since },
  }).sort({ updatedAt: -1 });

  if (!session) {
    session = new AiSession({
      userId,
      whoFor,
      whoForLabel,
      language: context?.language || "auto",
      focus: context?.focus || "auto",
      messages: [],
      attachments: [],
    });
  } else {
    session.language = context?.language || session.language;
    session.focus = context?.focus || session.focus;
  }

  session.messages.push(
    { role: "user", text: String(userText || ""), ts: new Date() },
    { role: "assistant", text: String(assistantText || ""), ts: new Date() }
  );

  if (attachment && (attachment.name || attachment.url || attachment.type || attachment.extractedText)) {
    session.attachments.push({
      name: String(attachment.name || ""),
      url: String(attachment.url || ""),
      type: String(attachment.type || ""),
      extractedText: String(attachment.extractedText || "").slice(0, 15000),
    });
  }

  if (session.messages.length > 80) {
    session.messages = session.messages.slice(-80);
  }
  if (session.attachments.length > 20) {
    session.attachments = session.attachments.slice(-20);
  }

  await session.save();
  return session._id;
}

async function getRecentAttachmentContext({ userId, context }) {
  if (!userId) return null;
  const whoFor = context?.whoFor || "self";
  const whoForLabel = String(context?.whoForLabel || "");

  const session = await AiSession.findOne({ userId, whoFor, whoForLabel })
    .sort({ updatedAt: -1 })
    .lean();

  if (!session?.attachments?.length) return null;

  const last = session.attachments[session.attachments.length - 1];
  if (!last?.extractedText) return null;

  return {
    name: last.name || "previous file",
    type: last.type || "",
    text: String(last.extractedText || "").slice(0, 5000),
  };
}

async function generateAssistantReply({ message, history, context, userId, attachment }) {
  const baseUserMessage = String(message || "").trim();
  const cleanHistory = compactHistory(history, 16);
  const resolvedContext = await buildHealthContext({ userId, context });

  const detectedLanguage = resolveReplyLanguage(baseUserMessage, context);
  resolvedContext.detectedLanguage = detectedLanguage;
  resolvedContext.replyLanguagePreference = String(
    context?.replyLanguagePreference || "auto"
  ).toLowerCase();

  const recalledAttachment = attachment
    ? null
    : await getRecentAttachmentContext({ userId, context: resolvedContext });

  const reusePreviousAttachment = shouldReuseRecentAttachment({
    message: baseUserMessage,
    attachment,
    context: resolvedContext,
    recalledAttachment,
  });

  const userMessage = reusePreviousAttachment
    ? [
        baseUserMessage,
        "",
        `Previous uploaded file in this chat: ${recalledAttachment.name}`,
        "Use this extracted text context for continuity only if directly relevant to the current user message:",
        recalledAttachment.text,
      ].join("\n")
    : baseUserMessage;

  const redFlags = detectRedFlags([baseUserMessage, ...cleanHistory.map((m) => m.content)].join("\n"));
  const askedForVaultReport = isVaultReportAnalysisRequest(baseUserMessage);
  const hasExtractedReportText = Boolean(attachment?.extractedText);

  let reply = "";
  const client = getOpenAIClient();
  const model = process.env.AI_CHAT_MODEL || process.env.GPT_MED_MODEL || "gpt-4o-mini";
  const temperature = clampTemperature(process.env.AI_TEMPERATURE || 0.55);

  if (askedForVaultReport && !hasExtractedReportText) {
    reply = [
      "Assessment:",
      "- Aapki Health Vault se latest report analyze karne ke liye report text abhi chat me available nahi hai.",
      "- Memory se ya purani reports se guess nahi karunga — only visible findings pe analysis dunga.",
      "",
      "Next steps:",
      "- AI me file attach button use karein aur Health Vault se same report upload karein.",
      "- Fir puchein: 'analyze this uploaded report' — clear analysis mil jayega.",
      "- Agar image blurry hai to clearer image ya PDF upload karein.",
      "",
      "Warning signs:",
      "- Go to ER immediately: severe chest pain, breathing difficulty, confusion, fainting, heavy bleeding.",
      "- Go to ER: severe trauma, deformity, inability to move limb.",
      "- See doctor urgently: high fever, uncontrolled vomiting, worsening weakness.",
    ].join("\n");
  } else if (client && baseUserMessage) {
    try {
      const messages = [
        { role: "system", content: buildSystemPrompt(resolvedContext) },
        ...cleanHistory.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: userMessage },
      ];

      const out = await client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: Number(process.env.AI_MAX_TOKENS || 2000),
      });

      reply = String(out?.choices?.[0]?.message?.content || "").trim();
    } catch (err) {
      console.error("AI chat failed:", err?.message || err);
      reply = "";
    }
  }

  if (!reply) {
    reply = buildFallbackReply(baseUserMessage, resolvedContext, redFlags);
  }

  reply = sanitizeReplyFormatting(reply);
  reply = ensureStructuredSections(reply, { redFlags });
  reply = postProcessReply(reply, resolvedContext, redFlags, baseUserMessage);

  const sessionId = await upsertSession({
    userId,
    context: resolvedContext,
    userText: baseUserMessage,
    assistantText: reply,
    attachment,
  });

  return {
    reply,
    sessionId,
    context: resolvedContext,
  };
}

async function listSessions({ userId, limit = 20 }) {
  if (!userId) return [];
  return AiSession.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(Number(limit) || 20, 50)))
    .lean();
}

async function getSessionById({ userId, sessionId }) {
  if (!userId || !sessionId) return null;
  return AiSession.findOne({ _id: sessionId, userId }).lean();
}

module.exports = {
  generateAssistantReply,
  listSessions,
  getSessionById,
};