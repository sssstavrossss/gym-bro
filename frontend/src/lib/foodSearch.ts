/** How long the search box waits after a keystroke before asking the API. */
export const searchDebounceMs = 200;

export type SearchPlan =
  | { kind: "query"; query: string }
  | { kind: "hint"; message: string }
  | { kind: "clear" };

/** A partial phrase such as "chicken br" is sent as typed. One letter is not a search. */
export function preparedSearch(raw: string): SearchPlan {
  const query = raw.trim();
  if (query.length >= 2) return { kind: "query", query };
  if (query.length === 1) return { kind: "hint", message: "Type at least 2 letters." };
  return { kind: "clear" };
}

/** Drop a response when a newer keystroke has already replaced that request. */
export function acceptSearchResult(requestGen: number, requestQuery: string, currentGen: number, currentRaw: string): boolean {
  return requestGen === currentGen && currentRaw.trim() === requestQuery;
}

/** The note beside Results when the server's spelling help added foods spelt another way: "Including “kjøttdeig”". */
export function spellingNote(correctedQuery: string | null | undefined): string | null {
  const words = correctedQuery?.trim();
  return words ? `Including “${words}”` : null;
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Offline search over the foods kept on the phone (recent foods, My foods): every word has to
 * appear in the name or brand. A food in two lists shows once, from the first.
 */
export function searchKept<T extends { id: string; name: string; brand?: string | null }>(query: string, lists: readonly (readonly T[])[]): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const found: T[] = [];
  for (const list of lists) {
    for (const food of list) {
      if (seen.has(food.id)) continue;
      const text = fold(`${food.name} ${food.brand ?? ""}`);
      if (!words.every((word) => text.includes(word))) continue;
      seen.add(food.id);
      found.push(food);
    }
  }
  return found;
}
