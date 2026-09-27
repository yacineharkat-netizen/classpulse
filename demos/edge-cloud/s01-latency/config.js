// Settings shared by the phone page (index.html) and the dashboard (dashboard.html).
const LATENCY_CONFIG = {
  // Public MQTT broker over secure WebSocket (same as the IoT live demo).
  brokerUrl: "wss://broker.hivemq.com:8884/mqtt",
  topicRoot: "edge-usthb",
  defaultRoom: "ec-s1",

  // Where the students are (Algiers) - used for the "speed of light" minimum.
  origin: { name: "Algiers", lat: 36.75, lon: 3.06 },

  // Cloud regions to measure. Each URL answers quickly and is served from that region.
  // Any small HTTPS endpoint hosted in the region works; these are AWS regional endpoints.
  regions: [
    { key: "milan", label: "Milan", lat: 45.46, lon: 9.19, url: "https://dynamodb.eu-south-1.amazonaws.com/ping" },
    { key: "paris", label: "Paris", lat: 48.86, lon: 2.35, url: "https://dynamodb.eu-west-3.amazonaws.com/ping" },
    { key: "frankfurt", label: "Frankfurt", lat: 50.11, lon: 8.68, url: "https://dynamodb.eu-central-1.amazonaws.com/ping" },
    { key: "bahrain", label: "Bahrain", lat: 26.07, lon: 50.56, url: "https://dynamodb.me-south-1.amazonaws.com/ping" },
    { key: "virginia", label: "Virginia (USA)", lat: 39.04, lon: -77.49, url: "https://dynamodb.us-east-1.amazonaws.com/ping" },
    { key: "singapore", label: "Singapore", lat: 1.35, lon: 103.82, url: "https://dynamodb.ap-southeast-1.amazonaws.com/ping" },
  ],

  warmupRequests: 1,   // first request opens the connection (DNS + TCP + TLS): not counted
  measuredRequests: 5, // then the median of these requests is kept
  fiberSpeedKmPerMs: 200, // light in optical fiber: about 200 000 km/s
};

function latencyRoom() {
  const p = new URLSearchParams(window.location.search);
  return (p.get("room") || LATENCY_CONFIG.defaultRoom).replace(/[^a-zA-Z0-9_-]/g, "");
}

// Great-circle distance in km.
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Physical minimum round trip time (ms): there and back at the speed of light in fiber.
function minimumRttMs(region) {
  return (2 * distanceKm(LATENCY_CONFIG.origin, region)) / LATENCY_CONFIG.fiberSpeedKmPerMs;
}
