/**
 * Where a catalogue food comes from, and how that changes the way it is shown. A food from another country's
 * table goes by its English name, with the country as a tag and the table named on its second line. The server
 * logs it under the same name (`FoodSources.DisplayName`).
 */

/** The country search favours. Matches the server's `FoodSources.DefaultHome` until the profile has a setting. */
export const HOME_COUNTRY = "NO";

const COUNTRY_NAMES: Record<string, string> = {
  NO: "Norway",
  SE: "Sweden",
  FI: "Finland",
  DK: "Denmark",
  IS: "Iceland",
};

const SOURCE_NAMES: Record<string, string> = {
  mvt: "Matvaretabellen",
  kassalapp: "Kassalapp",
  slv: "Livsmedelsverket",
  off: "Open Food Facts",
  custom: "Your food",
};

export interface FoodOriginFields {
  source: string;
  name: string;
  nameEn: string | null;
  /** ISO country of the food's table. Null or absent for own foods and Open Food Facts products. */
  country?: string | null;
}

export function isForeign(food: FoodOriginFields, home = HOME_COUNTRY): boolean {
  return Boolean(food.country) && food.country !== home;
}

/** The name to show: another country's food by its English name when it has one. */
export function foodTitle(food: FoodOriginFields, home = HOME_COUNTRY): string {
  return isForeign(food, home) && food.nameEn?.trim() ? food.nameEn : food.name;
}

/** "Sweden" for a Swedish food in Norway. Null for a home food. */
export function countryTag(food: FoodOriginFields, home = HOME_COUNTRY): string | null {
  if (!isForeign(food, home) || !food.country) return null;
  return COUNTRY_NAMES[food.country] ?? food.country;
}

/** The table or list a food came from, by name. Null for a source the app does not name. */
export function sourceName(source: string): string | null {
  return SOURCE_NAMES[source] ?? null;
}

/**
 * The start of a result's second line. Another country's food names its table ("Livsmedelsverket · ").
 * A home food shows its English name when that differs from its own ("Chicken, fillet, raw · ").
 */
export function originLine(food: FoodOriginFields, home = HOME_COUNTRY): string {
  if (isForeign(food, home)) return `${sourceName(food.source) ?? food.source} · `;
  const english = food.nameEn && food.nameEn.localeCompare(food.name, undefined, { sensitivity: "accent" }) !== 0;
  return english ? `${food.nameEn} · ` : "";
}
