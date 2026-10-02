// ClassPulse - service worker for the demos published by the teachers.
// Every address <site>/d/<teacher id>/<demo id>/<file> is answered with the file of the demo, with the right content type.
// Relative links between the files of a demo (scripts, styles, images, other pages) work as on a normal web site.
//
// Version 14: a demo is stored in the DATABASE and is protected. Its files are given only to
//   - a registered phone that is checked in the session where the teacher pushed the demo (and the session is not ended);
//   - a logged-in teacher (preview, big screen on the projector).
// The proof (phone token + session code, or the teacher's login token) is sent to this worker by a small page
// ("gate") that the worker itself answers when it has no valid proof yet.
// Old demos (files in the public Storage bucket "demos") still work as before.
importScripts("config.js");

const BASE = new URL("./", self.location).pathname;   // e.g. /classpulse/
const PREFIX = BASE + "d/";
const STORE = "cp-demo-access-v1";
const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", wasm: "application/wasm", pdf: "application/pdf",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ---------------------------------------------------------------- small key/value store (survives a restart of the worker)
async function kvGet(key) {
  const cache = await caches.open(STORE);
  const hit = await cache.match(BASE + "__kv/" + encodeURIComponent(key));
  return hit ? hit.json() : null;
}
async function kvSet(key, value) {
  const cache = await caches.open(STORE);
  const url = BASE + "__kv/" + encodeURIComponent(key);
  if (value == null) await cache.delete(url);
  else await cache.put(url, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
}

// The gate page sends the proof of access for one demo.
self.addEventListener("message", (event) => {
  const m = event.data || {};
  if (m.type !== "cp-demo-access" || !m.prefix) return;
  event.waitUntil(kvSet("access:" + m.prefix, m.access || null).then(() => { if (event.ports[0]) event.ports[0].postMessage({ ok: true }); }));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX) || event.request.method !== "GET") return;
  const rel = decodeURIComponent(url.pathname.slice(PREFIX.length));
  const last = rel.split("/").pop();
  // ".../demo" without a final slash: redirect to ".../demo/" so that relative links resolve correctly
  if (rel && !rel.endsWith("/") && !last.includes(".")) {
    event.respondWith(Response.redirect(url.pathname + "/" + url.search, 302));
    return;
  }
  event.respondWith(serve(rel.endsWith("/") || rel === "" ? rel + "index.html" : rel, event.request));
});

function text(message, status) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

async function rpc(fn, args, jwt) {
  const answer = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", apikey: CONFIG.supabaseAnonKey, Authorization: "Bearer " + (jwt || CONFIG.supabaseAnonKey) },
    body: JSON.stringify(args),
  });
  const body = await answer.json().catch(() => null);
  if (!answer.ok) { const e = new Error((body && body.message) || "error " + answer.status); e.status = answer.status; throw e; }
  return body;
}

