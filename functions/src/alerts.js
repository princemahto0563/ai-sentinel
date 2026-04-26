"use strict";

/**
 * alerts.js
 * Sends Firebase Cloud Messaging (FCM) push notifications for safety events.
 */

const admin = require("firebase-admin");

const FCM_TOPIC = process.env.FCM_TOPIC || "railway-emergency-alerts";

/**
 * Sends an FCM push notification for a detection event.
 * @param {string|null} fcmToken - Browser token (optional)
 * @param {object} detection - Full detection document
 */
async function sendEmergencyAlert(fcmToken, detection) {
  const { label, track_segment, severity, suggested_action, confidence } = detection;
  const confPct = Math.round((confidence || 0) * 100);

  const title = severity === "Critical"
    ? `🚨 EMERGENCY BRAKE ALERT — Segment ${track_segment}`
    : `⚠️ Safety Warning — Segment ${track_segment}`;

  const body = `${label} detected (${confPct}% confidence). ${suggested_action?.slice(0, 100) || ""}`;

  const baseMessage = {
    notification: { title, body },
    data: {
      detection_id: detection.id || "",
      label,
      severity,
      track_segment: track_segment || "",
      confidence: String(confidence || 0),
      lat: String(detection.location?.lat || 0),
      lng: String(detection.location?.lng || 0)
    },
    android: {
      priority: severity === "Critical" ? "high" : "normal",
      notification: { channelId: "railway_alerts", priority: "max", defaultSound: true }
    },
    apns: {
      payload: { aps: { sound: "default", badge: 1, contentAvailable: true } }
    },
    webpush: {
      notification: { requireInteraction: severity === "Critical" },
      headers: { Urgency: severity === "Critical" ? "high" : "normal" }
    }
  };

  const sends = [];

  // Send to specific device token if provided
  if (fcmToken && fcmToken.length > 20) {
    sends.push(
      admin.messaging().send({ ...baseMessage, token: fcmToken })
        .then(() => console.log(`[FCM] token alert sent for ${detection.id}`))
        .catch((err) => console.warn("[FCM] token send failed:", err.message))
    );
  }

  // Always broadcast to topic for fleet-wide alerts
  sends.push(
    admin.messaging().send({ ...baseMessage, topic: FCM_TOPIC })
      .then(() => console.log(`[FCM] topic alert sent: ${FCM_TOPIC}`))
      .catch((err) => console.warn("[FCM] topic send failed:", err.message))
  );

  await Promise.allSettled(sends);
}

module.exports = { sendEmergencyAlert };
