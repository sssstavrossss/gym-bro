self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Gym Bro";
  const body = data.body || "Time to recalculate your target";
  const url = data.url || "/today?recalculate=1";
  event.waitUntil(self.registration.showNotification(title, { body, data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/today?recalculate=1";
  event.waitUntil(self.clients.openWindow(url));
});