function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function serve(rel, request) {
  const parts = rel.split("/");
  const prefix = parts.slice(0, 2).join("/");
  const path = parts.slice(2).join("/");
  const isPage = request.mode === "navigate" || request.destination === "document" || request.destination === "iframe";

  // protected (database) or old public bucket?
  let info = await kvGet("info:" + prefix);
  if (!info) {
    try { info = await rpc("s_demo_info", { p_prefix: prefix }); } catch (e) { return text("No network: the demo cannot be loaded.", 503); }
    if (info.exists) await kvSet("info:" + prefix, info);
  }
  if (!info.in_db) return fromBucket(rel);

  const access = await kvGet("access:" + prefix);
  if (!access) return isPage ? gate(prefix, "") : text("Open this demo from ClassPulse, during the session.", 403);
  try {
    const r = access.kind === "teacher"
      ? await rpc("t_demo_file", { p_prefix: prefix, p_path: path }, access.jwt)
      : await rpc("s_demo_file", { p_device: access.device, p_code: access.code, p_prefix: prefix, p_path: path });
    const ext = (path.split(".").pop() || "").toLowerCase();
    return new Response(fromBase64(r.data), { status: 200, headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" } });
  } catch (e) {
    if (/NOT_FOUND/.test(e.message)) return text("File not found in this demo: " + path, 404);
    await kvSet("access:" + prefix, null);            // the proof is not valid any more (session ended, login expired...)
    return isPage ? gate(prefix, e.message) : text("Access to this demo is closed.", 403);
  }
}

async function fromBucket(rel) {
  const path = rel.split("/").map(encodeURIComponent).join("/");
  const source = `${CONFIG.supabaseUrl}/storage/v1/object/public/demos/${path}`;
  let answer;
  try { answer = await fetch(source, { cache: "no-cache" }); } catch (e) { return text("No network: the demo cannot be loaded.", 503); }
  if (!answer.ok) return text("File not found in this demo: " + rel, 404);
  const ext = (rel.split(".").pop() || "").toLowerCase();
  return new Response(answer.body, { status: 200, headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" } });
}

// The gate: a tiny page that looks for a proof of access in this browser (teacher login, or registered phone
// + session joined), checks it with the server, gives it to the worker and reloads the demo.
function gate(prefix, lastError) {
  const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClassPulse - demo</title>
<style>body{font-family:system-ui,sans-serif;background:#F5F8FB;color:#1B2430;margin:0;padding:24px}
.box{max-width:520px;margin:8vh auto;background:#fff;border-radius:14px;padding:22px;box-shadow:0 1px 4px rgba(11,37,69,.1)}
h1{font-size:22px;color:#0B2545;margin:0 0 10px}p{line-height:1.5}a.btn{display:block;text-align:center;background:#0B2545;color:#fff;
text-decoration:none;font-weight:700;padding:12px;border-radius:10px;margin-top:14px}.muted{color:#5A6B7D;font-size:14px}</style></head>
<body><div class="box"><h1 id="t">Opening the demo…</h1><p id="m" class="muted">Checking your access.</p><div id="a"></div></div>
<script>
(async function () {
  var URL0 = ${JSON.stringify(CONFIG.supabaseUrl)}, KEY = ${JSON.stringify(CONFIG.supabaseAnonKey)}, PREFIX = ${JSON.stringify(prefix)}, BASE = ${JSON.stringify(BASE)};
  function rpc(fn, args, jwt) {
    return fetch(URL0 + "/rest/v1/rpc/" + fn, { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", apikey: KEY, Authorization: "Bearer " + (jwt || KEY) }, body: JSON.stringify(args) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (b) { if (!r.ok) throw new Error((b && b.message) || "error"); return b; }); });
  }
  function give(access) {
    return navigator.serviceWorker.ready.then(function (reg) {
      return new Promise(function (ok) {
        var ch = new MessageChannel(); ch.port1.onmessage = function () { ok(); };
        reg.active.postMessage({ type: "cp-demo-access", prefix: PREFIX, access: access }, [ch.port2]);
        setTimeout(ok, 1500);
      });
    }).then(function () { location.reload(); });
  }
  var tries = Number(sessionStorage.getItem("cp_gate_" + PREFIX) || 0);
  sessionStorage.setItem("cp_gate_" + PREFIX, tries + 1);
  var keys = []; try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) {}
  var reason = "";
  if (tries < 3) {
    // 1. a logged-in teacher
    for (var k = 0; k < keys.length; k++) {
      if (!/^sb-.*-auth-token$/.test(keys[k])) continue;
      try {
        var sess = JSON.parse(localStorage.getItem(keys[k])); var jwt = sess && (sess.access_token || (sess.currentSession && sess.currentSession.access_token));
        if (jwt) { await rpc("t_demo_file", { p_prefix: PREFIX, p_path: null }, jwt); return give({ kind: "teacher", jwt: jwt }); }
      } catch (e) {}
    }
    // 2. a registered phone, checked in the session
    var code = ""; try { code = localStorage.getItem("cp_last_session") || ""; } catch (e) {}
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf("cp_device_") !== 0) continue;
      var device = localStorage.getItem(keys[j]);
      try { await rpc("s_demo_file", { p_device: device, p_code: code, p_prefix: PREFIX, p_path: null }); return give({ kind: "student", device: device, code: code }); }
      catch (e) { if (!reason || /UNKNOWN_DEVICE/.test(reason)) reason = e.message; }
    }
  }
  sessionStorage.removeItem("cp_gate_" + PREFIX);
  var text = {
    UNKNOWN_DEVICE: "This phone is not registered in the class. Join the session in ClassPulse first.",
    NOT_IN_SESSION: "This demo is reserved to the students who are checked in the session. Scan the attendance QR code in class, then open the demo again.",
    SESSION_ENDED: "The session is over: this demo is closed.",
    DEMO_NOT_PUSHED: "The teacher has not opened this demo in your session yet."
  };
  var msg = "";
  Object.keys(text).forEach(function (c) { if (reason.indexOf(c) >= 0 && !msg) msg = text[c]; });
  document.getElementById("t").textContent = "Demo not available";
  document.getElementById("m").textContent = msg || "Open this demo from ClassPulse, during the session, on the phone you registered in class.";
  document.getElementById("a").innerHTML = '<a class="btn" href="' + BASE + 'index.html">Open ClassPulse</a>';
})();
</script></body></html>`;
  return new Response(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
