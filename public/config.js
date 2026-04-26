/**
 * AI Sentinel – Browser Configuration
 *
 * ── FOR LOCAL / DEMO USE ───────────────────────────────────────────────────────
 * The app works 100% without any credentials in demo mode.
 * All detection, analytics, maps, and reports run with mock data.
 *
 * ── FOR PRODUCTION ────────────────────────────────────────────────────────────
 * Replace YOUR_* values with real credentials from:
 *   Firebase Console → Project Settings → Web App
 *   Google Cloud Console → APIs & Services → Credentials
 *
 * Google Maps: Add a real key below to enable the interactive map.
 * NEVER commit real API keys to source control.
 */
window.AI_SENTINEL_CONFIG = {
  firebase: {
    apiKey: "YOUR_FIREBASE_WEB_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_WEB_APP_ID"
  },

  // ── Google Maps JavaScript API key (browser-restricted) ──────────────────
  // Leave as "YOUR_GOOGLE_MAPS_BROWSER_KEY" to skip Maps and use demo mode.
  // Get a key: https://console.cloud.google.com/apis/credentials
  googleMapsApiKey: "YOUR_GOOGLE_MAPS_BROWSER_KEY",

  // Default map center (New Delhi – Indian Railways HQ)
  defaultCenter: { lat: 28.6139, lng: 77.2090 },

  // Firebase Web Push VAPID key (for FCM browser push notifications)
  fcmVapidKey: "YOUR_FIREBASE_WEB_PUSH_VAPID_KEY"
};

// Safety guard – ensure config is always an object even if this file fails to load
if (typeof window.AI_SENTINEL_CONFIG === "undefined") {
  window.AI_SENTINEL_CONFIG = { firebase: {}, googleMapsApiKey: "", defaultCenter: { lat: 28.6139, lng: 77.2090 }, fcmVapidKey: "" };
}
