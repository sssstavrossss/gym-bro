import { getNotifications, putNotifications, savePushSubscription, type NotificationSettings } from "../api";

export function notificationHint(): string | null {
  const ua = navigator.userAgent;
  const apple = /iPhone|iPad|iPod/.test(ua);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  if (apple && !standalone) {
    return "On iPhone, add Gym Bro to your Home Screen. Notifications work from the home-screen app on iOS 16.4 or later.";
  }
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
    return "This browser cannot show notifications.";
  }
  return null;
}

export async function enableReminders(settings: NotificationSettings): Promise<NotificationSettings> {
  if (!settings.configured || !settings.publicKey) {
    throw new Error("Notifications are not set up.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications stay off until you allow them.");
  }
  const registration = await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(settings.publicKey);
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser did not return a push subscription.");
  }
  await savePushSubscription({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return putNotifications(true);
}

export async function disableReminders(): Promise<NotificationSettings> {
  return putNotifications(false);
}

export { getNotifications };

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
