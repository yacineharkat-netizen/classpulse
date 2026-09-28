// ClassPulse - service worker for the demos published by the teachers.
// Every address <site>/d/<teacher id>/<demo id>/<file> is answered with the file stored in the public
// Supabase bucket "demos", with the right content type. Relative links between the files of a demo
// (scripts, styles, images, other pages) therefore work exactly as on a normal web site.
importScripts("config.js");

const BASE = new URL("./", self.location).pathname;   // e.g. /classpulse/
const PREFIX = BASE + "d/";
const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", wasm: "application/wasm", pdf: "application/pdf",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
  event.respondWith(serve(rel.endsWith("/") || rel === "" ? rel + "index.html" : rel));
});

async function serve(rel) {
  const path = rel.split("/").map(encodeURIComponent).join("/");
  const source = `${CONFIG.supabaseUrl}/storage/v1/object/public/demos/${path}`;
  let answer;
  try { answer = await fetch(source, { cache: "no-cache" }); } catch (e) {
    return new Response("No network: the demo cannot be loaded.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (!answer.ok) return new Response("File not found in this demo: " + rel, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const ext = (rel.split(".").pop() || "").toLowerCase();
  return new Response(answer.body, { status: 200, headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" } });
}
