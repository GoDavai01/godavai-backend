// utils/sms.js
const axios = require("axios");

/**
 * Send OTP SMS via MSG91 using SMS v2 + DLT mapped template
 *
 * REQUIRED ENV VARS (Render):
 *   MSG91_AUTHKEY     -> your MSG91 auth key
 *   MSG91_SENDER      -> GDAVAI (exactly same as DLT header)
 *   MSG91_TEMPLATE_ID -> MSG91 **SMS** template ID (Verified by DLT)
 *                        e.g. 6922adf3907a27301f3e8272
 */
async function sendSmsMSG91(mobile, otp) {
  const authkey = process.env.MSG91_AUTHKEY;
  const sender = process.env.MSG91_SENDER;       // GDAVAI
  const templateId = process.env.MSG91_TEMPLATE_ID; // 6922adf3907a27301f3e8272

  if (!authkey || !sender || !templateId) {
    console.error(
      "MSG91 config missing. Need MSG91_AUTHKEY, MSG91_SENDER, MSG91_TEMPLATE_ID"
    );
    throw new Error("MSG91 configuration missing");
  }

  // ⚠️ Text MUST be EXACTLY SAME as DLT + MSG91 template
  // Go to Jio DLT -> open template -> copy content string exactly
  // Example (adjust only if tumhare DLT content mein kuch aur hai):
  const dltTemplateText =
    "Your GoDavaii OTP is ##var##. Please use this to verify your login on GoDavaii. - GoDavaii (Karniva Private Limited)";

  // Replace the variable with actual OTP
  const message = dltTemplateText.replace("##var##", otp);

  const cleanMobile = String(mobile).replace(/\D/g, "");
  const fullMobile = cleanMobile.startsWith("91")
    ? cleanMobile
    : "91" + cleanMobile;

  const payload = {
    sender,
    route: "4", // transactional
    country: "91",
    sms: [
      {
        message,
        to: [fullMobile],
      },
    ],
    // ⚠️ IMPORTANT: template_id ROOT level par
    template_id: templateId,
    // dlt_template_id yahan send karne ki zarurat nahi,
    // MSG91 apne panel se mapping handle karta hai
  };

  const headers = {
    authkey,
    "content-type": "application/json",
  };

  try {
    const res = await axios.post(
      "https://api.msg91.com/api/v2/sendsms",
      payload,
      { headers }
    );
    console.log("MSG91 SMS response:", JSON.stringify(res.data));

    if (res.data && res.data.type === "error") {
      throw new Error("MSG91 error: " + JSON.stringify(res.data));
    }
    return res.data;
  } catch (err) {
    console.error("MSG91 SMS failed:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendSmsMSG91 };
