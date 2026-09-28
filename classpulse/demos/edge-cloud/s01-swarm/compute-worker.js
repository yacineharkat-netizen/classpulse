// Background thread of the phone page: computes the tiles without freezing the screen.
importScripts("swarm.js");
onmessage = (e) => {
  const { job, tile } = e.data;
  const start = performance.now();
  const r = computeTile(job, tile);
  postMessage({ tile, ms: performance.now() - start, it: r.iterations, data: bytesToBase64(r.bytes) });
};
