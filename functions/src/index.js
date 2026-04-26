"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

setGlobalOptions({ region: "us-central1", memory: "512MiB", timeoutSeconds: 120 });

const { predictWithVertexAI } = require("./vertexAi");
const { generateGeminiReport, classifyWithGemini } = require("./gemini");
const { computeHighRiskZones, computeAnalytics } = require("./analytics");
const { sendEmergencyAlert } = require("./alerts");
const { v4: uuidv4 } = require("uuid");

const cors = (res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

// ─── POST /detectImage ────────────────────────────────────────────────────────
exports.detectImage = onRequest(
  { secrets: ["GEMINI_API_KEY"], cors: true },
  async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const {
        imageBase64,
        mimeType = "image/jpeg",
        source = "CCTV",
        track_segment = "unknown",
        location = { lat: 0, lng: 0 },
        metadata = {},
        fcmToken
      } = req.body;

      if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

      // 1. Vertex AI prediction
      const prediction = await predictWithVertexAI(imageBase64, mimeType);

      // 2. Gemini classification & report
      const geminiResult = await classifyWithGemini(
        imageBase64,
        mimeType,
        prediction,
        track_segment
      );

      // 3. Build detection document
      const id = uuidv4();
      const imageBuffer = Buffer.from(imageBase64, "base64");
      const imageFile = bucket.file(`detections/${id}.jpg`);
      await imageFile.save(imageBuffer, {
        metadata: { contentType: mimeType },
        resumable: false
      });
      const image_url = `gs://${bucket.name}/detections/${id}.jpg`;

      const detection = {
        id,
        image_url,
        source,
        track_segment,
        label: prediction.label,
        raw_label: prediction.label,
        confidence: prediction.confidence,
        bounding_boxes: prediction.bounding_boxes || [],
        location: {
          lat: Number(location.lat) || 0,
          lng: Number(location.lng) || 0
        },
        severity: geminiResult.severity,
        suggested_action: geminiResult.suggested_action,
        technical_report: geminiResult.technical_report,
        decision_model: geminiResult.model_used,
        metadata: {
          ...metadata,
          submitted_from: metadata.submitted_from || "api"
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        lives_saved_estimate: geminiResult.severity === "Critical" ? 1 : 0
      };

      // 4. Store in Firestore
      await db.collection("detections").doc(id).set(detection);

      // 5. Send FCM alert for Critical/Medium
      if (geminiResult.severity === "Critical" || geminiResult.severity === "Medium") {
        await sendEmergencyAlert(fcmToken, detection);
      }

      // Return (convert serverTimestamp to ISO string for response)
      return res.status(200).json({ ...detection, timestamp: new Date().toISOString() });

    } catch (err) {
      console.error("[detectImage]", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }
);

// ─── GET /getHistory ──────────────────────────────────────────────────────────
exports.getHistory = onRequest({ cors: true }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.sendStatus(204);

  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const severity = req.query.severity;
    const segment = req.query.segment;
    const hours = Number(req.query.hours) || 0;

    let query = db.collection("detections").orderBy("timestamp", "desc");

    if (severity) query = query.where("severity", "==", severity);
    if (segment) query = query.where("track_segment", "==", segment);
    if (hours > 0) {
      const since = new Date(Date.now() - hours * 3600 * 1000);
      query = query.where("timestamp", ">=", since);
    }

    query = query.limit(limit);
    const snap = await query.get();

    const records = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        ...d,
        timestamp: d.timestamp?.toDate?.()?.toISOString() || null
      };
    });

    return res.status(200).json(records);
  } catch (err) {
    console.error("[getHistory]", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /getHighRiskZones ────────────────────────────────────────────────────
exports.getHighRiskZones = onRequest({ cors: true }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.sendStatus(204);

  try {
    const hours = Number(req.query.hours) || 72;
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const snap = await db
      .collection("detections")
      .where("timestamp", ">=", since)
      .get();

    const detections = snap.docs.map((doc) => {
      const d = doc.data();
      return { ...d, timestamp: d.timestamp?.toDate?.()?.toISOString() || null };
    });

    const zones = computeHighRiskZones(detections);
    return res.status(200).json(zones);
  } catch (err) {
    console.error("[getHighRiskZones]", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /generateReport ─────────────────────────────────────────────────────
exports.generateReport = onRequest(
  { secrets: ["GEMINI_API_KEY"], cors: true },
  async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: "query is required" });

      // Fetch last 200 detections for context
      const snap = await db
        .collection("detections")
        .orderBy("timestamp", "desc")
        .limit(200)
        .get();

      const detections = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          timestamp: d.timestamp?.toDate?.()?.toISOString() || null,
          track_segment: d.track_segment,
          label: d.label,
          confidence: d.confidence,
          severity: d.severity,
          location: d.location
        };
      });

      const answer = await generateGeminiReport(query, detections);
      return res.status(200).json({ answer });
    } catch (err) {
      console.error("[generateReport]", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /getAnalytics ────────────────────────────────────────────────────────
exports.getAnalytics = onRequest({ cors: true }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.sendStatus(204);

  try {
    const hours = Number(req.query.hours) || 168; // default 7 days
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const snap = await db.collection("detections").where("timestamp", ">=", since).get();

    const detections = snap.docs.map((doc) => {
      const d = doc.data();
      return { ...d, timestamp: d.timestamp?.toDate?.()?.toISOString() || null };
    });

    const analytics = computeAnalytics(detections);
    return res.status(200).json(analytics);
  } catch (err) {
    console.error("[getAnalytics]", err);
    return res.status(500).json({ error: err.message });
  }
});
