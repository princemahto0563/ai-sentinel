// AI Sentinel – Firebase Cloud Messaging Service Worker
// Handles background push notifications when the app is not in the foreground.

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
importScripts("/config.js");

firebase.initializeApp(self.AI_SENTINEL_CONFIG.firebase);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "🚨 AI Sentinel Alert";
  const body = payload.notification?.body || "Railway safety event detected.";
  const severity = payload.data?.severity || "Low";

  const options = {
    body,
    icon: "/assets/rail-icon.png",
    badge: "/assets/rail-icon.png",
    tag: `sentinel-${payload.data?.detection_id || Date.now()}`,
    requireInteraction: severity === "Critical",
    data: payload.data || {},
    actions: [
      { action: "view", title: "View Dashboard" },
      { action: "dismiss", title: "Dismiss" }
    ]
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "view" || !event.action) {
    event.waitUntil(clients.openWindow("/"));
  }
});
