import { reactive } from "vue";
import { getUnreadCount } from "../api";

export const inbox = reactive({ unread: 0 });

export async function refreshInbox(): Promise<void> {
  try {
    inbox.unread = (await getUnreadCount()).count;
  } catch {
    inbox.unread = 0;
  }
}
