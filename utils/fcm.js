// utils/fcm.js
const axios = require("axios");

let _client = null;

async function getHttpV1Client() {
  if (_client) return _client;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    let sa;
    try { sa = JSON.parse(raw); } catch { throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT JSON"); }
    if (sa.private_key && sa.private_key.includes("\\n")) sa.private_key = sa.private_key.replace(/\\n/g, "\n");

    const { GoogleAuth } = require("google-auth-library");
    const auth = new GoogleAuth({
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
      projectId: sa.project_id,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    _client = { client, projectId: sa.project_id };
    return _client;
  }

  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
  const client = await auth.getClient();
  const projectId = process.env.FIREBASE_PROJECT_ID || (await auth.getProjectId?.()) || process.env.GCLOUD_PROJECT;
  _client = { client, projectId };
  return _client;
}

function toStringData(obj) {
  return Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, String(v)]));
}

// HTTP v1 (preferred)
async function sendPushV1({ tokens, title, body, data }) {
  if (!Array.isArray(tokens) || tokens.length === 0) return;
  const safeData = toStringData(data);
  const { client, projectId } = await getHttpV1Client();
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const payloadBase = {
    notification: { title: String(title || ""), body: String(body || "") },
    data: safeData,
    android: {
      priority: "HIGH",
      ttl: "86400s",
      notification: {
        channel_id: "gd_orders",
        sound: "default",
        default_sound: true,
        default_vibrate_timings: true,
        vibrate_timings: ["0.1s", "0.08s", "0.1s", "0.08s", "0.3s"],
        visibility: "PUBLIC",
      },
    },
  };

  await Promise.allSettled(
    tokens.map((token) =>
      client
        .request({ url, method: "POST", data: { message: { token, ...payloadBase } } })
        .catch(() => null)
    )
  );
}

// Legacy HTTP (server key)
async function sendPushLegacy({ tokens, title, body, data }) {
  const key = process.env.FCM_SERVER_KEY;
  if (!key || !Array.isArray(tokens) || tokens.length === 0) return;

  const safeData = toStringData(data);
  try {
    await axios.post(
      "https://fcm.googleapis.com/fcm/send",
      {
        registration_ids: tokens,
        notification: {
          title: String(title || ""),
          body: String(body || ""),
          android_channel_id: "gd_orders",
          sound: "default",
        },
        data: safeData,
        priority: "high",
        content_available: true,
        time_to_live: 86400,
      },
      { headers: { Authorization: `key=${key}`, "Content-Type": "application/json" } }
    );
  } catch {}
}

async function sendPush({ tokens, title, body, data }) {
  if (process.env.FCM_SERVER_KEY) return sendPushLegacy({ tokens, title, body, data });
  return sendPushV1({ tokens, title, body, data });
}

module.exports = { sendPush };
