"use strict";

/**
 * analytics.js
 * Computes high-risk zones and system-wide analytics from Firestore detection records.
 */

/**
 * Groups detections by track_segment and computes risk scores.
 * @param {Array} detections - Array of Firestore detection objects
 * @returns {Array} zones sorted by risk_score descending
 */
function computeHighRiskZones(detections) {
  const zoneMap = {};

  detections.forEach((d) => {
    const seg = d.track_segment || "unknown";
    if (!zoneMap[seg]) {
      zoneMap[seg] = {
        track_segment: seg,
        detections: 0,
        critical_events: 0,
        medium_events: 0,
        labels: {},
        lat_sum: 0,
        lng_sum: 0,
        coord_count: 0,
        last_seen: null,
        risk_score: 0
      };
    }
    const z = zoneMap[seg];
    z.detections++;
    if (d.severity === "Critical") z.critical_events++;
    if (d.severity === "Medium") z.medium_events++;
    z.labels[d.label] = (z.labels[d.label] || 0) + 1;

    if (d.location?.lat && d.location?.lng) {
      z.lat_sum += Number(d.location.lat);
      z.lng_sum += Number(d.location.lng);
      z.coord_count++;
    }
    if (!z.last_seen || d.timestamp > z.last_seen) z.last_seen = d.timestamp;
  });

  return Object.values(zoneMap)
    .map((z) => {
      // Risk score: critical events weighted 10×, medium 3×, recency bonus
      const recencyMs = z.last_seen ? Date.now() - new Date(z.last_seen).getTime() : Infinity;
      const recencyBonus = recencyMs < 3600000 ? 20 : recencyMs < 86400000 ? 10 : 0;
      z.risk_score = Math.min(100, z.critical_events * 10 + z.medium_events * 3 + recencyBonus);
      z.centroid = z.coord_count > 0
        ? { lat: z.lat_sum / z.coord_count, lng: z.lng_sum / z.coord_count }
        : null;
      z.dominant_label = Object.entries(z.labels).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
      // Clean up internal helpers
      delete z.lat_sum;
      delete z.lng_sum;
      delete z.coord_count;
      delete z.labels;
      return z;
    })
    .filter((z) => z.risk_score > 0)
    .sort((a, b) => b.risk_score - a.risk_score);
}

/**
 * Computes fleet-wide analytics metrics.
 */
function computeAnalytics(detections) {
  const total = detections.length;
  const critical = detections.filter((d) => d.severity === "Critical").length;
  const medium = detections.filter((d) => d.severity === "Medium").length;
  const low = detections.filter((d) => d.severity === "Low").length;

  const byLabel = {};
  detections.forEach((d) => {
    byLabel[d.label] = (byLabel[d.label] || 0) + 1;
  });

  const segments = [...new Set(detections.map((d) => d.track_segment))];
  // Estimate km scanned: assume each segment ≈ 2 km, each detection covers 200 m
  const kmScanned = segments.length * 2;
  const defectsPerKm = kmScanned > 0 ? Number(((critical + medium) / kmScanned).toFixed(2)) : 0;

  // Lives-saved estimate: each Critical detection that was acted on = 1 life saved
  const livesSaved = detections.reduce((acc, d) => acc + (d.lives_saved_estimate || 0), 0);

  // Time-series: group by hour
  const hourly = {};
  detections.forEach((d) => {
    if (!d.timestamp) return;
    const h = new Date(d.timestamp).toISOString().slice(0, 13) + ":00:00Z";
    if (!hourly[h]) hourly[h] = { hour: h, total: 0, critical: 0 };
    hourly[h].total++;
    if (d.severity === "Critical") hourly[h].critical++;
  });

  return {
    total_detections: total,
    critical_count: critical,
    medium_count: medium,
    low_count: low,
    segments_monitored: segments.length,
    km_scanned: kmScanned,
    defects_per_km: defectsPerKm,
    lives_saved: livesSaved,
    detection_breakdown: byLabel,
    hourly_trend: Object.values(hourly).sort((a, b) => a.hour.localeCompare(b.hour))
  };
}

module.exports = { computeHighRiskZones, computeAnalytics };
