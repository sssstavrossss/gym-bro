import { reactive } from "vue";
import { ApiError, describeMeal, getDescribe, getDescription, markDescriptionLogged, ServerUnreachable, type DescribeRecent } from "../api";
import { chosenRows, loggedItems, rowKcal, rowsFrom, type DescribeRow } from "../lib/describe";
import { macrosForFood } from "../lib/foodAmount";
import { saveQuickAdd, type LogEntry } from "./log";

// "Describe a meal" on the food sheet. The state lives here, not in the pane, because the amount
// screen replaces the pane while a row is being changed and the list has to be there when it comes back.

export type DescribePhase = "write" | "finding" | "review";

export const describe = reactive({
  /** The server has a key (or a test model). Until the first answer, Describe stays hidden. */
  available: false,
  recent: [] as DescribeRecent[],
  /** Descriptions allowed in 24 hours, how many are left, and when one frees up once none are. */
  limit: 0,
  left: 0,
  nextAt: null as string | null,
  text: "",
  phase: "write" as DescribePhase,
  error: "",
  /** The last find failed for a reason that may pass (Claude or the server unreachable): its button says Try again. */
  retryable: false,
  /** Changing the words over the review list. draft is the text box; the list stays until the new one comes. */
  revising: false,
  draft: "",
  /** The saved description the review list came from. */
  id: null as string | null,
  rows: [] as DescribeRow[],
  /** Row open on the amount screen. Its button says Use and comes back here. */
  editing: null as number | null,
  adding: false,
});

let gen = 0;

export async function loadDescribe(): Promise<void> {
  try {
    const overview = await getDescribe();
    describe.available = overview.available;
    describe.recent = overview.recent;
    describe.limit = overview.limit ?? 0;
    describe.left = overview.left ?? 0;
    describe.nextAt = overview.nextAt ?? null;
  } catch {
    // Offline with nothing kept, or the server is older: keep what was known.
  }
}

/** A fresh start, for a newly opened food sheet. */
export function resetDescribe(): void {
  gen++;
  describe.text = "";
  describe.phase = "write";
  describe.error = "";
  describe.retryable = false;
  describe.revising = false;
  describe.draft = "";
  describe.id = null;
  describe.rows = [];
  describe.editing = null;
  describe.adding = false;
}

/** The words become a text box over the list. The list stays, dimmed, until Find again brings a new one. */
export function startRevise(): void {
  if (describe.phase !== "review" || describe.adding) return;
  describe.draft = describe.text;
  describe.revising = true;
  describe.error = "";
  describe.retryable = false;
}

/** Back to the list as it was. */
export function cancelRevise(): void {
  gen++;
  if (describe.phase === "finding") describe.phase = "review";
  describe.revising = false;
  describe.error = "";
  describe.retryable = false;
}

function messageFor(error: unknown): string {
  if (error instanceof ServerUnreachable) return "Describing a meal needs a connection. Try again once you're back online.";
  if (error instanceof ApiError) return error.message;
  return "Couldn't describe that. Try again, or use Search.";
}

/** Worth sending the same words again: Claude or the server couldn't be reached. */
function passing(error: unknown): boolean {
  return error instanceof ServerUnreachable || (error instanceof ApiError && error.status === 503);
}

async function ask(text: string, retryOf: string | null, onFail: () => void): Promise<void> {
  const mine = ++gen;
  describe.phase = "finding";
  describe.error = "";
  describe.retryable = false;
  try {
    const result = await describeMeal(text, retryOf);
    if (mine !== gen) return;
    describe.text = result.text;
    describe.id = result.id;
    describe.rows = rowsFrom(result.items, () => crypto.randomUUID());
    describe.revising = false;
    describe.phase = "review";
    if (result.left != null) describe.left = result.left;
    // That was the last one: the overview says when the next one frees up.
    if (result.left === 0) void loadDescribe();
  } catch (error) {
    if (mine !== gen) return;
    onFail();
    describe.error = messageFor(error);
    describe.retryable = passing(error);
    // A refused or answered attempt still counted; the limit's own answer needs the time it frees up.
    void loadDescribe();
  }
}

export async function findFoods(): Promise<void> {
  const text = describe.text.trim();
  if (!text || describe.phase === "finding") return;
  await ask(text, null, () => {
    describe.phase = "write";
  });
}

/** The edited words, sent again. The new attempt points at the one it replaces. */
export async function findAgain(): Promise<void> {
  const text = describe.draft.trim();
  if (!text || describe.phase === "finding") return;
  await ask(text, describe.id, () => {
    describe.phase = "review";
  });
}

/** A recent description, with the foods and amounts it was logged with. */
export async function useRecent(recent: DescribeRecent): Promise<void> {
  const mine = ++gen;
  describe.text = recent.text;
  describe.phase = "finding";
  describe.error = "";
  describe.retryable = false;
  describe.revising = false;
  try {
    const result = await getDescription(recent.id);
    if (mine !== gen) return;
    describe.id = result.id;
    describe.rows = rowsFrom(result.items, () => crypto.randomUUID());
    describe.phase = "review";
  } catch (error) {
    if (mine !== gen) return;
    describe.phase = "write";
    describe.error = messageFor(error);
  }
}

export function toggleRow(index: number): void {
  const row = describe.rows[index];
  if (row?.food) row.on = !row.on;
}

/** The amount screen's Use: the row takes the new amount and is checked again. */
export function setRowAmount(index: number, amount: number, unit: string): void {
  const row = describe.rows[index];
  if (!row) return;
  row.amount = amount;
  row.unit = unit;
  row.on = true;
}

export type AddOutcome = { ok: true; added: LogEntry[]; kcal: number } | { ok: false; added: LogEntry[]; message: string };

/**
 * Logs every checked row, one entry each, in order. A row that saves leaves the list, so a retry after
 * a failure sends only what is left. Offline the entries wait on the phone like any other add.
 */
export async function addChosen(input: { localDate: string; timeZone: string; time: string | null }): Promise<AddOutcome> {
  if (describe.adding) return { ok: false, added: [], message: "" };
  describe.adding = true;
  const id = describe.id;
  const chosen = chosenRows(describe.rows);
  const added: LogEntry[] = [];
  const logged: typeof chosen = [];
  try {
    for (const row of chosen) {
      const macros = macrosForFood(row.food, row.amount, row.unit);
      const result = await saveQuickAdd({
        idempotencyKey: row.key,
        localDate: input.localDate,
        timeZone: input.timeZone,
        time: input.time,
        name: row.food.name,
        kcal: macros.kcal,
        protein: macros.protein,
        fat: macros.fat,
        carbs: macros.carbs,
        foodId: row.food.id,
        amount: row.amount,
        unit: row.unit,
      });
      if (!result.ok) {
        const done = new Set(logged.map((item) => item.key));
        describe.rows = describe.rows.filter((item) => !done.has(item.key));
        return { ok: false, added, message: result.message };
      }
      added.push(result.entry);
      logged.push(row);
    }
    const kcal = logged.reduce((sum, row) => sum + rowKcal(row), 0);
    // Only for "use again". A failure here costs nothing that was logged.
    if (id) void markDescriptionLogged(id, loggedItems(logged)).then(loadDescribe, () => undefined);
    resetDescribe();
    return { ok: true, added, kcal };
  } finally {
    describe.adding = false;
  }
}
