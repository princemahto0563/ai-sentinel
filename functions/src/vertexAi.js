"use strict";

/**
 * vertexAi.js
 * Sends an image to a Vertex AI AutoML Image Object Detection endpoint.
 * Falls back to a deterministic rule-based predictor when the env variable
 * VERTEX_AI_ENDPOINT_ID is not set (local development / demo mode).
 */

const { PredictionServiceClient } = require("@google-cloud/aiplatform").v1;
const { helpers } = require("@google-cloud/aiplatform");

const LOCATION = process.env.VERTEX_AI_LOCATION || "us-central1";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const ENDPOINT_ID = process.env.VERTEX_AI_ENDPOINT_ID || "";
const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD) || 0.65;

// Instantiate once (module-level singleton)
let _client = null;
function getPredictionClient() {
  if (!_client) {
    _client = new PredictionServiceClient({
      apiEndpoint: `${LOCATION}-aiplatform.googleapis.com`
    });
  }
  return _client;
}

/**
 * Run image through Vertex AI endpoint.
 * @param {string} imageBase64 - Raw base64 string (no data-uri prefix)
 * @param {string} mimeType    - e.g. "image/jpeg"
 * @returns {{ label, confidence, bounding_boxes }}
 */
async function predictWithVertexAI(imageBase64, mimeType = "image/jpeg") {
  // ── Demo / local fallback ────────────────────────────────────────────────────
  if (!ENDPOINT_ID || ENDPOINT_ID === "YOUR_VERTEX_ENDPOINT_ID") {
    return simulatePrediction(imageBase64);
  }

  // ── Real Vertex AI call ──────────────────────────────────────────────────────
  const client = getPredictionClient();
  const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/endpoints/${ENDPOINT_ID}`;

  // AutoML Vision format: { content: "<base64>" }
  const instance = helpers.toValue({ content: imageBase64 });
  const parameters = helpers.toValue({ confidenceThreshold: CONFIDENCE_THRESHOLD, maxPredictions: 10 });

  const [response] = await client.predict({
    endpoint,
    instances: [instance],
    parameters
  });

  const predictions = response.predictions || [];
  return normalizePredictions(predictions);
}

/**
 * Normalize Vertex AI AutoML prediction payload to our schema.
 */
function normalizePredictions(predictions) {
  if (!predictions.length) {
    return { label: "Normal", confidence: 1.0, bounding_boxes: [] };
  }

  // Vertex AutoML returns { displayNames, confidences, bboxes }
  let bestLabel = "Normal";
  let bestConf = 0;
  const bounding_boxes = [];

  predictions.forEach((pred) => {
    const raw = pred.structValue ? pred.structValue.fields : {};
    const displayNames = raw.displayNames?.listValue?.values?.map((v) => v.stringValue) || [];
    const confidences = raw.confidences?.listValue?.values?.map((v) => v.numberValue) || [];
    const bboxes = raw.bboxes?.listValue?.values || [];

    displayNames.forEach((name, i) => {
      const conf = confidences[i] || 0;
      const bbox = bboxes[i]?.listValue?.values?.map((v) => v.numberValue) || [];
      bounding_boxes.push({
        label: name,
        confidence: conf,
        // Vertex returns [yMin, xMin, yMax, xMax] normalised 0-1
        x: bbox[1] || 0,
        y: bbox[0] || 0,
        width: (bbox[3] || 0) - (bbox[1] || 0),
        height: (bbox[2] || 0) - (bbox[0] || 0)
      });
      if (conf > bestConf) {
        bestConf = conf;
        bestLabel = name;
      }
    });
  });

  return {
    label: bestLabel || "Normal",
    confidence: bestConf || 1.0,
    bounding_boxes
  };
}

/**
 * Deterministic demo simulator — mimics real Vertex output without network call.
 * Analyses basic image properties to produce varied, realistic outputs.
 */
function simulatePrediction(imageBase64) {
  // Use a hash of the first 100 bytes to vary output per image
  const seed = [...imageBase64.slice(0, 100)].reduce(
    (acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff,
    7
  );

  const scenarios = [
    {
      label: "Crack",
      confidence: 0.89 + (seed % 10) * 0.01,
      bounding_boxes: [{ label: "Crack", confidence: 0.89, x: 0.12, y: 0.28, width: 0.44, height: 0.08 }]
    },
    {
      label: "Missing Fishplate",
      confidence: 0.78 + (seed % 15) * 0.01,
      bounding_boxes: [{ label: "Missing Fishplate", confidence: 0.78, x: 0.35, y: 0.45, width: 0.2, height: 0.15 }]
    },
    {
      label: "Obstacle",
      confidence: 0.82 + (seed % 12) * 0.01,
      bounding_boxes: [{ label: "Obstacle", confidence: 0.82, x: 0.42, y: 0.32, width: 0.18, height: 0.22 }]
    },
    {
      label: "Normal",
      confidence: 0.95 + (seed % 5) * 0.01,
      bounding_boxes: []
    }
  ];

  // Weight towards crack for demo impact
  const weights = [5, 2, 2, 1];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let pick = seed % totalWeight;
  let chosen = scenarios[0];
  for (let i = 0; i < scenarios.length; i++) {
    if (pick < weights[i]) { chosen = scenarios[i]; break; }
    pick -= weights[i];
  }

  return chosen;
}

module.exports = { predictWithVertexAI };
