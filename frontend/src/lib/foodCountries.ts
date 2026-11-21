/**
 * The food country: its foods come first in search and Describe, and keep their own names. It follows the time
 * zone's country until one is picked by hand (Settings → Region). The server decides it (`FoodCountries.Home`);
 * the app shows it and offers the list.
 */

/** Countries that can be picked, as ISO codes: every country the tz database gives a zone. The server's list. */
export const FOOD_COUNTRY_CODES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB",
  "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY",
  "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM",
  "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
  "GU", "GW", "GY", "HK", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM",
  "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG",
  "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR",
  "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI",
  "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH",
  "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA",
  "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
];

/** The country when the profile has none yet. Matches the server's `FoodSources.DefaultHome`. */
export const DEFAULT_FOOD_COUNTRY = "NO";

/** The tables each country's foods come from. A country with none gets products and your own foods first. */
const TABLES: Record<string, string> = {
  NO: "Matvaretabellen · Kassalapp",
  SE: "Livsmedelsverket",
  FI: "Fineli",
};

const ADJECTIVES: Record<string, string> = { NO: "Norwegian", SE: "Swedish", FI: "Finnish" };

let names: Intl.DisplayNames | null | undefined;

/** "Sweden" for SE, in English like the rest of the app. The code itself when the engine can't name it. */
export function countryName(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** What a country's foods come from, for the picker: its tables, or "Global foods". */
export function countryTables(code: string): string {
  return TABLES[code] ?? "Global foods";
}

export interface CountryRow {
  code: string;
  name: string;
}

/** Every country by name. */
export function allCountries(codes: readonly string[] = FOOD_COUNTRY_CODES): CountryRow[] {
  return codes
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Countries whose name has the text, those that start with it first. A two-letter code finds its country too. */
export function searchCountries(rows: readonly CountryRow[], query: string): CountryRow[] {
  const text = fold(query);
  if (!text) return [...rows];
  const starts: CountryRow[] = [];
  const within: CountryRow[] = [];
  for (const row of rows) {
    const name = fold(row.name);
    if (name.startsWith(text) || row.code.toLowerCase() === text) starts.push(row);
    else if (name.includes(text)) within.push(row);
  }
  return [...starts, ...within];
}

/** The toast when the time zone moves the food country: "In Sweden: Swedish foods first". */
export function countryMovedText(code: string): string {
  const adjective = ADJECTIVES[code];
  return adjective
    ? `In ${countryName(code)}: ${adjective} foods first`
    : `In ${countryName(code)}: foods by their English names`;
}
