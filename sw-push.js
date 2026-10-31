// ClassPulse v32.2 - service worker of the notifications (Web Push). It only shows the notifications sent by the
// sending function of Supabase and opens the right page when the student taps one. It does not touch the pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "ClassPulse", body: event.data ? event.data.text() : "" }; }
  const base = new URL("./", self.location).href;
  event.waitUntil(self.registration.showNotification(d.title || "ClassPulse", {
    body: d.body || "",
    icon: base + "icons/icon-192.png",
    badge: base + "icons/icon-192.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: new URL(d.url || "index.html", base).href },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || new URL("./", self.location).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(new URL("./", self.location).href) && "navigate" in c) { await c.focus(); return c.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
