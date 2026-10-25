// ClubHQ Admin service worker: web-push alerts only (D-041). Nothing is cached, so the
// portal always runs the latest code.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ClubHQ Admin", body: event.data?.text() ?? "" };
  }
  event.waitUntil(self.registration.showNotification(data.title ?? "ClubHQ Admin", {
    body: data.body ?? "",
    tag: data.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: typeof data.url === "string" && data.url.startsWith("#/") ? data.url : "#/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "#/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ url });
      return;
    }
    await self.clients.openWindow(`/${url}`);
  })());
});
