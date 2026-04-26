#!/usr/bin/env node
/**
 * seed-firestore.js
 * Seeds Firestore with sample detection events from high_load_events.jsonl
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node seed-firestore.js
 *   (or run from inside a Cloud Shell where ADC is already configured)
 *
 * For local emulator:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node seed-firestore.js
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Initialize
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  admin.initializeApp(); // Uses ADC / emulator
}

const db = admin.firestore();

async function seed() {
  const jsonlPath = path.join(__dirname, "high_load_events.jsonl");
  if (!fs.existsSync(jsonlPath)) {
    console.error("high_load_events.jsonl not found");
    process.exit(1);
  }

  const lines = fs.readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
  const batch = db.batch();
  let count = 0;

  for (const line of lines) {
    const doc = JSON.parse(line);
    const ref = db.collection("detections").doc(doc.id);
    const ts = doc.timestamp ? new Date(doc.timestamp) : new Date();
    batch.set(ref, { ...doc, timestamp: admin.firestore.Timestamp.fromDate(ts) });
    count++;
  }

  await batch.commit();
  console.log(`✅ Seeded ${count} detection records into Firestore.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
