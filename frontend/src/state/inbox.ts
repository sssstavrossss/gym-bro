import { reactive } from "vue";
import { getUnreadCount } from "../api";

/** `unread` is every open notification. `badge` leaves out the ones shown on Home, and drives the Profile tab's dot. */
export const inbox = reactive({ unread: 0, badge: 0 });

export async function refreshInbox(): Promise<void> {
  try {
    const body = await getUnreadCount();
    inbox.unread = body.count;
    inbox.badge = body.badge ?? body.count;
  } catch {
    inbox.unread = 0;
    inbox.badge = 0;
  }
}
