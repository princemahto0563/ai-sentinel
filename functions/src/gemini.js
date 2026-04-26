"use strict";

/**
 * gemini.js
 * Classifies detections and generates reports using Google Gemini.
 * Falls back to a deterministic rule engine when the API key is unavailable.
 */

const { GoogleGenerativeAI } = require("@google/genai");

const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Classifies a detection and returns { severity, technical_report, suggested_action, model_used }.
 */
async function classifyWithGemini(imageBase64, mimeType, prediction, track_segment) {
  const client = getGeminiClient();
  if (!client) {
    return ruleBasedClassification(prediction, track_segment);
  }

  const { label, confidence, bounding_boxes } = prediction;
  const bboxCount = bounding_boxes?.length || 0;
  const confPct = Math.round(confidence * 100);

  const prompt = `
You are a senior railway safety AI integrated into India's national rail network.

Detection result from Vertex AI:
- Label: ${label}
- Confidence: ${confPct}%
- Bounding boxes detected: ${bboxCount}
- Track segment: ${track_segment}

Based on this detection, respond ONLY with valid JSON (no markdown, no code fences):
{
  "severity": "<Critical|Medium|Low>",
  "technical_report": "<2-3 sentence technical report for the railway safety officer>",
  "suggested_action": "<Specific operational action to take immediately>"
}

Severity guidelines:
- Critical: Crack >80% confidence, Missing Fishplate, Obstacle on live track
- Medium: Crack 60-80% confidence, surface defects
- Low: Normal track, minor anomalies, confidence <60%
`.trim();

  try {
    const model = client.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: { mimeType, data: imageBase64 }
            },
            { text: prompt }
          ]
        }
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 }
    });

    const text = result.response?.text?.() || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      severity: parsed.severity || "Low",
      technical_report: parsed.technical_report || "",
      suggested_action: parsed.suggested_action || "",
      model_used: MODEL
    };
  } catch (err) {
    console.warn("[classifyWithGemini] API error, falling back to rules:", err.message);
    return ruleBasedClassification(prediction, track_segment);
  }
}

/**
 * Generates a natural-language analytics report over recent detections.
 */
async function generateGeminiReport(query, detections) {
  const client = getGeminiClient();
  if (!client) {
    return generateRuleBasedReport(query, detections);
  }

  const summary = buildDetectionSummary(detections);

  const prompt = `
You are the Chief Railway Safety AI for India's rail network (7000+ stations, 23 million daily passengers).
You have access to the following recent detection data:

${summary}

User query: "${query}"

Write a concise professional safety report answering the query. Include:
- Specific segment names and counts
- Risk trends if relevant
- Recommended actions
- End with "Estimated lives at risk: N" if the situation is Critical

Keep it under 250 words.
`.trim();

  try {
    const model = client.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    return result.response?.text?.() || "Report generation failed.";
  } catch (err) {
    console.warn("[generateGeminiReport] falling back:", err.message);
    return generateRuleBasedReport(query, detections);
  }
}

// ── Rule-based fallbacks ────────────────────────────────────────────────────

function ruleBasedClassification(prediction, track_segment) {
  const { label, confidence } = prediction;
  let severity = "Low";

  if (label === "Crack" && confidence >= 0.8) severity = "Critical";
  else if (label === "Missing Fishplate") severity = "Critical";
  else if (label === "Obstacle") severity = "Critical";
  else if (label === "Crack" && confidence >= 0.6) severity = "Medium";
  else if (label !== "Normal") severity = "Medium";

  const reports = {
    Critical: {
      Crack: {
        technical_report: `Critical track fracture detected at Segment ${track_segment} with ${Math.round(confidence * 100)}% confidence. Structural integrity compromised. Immediate intervention required.`,
        suggested_action: "Emergency Brake Alert. Halt all train movement on this segment. Dispatch track engineering crew immediately. Do not resume operations until cleared."
      },
      "Missing Fishplate": {
        technical_report: `Missing fishplate detected at Segment ${track_segment}. Rail joint unsecured — high derailment risk at train speeds above 20 km/h.`,
        suggested_action: "Impose emergency speed restriction. Dispatch maintenance crew within 30 minutes. Block segment for passenger trains."
      },
      Obstacle: {
        technical_report: `Foreign obstacle detected on track at Segment ${track_segment}. Immediate collision risk for approaching trains.`,
        suggested_action: "Emergency Brake Alert. Halt trains on approach corridor. Dispatch track patrol to identify and remove obstacle."
      }
    }
  };

  const criticalData = severity === "Critical" ? (reports.Critical[label] || reports.Critical.Crack) : null;

  return {
    severity,
    technical_report: criticalData?.technical_report ||
      `${label} detected at Segment ${track_segment} with ${Math.round(confidence * 100)}% confidence. Schedule inspection during next maintenance window.`,
    suggested_action: criticalData?.suggested_action ||
      (severity === "Medium"
        ? `Reduce train speed on Segment ${track_segment}. Schedule inspection within 24 hours.`
        : "Log for routine inspection. No immediate action required."),
    model_used: "rule-fallback"
  };
}

function buildDetectionSummary(detections) {
  if (!detections.length) return "No detections available.";

  const bySegment = {};
  detections.forEach((d) => {
    if (!bySegment[d.track_segment]) bySegment[d.track_segment] = [];
    bySegment[d.track_segment].push(d);
  });

  const lines = Object.entries(bySegment)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .map(([seg, items]) => {
      const critical = items.filter((i) => i.severity === "Critical").length;
      return `- Segment ${seg}: ${items.length} detections, ${critical} critical`;
    });

  return `Total detections: ${detections.length}\n${lines.join("\n")}`;
}

function generateRuleBasedReport(query, detections) {
  const critical = detections.filter((d) => d.severity === "Critical");
  const segments = [...new Set(critical.map((d) => d.track_segment))];
  return (
    `[Gemini unavailable — Rule-based report]\n\n` +
    `Query: "${query}"\n\n` +
    `Total detections analysed: ${detections.length}\n` +
    `Critical events: ${critical.length}\n` +
    `Segments with critical events: ${segments.join(", ") || "none"}\n\n` +
    `Recommendation: Prioritise inspection of segments with repeated critical events.`
  );
}

module.exports = { classifyWithGemini, generateGeminiReport };
