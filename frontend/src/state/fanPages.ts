import { computed, ref } from "vue";
import type { ProfileResponse } from "../api";
import { readIds, writeIds } from "../lib/cardPages";
import { FAN_PAGES_KEY, readFanLayout, sameFan, writeFanLayout, type FanLayout } from "../lib/fanPages";
import { adoptHidden, sendHidden } from "./hiddenSync";

/** The + fan's pages as saved (empty is the default). Saved on the account, with this device's copy. */
const saved = ref<string[]>(readIds(FAN_PAGES_KEY));

/** The fan's pages, for the fan and its editor. */
export const fanLayout = computed<FanLayout>(() => readFanLayout(saved.value));

export function saveFanLayout(pages: FanLayout): void {
  if (sameFan(pages, fanLayout.value)) return;
  const next = writeFanLayout(pages);
  saved.value = next;
  writeIds(FAN_PAGES_KEY, next);
  sendHidden("fan", next);
}

/** The account's layout once the profile loads; this device's copy follows it. */
export function adoptFanPages(profile: ProfileResponse): void {
  const next = adoptHidden("fan", profile, saved.value);
  saved.value = next;
  writeIds(FAN_PAGES_KEY, next);
}
