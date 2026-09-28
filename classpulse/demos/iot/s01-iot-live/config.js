// Shared settings for the phone page (index.html) and the dashboard (dashboard.html).
// Change them here once; both pages read this file.

const DEMO_CONFIG = {
  // Public MQTT broker reachable from a browser (MQTT over secure WebSocket).
  // Alternatives if this one is down or slow (test them during the rehearsal):
  //   "wss://broker.emqx.io:8084/mqtt"
  //   "wss://test.mosquitto.org:8081"
  brokerUrl: "wss://broker.hivemq.com:8884/mqtt",

  // Every topic starts with this prefix. The room name keeps our demo apart from
  // other people using the same public broker. Override it with ?room=xxx in the URL.
  topicRoot: "iot-usthb",
  defaultRoom: "s1-2026",

  // Phone sending rate: fast while moving, slow heartbeat while still.
  fastPeriodMs: 250,
  slowPeriodMs: 2000,
  movingThreshold: 0.6, // m/s^2 above which the phone counts as "moving"

  // The dashboard forgets a phone after this much silence.
  phoneTimeoutMs: 8000,

  // Number of rows offered on the phone page (for the stadium wave).
  rows: 12,
};

function demoRoom() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("room") || DEMO_CONFIG.defaultRoom).replace(/[^a-zA-Z0-9_-]/g, "");
}

function demoBroker() {
  const params = new URLSearchParams(window.location.search);
  return params.get("broker") || DEMO_CONFIG.brokerUrl;
}
