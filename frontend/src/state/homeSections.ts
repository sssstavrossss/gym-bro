import { reactive } from "vue";
import type { ProfileResponse } from "../api";
import { HOME_SECTIONS, readHiddenSections, toggleSection, writeHiddenSections, type HomeSection } from "../lib/homeSections";
import { adoptHidden, sendHidden } from "./hiddenSync";

/** Home cards switched off, shared by Home and Settings → Home sections. Saved on the account. */
export const homeSections = reactive<{ hidden: HomeSection[] }>({ hidden: readHiddenSections() });

export function sectionShown(id: HomeSection): boolean {
  return !homeSections.hidden.includes(id);
}

export function setSectionShown(id: HomeSection, shown: boolean): void {
  const next = toggleSection(homeSections.hidden, id, shown);
  homeSections.hidden = next;
  writeHiddenSections(next);
  sendHidden("home", next);
}

/** The account's choice once the profile loads; this device's copy follows it. Unknown ids drop out. */
export function adoptHomeSections(saved: ProfileResponse): void {
  const ids = adoptHidden("home", saved, homeSections.hidden);
  const next = HOME_SECTIONS.map((row) => row.id).filter((id) => ids.includes(id));
  homeSections.hidden = next;
  writeHiddenSections(next);
}
