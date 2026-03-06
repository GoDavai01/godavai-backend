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
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0.4, Math.min(0.7, n));
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
    "You are GoDavaii AI, a careful health assistant.",
    `Language preference: ${ctx.language}.`,
    `Audience: ${ctx.whoFor} (${whoLabel}). Focus: ${ctx.focus}.`,
    `Context vault enabled: ${ctx?.vault?.enabled ? "yes" : "no"}.`,
    profileBits.length ? `Context data: ${profileBits.join(" | ")}` : "Context data: limited.",
    "If extracted file text is provided in the user message, treat that as observed file content.",
    "Do not say you cannot see files/images when extracted content is present.",
    "If report values are available, explain in simple non-technical Hinglish/English based on language preference.",
    "Use short bullets and plain words so a non-medical user understands quickly.",
    "Never invent missing report values. If value is unavailable, explicitly say 'not visible in report'.",
    "Do not use markdown formatting symbols like **, __, #, or code blocks.",
    "Always provide practical triage guidance, do not claim final diagnosis.",
    "Always answer in these exact sections and in this order:",
    "Assessment:",
    "Next steps:",
    "Red flags:",
    "When to see doctor:",
    "Keep advice concise, actionable, and safety-first.",
  ].join("\n");
}

function sanitizeReplyFormatting(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/`{1,3}/g, "")
    .trim();
}

function buildFallbackReply(message, ctx, redFlags) {
  const who = ctx.whoForLabel || (ctx.whoFor === "self" ? "you" : ctx.whoFor);
  const core = `For ${who}, I need a bit more detail to be precise. Current query: ${message || "No message."}`;
  return ensureStructuredSections(core, { redFlags });
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
  const recalledAttachment = attachment ? null : await getRecentAttachmentContext({ userId, context: resolvedContext });
  const userMessage = recalledAttachment
    ? [
        baseUserMessage,
        "",
        `Previous uploaded file in this chat: ${recalledAttachment.name}`,
        "Use this extracted text context for continuity:",
        recalledAttachment.text,
      ].join("\n")
    : baseUserMessage;

  const redFlags = detectRedFlags([baseUserMessage, ...cleanHistory.map((m) => m.content)].join("\n"));

  let reply = "";
  const client = getOpenAIClient();
  const model = process.env.AI_CHAT_MODEL || process.env.GPT_MED_MODEL || "gpt-4o-mini";
  const temperature = clampTemperature(process.env.AI_TEMPERATURE || 0.6);

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
        max_tokens: Number(process.env.AI_MAX_TOKENS || 700),
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
