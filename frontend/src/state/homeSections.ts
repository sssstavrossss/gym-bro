import { reactive } from "vue";
import { readHiddenSections, toggleSection, writeHiddenSections, type HomeSection } from "../lib/homeSections";

/** Home cards switched off on this device, shared by Home and Settings → Home sections. */
export const homeSections = reactive<{ hidden: HomeSection[] }>({ hidden: readHiddenSections() });

export function sectionShown(id: HomeSection): boolean {
  return !homeSections.hidden.includes(id);
}

export function setSectionShown(id: HomeSection, shown: boolean): void {
  const next = toggleSection(homeSections.hidden, id, shown);
  homeSections.hidden = next;
  writeHiddenSections(next);
}
