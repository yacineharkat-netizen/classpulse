// Settings shared by the phone page (index.html) and the dashboard (dashboard.html).
// The Python worker (worker.py, for the Raspberry Pi and the workstation) uses the same values.
const SWARM_CONFIG = {
  // Public MQTT broker over secure WebSocket: every machine connects OUT to it,
  // so no tunnel and no open port are needed (phones, Raspberry Pi, workstation in another room).
  brokerUrl: "wss://broker.hivemq.com:8884/mqtt",
  topicRoot: "edge-usthb/swarm",
  defaultRoom: "ec-s1",

  // The two jobs the teacher can launch. Same picture, different amount of computing per pixel.
  //   heavy: a lot of computing, little data -> distributing is worth it
  //   light: little computing, the same data -> the network costs more than it saves
  jobs: {
    // Upper bulb of the Mandelbrot set: about half of the pixels are inside the set and cost the full budget of iterations,
    // so the work grows with maxIter (chosen on the dashboard: tune it at rehearsal for a run of about 30 s).
    heavy: { label: "Heavy computing", width: 1200, height: 720, tile: 60, maxIter: 100000,
             cx: -0.13, cy: 0.83, span: 0.2 },
    light: { label: "Light computing", width: 1200, height: 720, tile: 60, maxIter: 60,
             cx: -0.13, cy: 0.83, span: 0.2 },
  },

  heartbeatMs: 4000,        // each worker says "I am alive" this often
  offlineAfterMs: 12000,    // no news for this long: the worker is gone, its tiles go back to the queue
};

function swarmRoom() {
  const p = new URLSearchParams(window.location.search);
  return (p.get("room") || SWARM_CONFIG.defaultRoom).replace(/[^a-zA-Z0-9_-]/g, "");
}
