const User = require("../models/User");
const HealthProfile = require("../models/HealthProfile");

function normalizeContext(input) {
  const ctx = input && typeof input === "object" ? input : {};
  return {
    whoFor: ["self", "family", "new"].includes(ctx.whoFor) ? ctx.whoFor : "self",
    whoForLabel: String(ctx.whoForLabel || "").trim(),
    language: ["hinglish", "hi", "en"].includes(ctx.language) ? ctx.language : "hinglish",
    focus: ["auto", "symptom", "medicine", "rx", "lab"].includes(ctx.focus) ? ctx.focus : "auto",
    userSummary: ctx.userSummary && typeof ctx.userSummary === "object" ? ctx.userSummary : {},
    consentToUseVault: Boolean(
      ctx.consentToUseVault ||
      ctx.vaultConsent ||
      ctx.userConsent === true ||
      (ctx.userConsent && ctx.userConsent.vault === true)
    ),
  };
}

async function buildHealthContext({ userId, context }) {
  const ctx = normalizeContext(context);
  const out = {
    ...ctx,
    vault: { enabled: false, reason: "consent_required" },
  };

  if (!userId || !ctx.consentToUseVault) return out;

  if (ctx.whoFor === "self") {
    const user = await User.findById(userId)
      .select("_id name dob gender email mobile")
      .lean();
    out.userSummary = {
      ...ctx.userSummary,
      id: user?._id || ctx.userSummary.id || null,
      name: user?.name || ctx.userSummary.name || null,
      dob: user?.dob || ctx.userSummary.dob || null,
      gender: user?.gender || ctx.userSummary.gender || null,
      email: user?.email || ctx.userSummary.email || null,
      mobile: user?.mobile || null,
    };
    out.vault = { enabled: true, source: "user" };
    return out;
  }

  if (ctx.whoFor === "family") {
    if (!ctx.whoForLabel) {
      out.vault = { enabled: false, reason: "missing_family_label" };
      return out;
    }

    const profile = await HealthProfile.findOne({
      ownerUserId: userId,
      label: ctx.whoForLabel,
    }).lean();

    if (!profile) {
      out.vault = { enabled: false, reason: "family_profile_not_found" };
      return out;
    }
    if (!profile.vaultConsent) {
      out.vault = { enabled: false, reason: "family_profile_no_consent" };
      return out;
    }

    out.healthProfile = {
      id: profile._id,
      label: profile.label,
      relation: profile.relation,
      dob: profile.dob,
      gender: profile.gender,
      conditions: profile.conditions || [],
      medications: profile.medications || [],
      allergies: profile.allergies || [],
    };
    out.vault = { enabled: true, source: "family_profile" };
  }

  return out;
}

module.exports = {
  buildHealthContext,
};

