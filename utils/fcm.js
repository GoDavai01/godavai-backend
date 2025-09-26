// utils/fcm.js
const axios = require("axios");

let _client = null;
async function getHttpV1Client() {
  if (_client) return _client;

  // Prefer an env var on Vercel (single JSON string).
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const sa = JSON.parse(raw);
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

  // Local/dev: use file path via GOOGLE_APPLICATION_CREDENTIALS
  // (google-auth-library will read the file automatically)
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const client = await auth.getClient();
  // If FIREBASE_PROJECT_ID is set, use it; otherwise ask the auth client.
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    (await auth.getProjectId?.()) ||
    process.env.GCLOUD_PROJECT;
  _client = { client, projectId };
  return _client;
}

/** HTTP v1 sender (one request per token) */
async function sendPushV1({ tokens, title, body, data }) {
  if (!Array.isArray(tokens) || tokens.length === 0) return;

  const { client, projectId } = await getHttpV1Client();
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const tasks = tokens.map((token) =>
    client
      .request({
        url,
        method: "POST",
        data: {
          message: {
            token,
            notification: { title, body },
            data: data || {},
            android: {
              priority: "HIGH",
              notification: { channel_id: "gd_orders" },
            },
          },
        },
      })
      .catch(() => null)
  );

  await Promise.allSettled(tasks);
}

/** Legacy fallback (only if FCM_SERVER_KEY is defined) */
async function sendPushLegacy({ tokens, title, body, data }) {
  const key = process.env.FCM_SERVER_KEY;
  if (!key || !Array.isArray(tokens) || tokens.length === 0) return;
  try {
    await axios.post(
      "https://fcm.googleapis.com/fcm/send",
      {
        registration_ids: tokens,
        notification: { title, body, android_channel_id: "gd_orders" },
        data: data || {},
        priority: "high",
      },
      {
        headers: {
          Authorization: `key=${key}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (_) {}
}

/** Unified export */
async function sendPush({ tokens, title, body, data }) {
  if (process.env.FCM_SERVER_KEY) return sendPushLegacy({ tokens, title, body, data });
  return sendPushV1({ tokens, title, body, data });
}

module.exports = { sendPush };
