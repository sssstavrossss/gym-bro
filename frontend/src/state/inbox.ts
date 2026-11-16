import { reactive } from "vue";
import { getUnreadCount } from "../api";

/**
 * `unread` is every open notification. `badge` leaves out the ones shown on Home and lights the bell.
 * `targets` is an automatic target change not seen on Profile yet. Either one lights the Profile tab.
 */
export const inbox = reactive({ unread: 0, badge: 0, targets: false });

export async function refreshInbox(): Promise<void> {
  try {
    const body = await getUnreadCount();
    inbox.unread = body.count;
    inbox.badge = body.badge ?? body.count;
    inbox.targets = body.targetsChanged ?? false;
  } catch {
    inbox.unread = 0;
    inbox.badge = 0;
    inbox.targets = false;
  }
}

/** The Profile tab's dot. */
export function profileDot(): boolean {
  return inbox.badge > 0 || inbox.targets;
}
