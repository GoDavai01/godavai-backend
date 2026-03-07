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

  if (currentIntent === "symptom") return false;
  if (focus === "symptom") return false;

  return ["lab", "rx", "medicine"].includes(currentIntent);
}

function buildSystemPrompt(ctx) {
  const whoLabel = ctx.whoForLabel || (ctx.whoFor === "self" ? "self" : ctx.whoFor);
  const profileBits = [];

  if (ctx.userSummary && Object.keys(ctx.userSummary).length) {
    profileBits.push(`userSummary=${JSON.stringify(ctx.userSummary)}`);
  }
  if (ctx.healthProfile) {
    profileBits.push(`healthProfile=${JSON.stringify(ctx.healthProfile)}`);
  }

  return [
    "You are GoDavaii AI, a careful and practical health assistant.",
    `Language preference: ${ctx.language}.`,
    `Audience: ${ctx.whoFor} (${whoLabel}). Focus: ${ctx.focus}.`,
    `Context vault enabled: ${ctx?.vault?.enabled ? "yes" : "no"}.`,
    profileBits.length ? `Context data: ${profileBits.join(" | ")}` : "Context data: limited.",
    "If extracted file text is provided in the user message, treat that as observed file content.",
    "If previous uploaded file text is included for continuity, use it only when the current user message is clearly referring to that same file, medicine, report, or prescription. If the current message is a new unrelated symptom question, do not anchor the answer on the previous file.",
    "Do not say you cannot see files/images when extracted content is present.",
    "Use very simple Hinglish/English that a normal non-medical user can understand.",
    "Do not use markdown formatting symbols like **, __, #, or code blocks.",
    "Do not invent missing report values, diagnoses, dosages, frequencies, or medicine purposes if they are not visible or not reasonably inferable.",
    "If something is not visible, say: not clearly visible in report/prescription.",
    "Do not overuse 'consult doctor' in every line. Give practical explanation first, then safety guidance.",
    "Be reassuring when findings look mild or near-normal, but remain safety-first.",
    "For LAB REPORT queries:",
    "- Start with a short overall summary of the full visible report in 2-3 bullets.",
    "- Then explain the important visible values in plain language.",
    "- Clearly say whether each visible important value is low, high, borderline, or normal.",
    "- Prioritize abnormal and borderline values, but do not ignore other clearly visible relevant values just because they are normal.",
    "- If many values are visible, keep normal ones brief and easy to understand.",
    "- Mention if findings look mild, moderate, or potentially important based only on visible data.",
    "- Briefly explain likely significance, but do not claim final diagnosis.",
    "For PRESCRIPTION queries:",
    "- Explain what each visible medicine is generally used for, in simple words.",
    "- Explain visible dosage/timing in easy language.",
    "- Mention 2-4 common side effects if medicine is identifiable.",
    "- Mention one practical caution, such as drowsiness, stomach upset, taking after food, or avoiding alcohol, only if generally appropriate.",
    "For MEDICINE queries:",
    "- Explain what the medicine is commonly used for.",
    "- Explain common side effects in plain language.",
    "- Mention when it should be used carefully.",
    "- Mention common interactions/cautions only if reasonably known and high value.",
    "For SYMPTOM queries:",
    "- Explain likely low-risk possibilities in plain language.",
    "- Give simple home-care steps when appropriate.",
    "- Clearly separate red flags.",
    "Always answer in these exact sections and in this exact order:",
    "Assessment:",
    "Next steps:",
    "Red flags:",
    "When to see doctor:",
    "Formatting rules:",
    "- Keep each section useful and not too short.",
    "- Assessment should usually have 4-8 bullet points when enough information is available.",
    "- Next steps should usually have 3-6 practical bullet points.",
    "- If medicine is involved, include common side effects inside Assessment or Next steps.",
    "- Keep the tone user-friendly, calm, practical, and clear.",
  ].join("\n");
}

