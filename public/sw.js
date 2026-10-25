// Ready's service worker: shows nudges and handles their buttons. Nothing is cached.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Ready", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Ready", {
      body: data.body || "",
      icon: "/pwa-icon/192",
      badge: "/pwa-icon/192",
      tag: data.tag || "ready-nudge",
      data: { url: data.url || "/learn", laterUrl: data.laterUrl || null },
      actions: data.laterUrl
        ? [
            { action: "teach", title: "Teach now" },
            { action: "later", title: "Later" },
          ]
        : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const { url, laterUrl } = event.notification.data || {};
  event.notification.close();
  if (event.action === "later" && laterUrl) {
    event.waitUntil(fetch(laterUrl, { method: "POST" }));
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => "focus" in w);
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
