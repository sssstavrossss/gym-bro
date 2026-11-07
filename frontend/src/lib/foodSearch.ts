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
