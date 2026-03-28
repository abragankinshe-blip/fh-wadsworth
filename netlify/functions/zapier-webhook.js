// netlify/functions/zapier-webhook.js
const https = require("https");

const JSONBIN_KEY = process.env.JSONBIN_KEY;
const JSONBIN_BIN = process.env.JSONBIN_BIN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function jsonbinRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.jsonbin.io",
      port: 443,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY,
        "X-Bin-Versioning": "false",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ record: [] }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function genId() { return "z" + Date.now() + Math.random().toString(36).slice(2, 6); }
function todayStr() { return new Date().toISOString().split("T")[0]; }

function guessPriority(subject = "", body = "") {
  const t = (subject + " " + body).toLowerCase();
  if (t.match(/urgent|asap|rush|immediate/)) return "High";
  if (t.match(/whenever|no rush|low priority/)) return "Low";
  return "Medium";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  if (WEBHOOK_SECRET) {
    const tok = event.headers["x-webhook-secret"] || event.headers["X-Webhook-Secret"];
    if (tok !== WEBHOOK_SECRET) return { statusCode: 401, body: "Unauthorized" };
  }

  if (!JSONBIN_KEY || !JSONBIN_BIN) return { statusCode: 500, body: "Missing env vars." };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const newOrder = {
    id: genId(),
    date: payload.date ? new Date(payload.date).toISOString().split("T")[0] : todayStr(),
    client: payload.from_name || payload.from_email || payload.client || "Unknown Sender",
    subject: payload.subject || payload.description || "(No subject)",
    type: payload.type || "Order",
    member: payload.assigned_to || "VJ",
    status: payload.status || "Order Confirmed",
    priority: payload.priority || guessPriority(payload.subject, payload.body_plain),
    followup: payload.followup || "",
    notes: payload.body_plain || payload.notes || "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "zapier",
  };

  let currentOrders = [];
  try {
    const res = await jsonbinRequest("GET", `/v3/b/${JSONBIN_BIN}/latest`, null);
    currentOrders = Array.isArray(res.record) ? res.record : [];
  } catch (e) { console.error("GET failed:", e); }

  try {
    await jsonbinRequest("PUT", `/v3/b/${JSONBIN_BIN}`, [newOrder, ...currentOrders]);
  } catch (e) {
    console.error("PUT failed:", e);
    return { statusCode: 500, body: "Failed to save order" };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, order: newOrder }),
  };
};
