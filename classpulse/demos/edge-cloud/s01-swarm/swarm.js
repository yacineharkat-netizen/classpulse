// Computing kernel shared by the phones, the dashboard (laptop alone) and, in Python, worker.py.
// A job is a picture of the Mandelbrot set cut into square tiles. For each pixel we count how many
// iterations z -> z*z + c are needed before |z| > 2 (at most maxIter): this is pure computing.

// Coordinates of the top-left corner of tile number t, and the size of one pixel.
function tileGeometry(job, t) {
  const cols = Math.ceil(job.width / job.tile);
  const tx = t % cols, ty = Math.floor(t / cols);
  const dx = job.span / job.width;
  return { x0: job.cx - job.span / 2 + tx * job.tile * dx,
           y0: job.cy + (job.span * job.height / job.width) / 2 - ty * job.tile * dx, dx, tx, ty };
}

function tileCount(job) { return Math.ceil(job.width / job.tile) * Math.ceil(job.height / job.tile); }

// Returns {bytes: Uint8Array(tile*tile), iterations: total number of iterations computed}.
// Byte 0 = inside the set (never escaped); 1..255 = escape speed on a log scale that does not depend on
// maxIter (so the colours stay the same when the teacher changes the amount of work).
function computeTile(job, t) {
  const g = tileGeometry(job, t), n = job.tile, max = job.maxIter;
  const out = new Uint8Array(n * n);
  const logRef = Math.log(1001);
  let total = 0;
  for (let py = 0; py < n; py++) {
    const ci = g.y0 - py * g.dx;
    for (let px = 0; px < n; px++) {
      const cr = g.x0 + px * g.dx;
      let x = 0, y = 0, i = 0;
      while (i < max && x * x + y * y <= 4) { const xt = x * x - y * y + cr; y = 2 * x * y + ci; x = xt; i++; }
      total += i;
      out[py * n + px] = i >= max ? 0 : 1 + Math.floor(254 * Math.min(1, Math.log(i + 1) / logRef));
    }
  }
  return { bytes: out, iterations: total };
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// A short random id for this worker.
function randomId(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }

// Rough description of the device, shown on the leaderboard.
function deviceLabel() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/) || ua.match(/(iPhone|iPad)/);
  return m ? m[1].replace(/Build.*/, "").trim().slice(0, 24) : (/Windows/.test(ua) ? "Windows PC" : /Mac/.test(ua) ? "Mac" : "Browser");
}
