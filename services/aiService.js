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

  if (/(report|cbc|lipid|tsh|vitamin|platelet|hba1c|creatinine|hemoglobin|wbc|rbc|uric acid|bilirubin|sgpt|sgot|lab report|blood test)/.test(src)) {
    return "lab";
  }

  if (/(prescription|rx|dose|tablet|capsule|bd|tid|od|syrup|tab|cap)/.test(src)) {
    return "rx";
  }

  if (/(medicine|drug|dawai|paracetamol|azithromycin|tramadol|amoxicillin|pantoprazole)/.test(src)) {
    return "medicine";
  }

  return "symptom";
}

function hasMedicalIntent(text) {
  const src = String(text || "").toLowerCase();
  return /(symptom|bukhar|fever|cold|cough|khansi|pain|dard|headache|migraine|vomit|ultee|diarrhea|loose motion|sugar|bp|oxygen|report|lab|xray|x-ray|scan|prescription|rx|medicine|dawai|tablet|capsule|hba1c|cbc|cholesterol|thyroid|creatinine|hemoglobin|infection|allergy)/.test(src);
}

function isCasualConversation(text) {
  const src = String(text || "").toLowerCase().trim();
  if (!src) return true;
  if (hasMedicalIntent(src)) return false;
  return /^(hi|hii|hello|hey|yo|namaste|namaskar|kaise ho|kya haal|kya hal|kya scene|how are you|good morning|good evening|good night|thanks|thank you|thx|ok|okay|acha|accha|hmm|hmmm|bro|bhai)\b/.test(src);
}