function sanitizeReplyFormatting(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/`{1,3}/g, "")
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
  const headings = ["Assessment", "Next steps", "Red flags", "When to see doctor"];
  const other = headings.filter((h) => h !== heading).map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
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

function postProcessReply(reply, ctx, redFlags) {
  const raw = sanitizeReplyFormatting(reply);

  let assessment = extractSection(raw, "Assessment");
  let nextSteps = extractSection(raw, "Next steps");
  let redFlagsBody = extractSection(raw, "Red flags");
  let whenDoctor = extractSection(raw, "When to see doctor");

  const focus = String(ctx?.focus || "").toLowerCase();

  if (!assessment) {
    if (focus === "lab") {
      assessment = [
        "- Report ke visible values ke basis par summary di ja rahi hai.",
        "- Jo values high, low, ya borderline hain unka simple meaning bataya jana chahiye.",
      ].join("\n");
    } else if (focus === "rx" || focus === "medicine") {
      assessment = [
        "- Visible medicine/prescription details ko simple language me explain kiya jana chahiye.",
        "- Common use aur common side effects bataye jane chahiye agar medicine identify ho rahi ho.",
      ].join("\n");
    } else {
      assessment = [
        "- Symptoms ki simple triage summary di ja rahi hai.",
        "- Final diagnosis claim nahi kiya ja raha.",
      ].join("\n");
    }
  }

  if (!nextSteps) {
    nextSteps = [
      "- Symptoms ya report ko track karein.",
      "- Agar condition mild ho to basic care continue karein.",
      "- Agar problem worsen ho to medical help lein.",
    ].join("\n");
  }

  if (!redFlagsBody) {
    redFlagsBody = redFlags && redFlags.length
      ? redFlags.map((x) => `- ${x}`).join("\n")
      : "- Severe breathing problem, chest pain, confusion, fainting, seizures, ya uncontrolled bleeding ho to urgent care lein.";
  }

  if (!whenDoctor) {
    whenDoctor = [
      "- Agar symptoms 1-3 din me better na ho.",
      "- Agar dard, weakness, fever, vomiting, rash, ya breathing issue badhe.",
      "- Agar medicine se unusual side effects mehsoos hon.",
    ].join("\n");
  }

  assessment = ensureUsefulBullets(assessment, [
    "Simple explanation based on visible information.",
    "Final diagnosis confirm nahi ki ja rahi.",
  ]);

  nextSteps = ensureUsefulBullets(nextSteps, [
    "Hydration, rest, aur symptom monitoring rakhein.",
    "Jo advice clearly visible hai usko follow karein.",
    "Agar worsening ho to doctor se baat karein.",
  ]);

  redFlagsBody = ensureUsefulBullets(redFlagsBody, [
    "Severe symptoms me urgent care lein.",
  ]);

  whenDoctor = ensureUsefulBullets(whenDoctor, [
    "Agar symptoms persist ya worsen karein to doctor ko dikhayein.",
  ]);

  return [
    "Assessment:",
    assessment,
    "",
    "Next steps:",
    nextSteps,
    "",
    "Red flags:",
    redFlagsBody,
    "",
    "When to see doctor:",
    whenDoctor,
  ].join("\n");
}

function buildFallbackReply(message, ctx, redFlags) {
  const who = ctx.whoForLabel || (ctx.whoFor === "self" ? "you" : ctx.whoFor);
  const focus = String(ctx?.focus || "").toLowerCase();

  if (focus === "lab") {
    return postProcessReply(
      [
        "Assessment:",
        `- ${who} ke liye report ka simple summary dene ke liye visible values chahiye.`,
        "- Agar Hb, WBC, Platelet, TSH, Creatinine, Sugar, ya koi highlighted value visible hai to uska meaning samjhaya ja sakta hai.",
        "- Abhi jo value clear nahi hai usko guess nahi kiya jayega.",
        "",
        "Next steps:",
        "- Report ki clear image/PDF bhejein.",
        "- Important values + unit + reference range share karein.",
        "- Agar weakness, fever, bleeding, severe pain, ya breathing issue hai to mention karein.",
        "",
        "Red flags:",
        redFlags.length ? redFlags.map((x) => `- ${x}`).join("\n") : "- Severe weakness, heavy bleeding, chest pain, breathing problem, confusion, ya fainting ho to urgent care lein.",
        "",
        "When to see doctor:",
        "- Agar abnormal values clearly high/low hon.",
        "- Agar symptoms bhi saath me present hon.",
        "- Agar repeated reports me pattern abnormal aa raha ho.",
      ].join("\n"),
      ctx,
      redFlags
    );
  }

  if (focus === "rx" || focus === "medicine") {
    return postProcessReply(
      [
        "Assessment:",
        `- ${who} ke liye medicine/prescription ko simple language me explain kiya ja sakta hai.`,
        "- Isme use, common side effects, aur important cautions bataye ja sakte hain.",
        "- Jo cheez prescription me clearly visible nahi hogi usko guess nahi kiya jayega.",
        "",
        "Next steps:",
        "- Medicine ka naam aur strength share karein, jaise Paracetamol 650.",
        "- Prescription image clear bhejein.",
        "- Age, pregnancy, allergy, kidney/liver disease, aur current medicines bhi batayein agar relevant ho.",
        "",
        "Red flags:",
        redFlags.length ? redFlags.map((x) => `- ${x}`).join("\n") : "- Severe allergy, swelling, breathing issue, fainting, severe vomiting, black stools, ya severe drowsiness ho to urgent care lein.",
        "",
        "When to see doctor:",
        "- Agar medicine se relief na mile.",
        "- Agar side effects troublesome hon.",
        "- Agar dosage ya duration clear na ho.",
      ].join("\n"),
      ctx,
      redFlags
    );
  }

  return postProcessReply(
    [
      "Assessment:",
      `- ${who} ke symptoms ka simple first-level guidance diya ja sakta hai.`,
      "- Better answer ke liye age, symptom duration, severity, fever value, aur current medicines useful honge.",
      "",
      "Next steps:",
      "- Main symptom, kab se hai, kitna severe hai, yeh likhein.",
      "- Existing diseases aur medicines bhi share karein.",
      "- Agar fever/sugar/BP/oxygen reading hai to add karein.",
      "",
      "Red flags:",
      redFlags.length ? redFlags.map((x) => `- ${x}`).join("\n") : "- Severe chest pain, breathing trouble, confusion, seizures, fainting, severe dehydration, ya uncontrolled bleeding ho to urgent care lein.",
      "",
      "When to see doctor:",
      "- Agar symptoms worsen karein.",
      "- Agar 1-3 din me improve na ho.",
      "- Agar severe pain, weakness, ya persistent vomiting ho.",
    ].join("\n"),
    ctx,
    redFlags
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
      language: context?.language || "hinglish",
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

  let reply = "";
  const client = getOpenAIClient();
  const model = process.env.AI_CHAT_MODEL || process.env.GPT_MED_MODEL || "gpt-4o-mini";
  const temperature = clampTemperature(process.env.AI_TEMPERATURE || 0.55);

  if (client && baseUserMessage) {
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
        max_tokens: Number(process.env.AI_MAX_TOKENS || 1250),
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
  reply = postProcessReply(reply, resolvedContext, redFlags);

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