function shouldIncludeDesiIlaaj({ message, ctx }) {
  const src = String(message || "").toLowerCase();
  if (!src) return false;
  if (/(desi|gharelu|home remedy|nuskh|kadha|ilaaj)/.test(src)) return true;
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

function buildSystemPrompt(ctx) {
  const whoLabel = ctx.whoForLabel || (ctx.whoFor === "self" ? "self" : ctx.whoFor);
  const profileBits = [];
  const forcedLanguage = String(ctx?.replyLanguage || ctx?.language || "auto").toLowerCase();
  const forcedLanguageRule =
    forcedLanguage === "hinglish"
      ? "FORCED LANGUAGE: Reply strictly in Hinglish (Roman Hindi + simple English mix). Do not reply in full English."
      : forcedLanguage === "hindi"
        ? "FORCED LANGUAGE: Reply strictly in Hindi (Devanagari script)."
        : forcedLanguage === "english"
          ? "FORCED LANGUAGE: Reply strictly in English."
          : "";

  if (ctx.userSummary && Object.keys(ctx.userSummary).length) {
    profileBits.push(`userSummary=${JSON.stringify(ctx.userSummary)}`);
  }
  if (ctx.healthProfile) {
    profileBits.push(`healthProfile=${JSON.stringify(ctx.healthProfile)}`);
  }

  return [
    "You are GoDavaii AI — India's most trusted personal health assistant. You aim to give such thorough, practical, and caring guidance that users feel confident managing their health without rushing to a doctor for every small issue.",
    "",
    "LANGUAGE RULE (CRITICAL — THIS IS THE #1 PRIORITY RULE):",
    "- You MUST detect the language the user writes in and reply in the EXACT SAME language.",
    "- If user writes FULLY in English → reply FULLY in English. Do NOT mix Hindi words.",
    "- If user writes in Hindi (Devanagari script) → reply fully in Hindi.",
    "- If user writes in Hinglish (mixed Hindi-English in Roman script like 'mujhe bukhar hai') → reply in Hinglish.",
    "- NEVER default to Hinglish when the user wrote in English.",
    "- The language of the CURRENT message determines your reply language, not previous messages.",
    forcedLanguageRule ? `- ${forcedLanguageRule}` : "",
    "",
    `Audience: ${ctx.whoFor} (${whoLabel}). Focus: ${ctx.focus}.`,
    profileBits.length ? `Context data: ${profileBits.join(" | ")}` : "Context data: limited.",
    "",
    "CORE RULES:",
    "- If extracted file text is provided in the user message, treat that as observed file content.",
    "- If previous uploaded file text is included for continuity, use it only when the current user message is clearly referring to that same file.",
    "- Do not say you cannot see files/images when extracted content is present.",
    "- Do not use markdown formatting symbols like **, __, #, ##, ###, or code blocks. Write section headers as plain text like 'Assessment:' NOT '### Assessment:' or '**Assessment:**'.",
    "- Do not invent missing values, diagnoses, dosages if they are not visible.",
    "- If something is not visible, say: not clearly visible in report/prescription.",
    "- Do not overuse 'consult doctor' in every line. Give practical explanation FIRST, then safety guidance.",
    "- Be reassuring when findings look mild or near-normal.",
    "- Give DETAILED, THOROUGH responses — you are replacing a doctor visit, so be comprehensive.",
    "",
    "For LAB REPORT queries:",
    "- Start with a short overall summary of the full visible report in 2-3 bullets.",
    "- Then explain EVERY important visible value in plain language.",
    "- Clearly say whether each value is low, high, borderline, or normal.",
    "- Prioritize abnormal and borderline values first.",
    "- For abnormal values: explain what it means, possible causes, and what to do.",
    "- Mention if findings look mild, moderate, or potentially important.",
    "- Do not claim final diagnosis but give practical interpretation.",
    "",
    "For PRESCRIPTION queries:",
    "- Explain what each visible medicine is generally used for, in simple words.",
    "- Explain visible dosage/timing in easy language.",
    "- Mention 2-4 common side effects per medicine.",
    "- Mention one practical caution per medicine (drowsiness, stomach upset, take after food, avoid alcohol etc).",
    "",
    "For MEDICINE queries:",
    "- Explain what the medicine is commonly used for.",
    "- Explain common side effects in plain language.",
    "- Mention when it should be used carefully.",
    "- Give dosage guidance based on age if user provides age.",
    "- Mention common interactions/cautions.",
    "",
    "For X-RAY / SCAN queries:",
    "- Explain what the visible findings suggest in simple language.",
    "- Describe any visible abnormality like fracture, shadow, mass, effusion, or opacity.",
    "- Explain what the finding typically means in non-medical terms.",
    "- Say whether finding looks concerning or likely benign.",
    "- Do not claim final radiologist diagnosis.",
    "",
    "For SYMPTOM queries:",
    "- Explain the most likely causes (not just one — give 2-3 possibilities ranked by likelihood).",
    "- Give detailed home-care steps: what to eat, what to avoid, rest guidance, OTC medicines with dosage.",
    "- Be specific: instead of 'take rest', say 'lie down in a comfortable position, avoid screens, drink warm water every 2 hours'.",
    "- If OTC medicine is appropriate, name it with dosage (e.g., 'Paracetamol 500mg, 1 tablet every 6-8 hours, max 4 tablets/day').",
    "",
    "ALWAYS answer in these exact sections in this exact order:",
    "",
    "Assessment:",
    "- 4-8 detailed bullet points covering all relevant findings/explanations.",
    "- Be thorough — this section should feel like a doctor explaining to you face-to-face.",
    "",
    "Next steps:",
    "- 3-6 specific, actionable practical steps.",
    "- Include diet advice, lifestyle changes, OTC medicines with dosage when appropriate.",
    "",
    "Warning signs:",
    "- This section combines red flags AND when to see a doctor into ONE clear list.",
    "- MUST have 5-8 items total.",
    "- Mix urgent red flags (go to ER immediately) with doctor-visit triggers (see doctor within X days).",
    "- Format each item with a clear action: 'Go to ER if...' or 'See doctor within 2-3 days if...'",
    "- Include timeframes and severity markers.",
    "- Example: 'Go to ER immediately if fever goes above 103°F or you have chest pain'",
    "- Example: 'See a doctor within 2-3 days if fever doesn't come down with medication'",
    "- Example: 'See a doctor if pain is so severe you can't sleep or walk'",
    "",
    "Desi ilaaj:",
    "- Include this section ONLY when user has a medical query or explicitly asks for desi/gharelu remedies.",
    "- Suggest 2-4 evidence-backed Indian home remedies relevant to the specific condition.",
    "- Be specific with preparation method and timing.",
    "- End with a note that these help but for serious symptoms see a doctor.",
    "",
    "Formatting rules:",
    "- Keep each section detailed and useful — do NOT give 1-2 line sections.",
    "- Assessment should usually have 4-8 bullet points.",
    "- Next steps should have 3-6 practical bullet points.",
    "- Warning signs MUST have 5-8 items mixing ER triggers + doctor visit triggers.",
    "- If included, Desi ilaaj should have 2-4 items with preparation details.",
    "- Keep the tone warm, caring, like a trusted family doctor who takes time to explain everything.",
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
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    return fallbackLines.map((x) => `- ${x}`).join("\n");
  }

  return lines
    .map((line) => {
      if (/^- /.test(line)) return line;
      return `- ${line}`;
    })
    .join("\n");
}

function postProcessReply(reply, ctx, redFlags, sourceMessage = "") {
  const raw = sanitizeReplyFormatting(reply);

  let assessment = extractSection(raw, "Assessment");
  let nextSteps = extractSection(raw, "Next steps");
  let desiIlaajBody = extractSection(raw, "Desi ilaaj");
  if (!desiIlaajBody) desiIlaajBody = extractSection(raw, "Home remedies");

  // ✅ FIX: Merged section — try "Warning signs" first, then fall back to old separate sections
  let warningSignsBody = extractSection(raw, "Warning signs");

  // If GPT still used old format, merge the two old sections
  if (!warningSignsBody) {
    const redFlagsBody = extractSection(raw, "Red flags");
    const whenDoctor = extractSection(raw, "When to see doctor");
    const merged = [redFlagsBody, whenDoctor].filter(Boolean).join("\n");
    if (merged.trim()) {
      warningSignsBody = merged;
    }
  }

  const focus = String(ctx?.focus || "").toLowerCase();

  const includeDesiIlaaj = shouldIncludeDesiIlaaj({ message: sourceMessage, ctx });

  if (includeDesiIlaaj && !desiIlaajBody) {
    if (focus === "lab") {
      desiIlaajBody = [
        "- Haldi doodh: 1 glass garam doodh me 1/2 tsp haldi — immunity boost aur inflammation kam karta hai.",
        "- Amla juice: Subah khali pet 2 tbsp amla juice — Vitamin C aur iron absorption badhata hai.",
        "- Chukandar (beetroot) juice: Hemoglobin low ho to din me 1 glass — natural blood builder.",
        "- Ye gharelu nuskhe madad karte hain lekin serious symptoms me doctor zaroor dikhayein.",
      ].join("\n");
    } else if (focus === "rx" || focus === "medicine") {
      desiIlaajBody = [
        "- Medicine ke side effects kam karne ke liye: khana khane ke baad medicine lein, paani zyada piyein.",
        "- Stomach upset ho to: jeera paani (1 tsp jeera ko 1 cup paani me ubaalein) — digestion improve karta hai.",
        "- Immunity support: tulsi kadha — 5-6 tulsi patti + adrak + kali mirch ko paani me 5 min ubaalein.",
        "- Ye gharelu nuskhe madad karte hain lekin serious symptoms me doctor zaroor dikhayein.",
      ].join("\n");
    } else if (focus === "xray") {
      desiIlaajBody = [
        "- Haldi paste: Dard wali jagah par haldi + sarson ka tel laga sakte hain — natural anti-inflammatory.",
        "- Epsom salt soak: Agar joint/bone pain hai to garam paani me 2 tbsp Epsom salt daalke 15-20 min soak karein.",
        "- Calcium rich diet: Doodh, dahi, paneer, ragi — haddiyon ki mazbooti ke liye.",
        "- Ye gharelu nuskhe madad karte hain lekin serious symptoms me doctor zaroor dikhayein.",
      ].join("\n");
    } else {
      desiIlaajBody = [
        "- Haldi doodh: 1 glass garam doodh me 1/2 tsp haldi — anti-inflammatory aur immunity booster.",
        "- Adrak-shahad: Adrak ka ras + 1 tsp shahad — khansi, gale ki kharash, aur cold ke liye.",
        "- Jeera paani: 1 tsp jeera ubaalein paani me — pet dard, gas, acidity ke liye faydemand.",
        "- Ye gharelu nuskhe madad karte hain lekin serious symptoms me doctor zaroor dikhayein.",
      ].join("\n");
    }
  }

  if (!assessment) {
    assessment = [
      "- Need more details for a thorough assessment.",
      "- Please share specific symptoms, duration, and severity for better guidance.",
    ].join("\n");
  }

  if (!nextSteps) {
    nextSteps = [
      "- Track your symptoms carefully.",
      "- If condition is mild, continue basic care.",
      "- If problem worsens, seek medical help.",
    ].join("\n");
  }

  if (!warningSignsBody) {
    warningSignsBody = redFlags && redFlags.length
      ? redFlags.map((x) => `- ${x}`).join("\n")
      : [
          "- Go to ER immediately if you have severe breathing problems, chest pain, or confusion.",
          "- Go to ER if high fever (103°F+) doesn't respond to medication for 2+ days.",
          "- See a doctor within 1-2 days if symptoms don't improve with home care.",
          "- See a doctor if pain is severe enough to disrupt sleep or daily activities.",
          "- See a doctor if you notice unusual rash, swelling, or allergic reaction signs.",
        ].join("\n");
  }

  assessment = ensureUsefulBullets(assessment, [
    "Simple explanation based on visible information.",
    "Final diagnosis cannot be confirmed without proper examination.",
  ]);

  nextSteps = ensureUsefulBullets(nextSteps, [
    "Stay hydrated, rest, and monitor symptoms.",
    "Follow any visible medical advice.",
    "If worsening, consult a doctor.",
  ]);

  warningSignsBody = ensureUsefulBullets(warningSignsBody, [
    "Go to ER for severe symptoms like chest pain, breathing trouble, or confusion.",
    "See a doctor within 2-3 days if symptoms persist or worsen.",
  ]);

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
    desiIlaajBody = ensureUsefulBullets(desiIlaajBody, [
      "Haldi doodh — natural anti-inflammatory aur immunity booster.",
      "Adrak-shahad — khansi aur cold ke liye faydemand.",
      "Ye gharelu nuskhe madad karte hain lekin serious symptoms me doctor zaroor dikhayein.",
    ]);
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
        `- For ${who}, a simple summary requires visible report values.`,
        "- If Hb, WBC, Platelet, TSH, Creatinine, Sugar, or any highlighted value is visible, it can be explained.",
        "- Values that are not clear will not be guessed.",
        "",
        "Next steps:",
        "- Please send a clear image/PDF of the report.",
        "- Share important values + units + reference ranges.",
        "- Mention if there is weakness, fever, bleeding, severe pain, or breathing issues.",
        "",
        "Warning signs:",
        "- Go to ER immediately for severe weakness, heavy bleeding, chest pain, breathing problems, confusion, or fainting.",
        "- See a doctor if abnormal values are clearly high/low.",
        "- See a doctor if symptoms are present alongside abnormal values.",
        "- See a doctor if repeated reports show an abnormal pattern.",
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
        `- For ${who}, the medicine/prescription can be explained in simple language.`,
        "- This includes use, common side effects, and important cautions.",
        "",
        "Next steps:",
        "- Share the medicine name and strength, like Paracetamol 650.",
        "- Send a clear prescription image.",
        "- Mention age, pregnancy, allergies, kidney/liver disease.",
        "",
        "Warning signs:",
        "- Go to ER for severe allergy, swelling, breathing issues, or fainting.",
        "- Go to ER for severe vomiting, black stools, or severe drowsiness.",
        "- See a doctor within 2-3 days if medicine doesn't provide relief.",
        "- See a doctor if side effects are troublesome.",
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
        `- For ${who}, x-ray/scan findings can be explained simply if visible findings are clear.`,
        "- Fracture, shadow, opacity, swelling, mass, effusion meanings can be explained.",
        "",
        "Next steps:",
        "- Upload a clear x-ray/scan image or report.",
        "- Mention if there is pain, injury, breathing issues, fever, or trauma history.",
        "",
        "Warning signs:",
        "- Go to ER for severe trauma, breathing issues, or chest pain.",
        "- Go to ER for limb deformity, weakness, numbness, or severe swelling.",
        "- See a doctor if there is suspicion of fracture or concerning shadow.",
        "- See a doctor if pain or symptoms are worsening.",
      ].join("\n"),
      ctx,
      redFlags,
      message
    );
  }

  return postProcessReply(
    [
      "Assessment:",
      `- For ${who}, first-level symptom guidance can be provided.`,
      "- For a better answer, age, symptom duration, severity, fever value, and current medicines are helpful.",
      "",
      "Next steps:",
      "- Describe the main symptom, when it started, and how severe it is.",
      "- Share existing diseases and medicines.",
      "- Add fever/sugar/BP/oxygen readings if available.",
      "",
      "Warning signs:",
      "- Go to ER immediately for severe chest pain, breathing trouble, or confusion.",
      "- Go to ER for seizures, fainting, severe dehydration, or uncontrolled bleeding.",
      "- See a doctor within 2-3 days if symptoms don't improve.",
      "- See a doctor if severe pain, weakness, or persistent vomiting occurs.",
      "- See a doctor if daily activities become difficult.",
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
      "- I cannot safely analyze your latest Health Vault report yet because report text is not available in this chat context.",
      "- I will not guess lab values from memory or old reports.",
      "- Please open the exact report and upload it in AI using file analysis so interpretation is based on visible findings only.",
      "",
      "Next steps:",
      "- In AI, use Attach File and upload the same report image/PDF from Health Vault.",
      "- Then ask: analyze this uploaded report only.",
      "- If text is blurry, upload clearer image or PDF for accurate extraction.",
      "",
      "Warning signs:",
      "- Go to ER immediately for severe chest pain, breathing difficulty, confusion, fainting, or heavy bleeding.",
      "- Go to ER for severe trauma, deformity, or inability to move a limb after injury.",
      "- See a doctor urgently if high fever, uncontrolled vomiting, or worsening weakness is present.",
      "",
      "Desi ilaaj:",
      "- For injury pain/swelling: rest + cold compress 10-15 min, 3-4 times/day in first 24-48 hrs.",
      "- Keep injured part elevated when possible to reduce swelling.",
      "- Ye gharelu steps supportive hain; severe symptoms me doctor ko turant dikhayein.",
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
