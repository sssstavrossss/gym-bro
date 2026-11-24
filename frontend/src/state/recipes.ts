import { reactive } from "vue";
import {
  ApiError,
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  logRecipe,
  restoreRecipe,
  ServerUnreachable,
  updateRecipe,
  type Recipe,
  type RecipeWrite,
} from "../api";
import { rememberEntries, type LogEntry } from "./log";

export const savedRecipes = reactive({
  list: [] as Recipe[],
  loaded: false,
});

let generation = 0;

export async function loadRecipes(): Promise<void> {
  const gen = ++generation;
  try {
    const body = await listRecipes();
    if (gen !== generation) return;
    savedRecipes.list = body.recipes;
    savedRecipes.loaded = true;
  } catch {
    // Offline with nothing kept: the list stays as it was.
  }
}

function remember(recipe: Recipe): void {
  savedRecipes.list = [recipe, ...savedRecipes.list.filter((row) => row.id !== recipe.id)];
  savedRecipes.loaded = true;
}

export async function saveRecipe(body: RecipeWrite, id?: string): Promise<{ ok: true; recipe: Recipe } | { ok: false; message: string }> {
  try {
    const recipe = id ? await updateRecipe(id, body) : await createRecipe(body);
    remember(recipe);
    return { ok: true, recipe };
  } catch (error) {
    if (error instanceof ServerUnreachable) return { ok: false, message: "Saving a recipe needs a connection." };
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't save that recipe." };
  }
}

export async function retireRecipe(id: string): Promise<boolean> {
  try {
    await deleteRecipe(id);
    savedRecipes.list = savedRecipes.list.filter((recipe) => recipe.id !== id);
    return true;
  } catch {
    return false;
  }
}

/** Undo a delete. The recipe goes back to the place it had in the list. */
export async function unretireRecipe(id: string, index: number): Promise<boolean> {
  try {
    const recipe = await restoreRecipe(id);
    const rest = savedRecipes.list.filter((row) => row.id !== id);
    const at = Math.max(0, Math.min(index, rest.length));
    savedRecipes.list = [...rest.slice(0, at), recipe, ...rest.slice(at)];
    savedRecipes.loaded = true;
    return true;
  } catch {
    return false;
  }
}

/** Delete with an Undo toast. Returns false when the delete itself failed. */
export async function deleteRecipeWithUndo(recipe: { id: string; name: string }, notify: (text: string, action?: { label: string; run: () => void }, options?: { error?: boolean }) => void): Promise<boolean> {
  const index = savedRecipes.list.findIndex((row) => row.id === recipe.id);
  if (!(await retireRecipe(recipe.id))) return false;
  notify(`Deleted ${recipe.name} · past entries kept`, {
    label: "Undo",
    run: () => {
      void unretireRecipe(recipe.id, index).then((ok) => {
        if (!ok) notify("Couldn't restore that recipe.", undefined, { error: true });
      });
    },
  });
  return true;
}

export async function fetchRecipe(id: string): Promise<{ ok: true; recipe: Recipe } | { ok: false; message: string }> {
  try {
    return { ok: true, recipe: await getRecipe(id) };
  } catch (error) {
    if (error instanceof ServerUnreachable) return { ok: false, message: "Opening a recipe needs a connection." };
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't open that recipe." };
  }
}

export async function logSavedRecipe(
  id: string,
  input: { localDate: string; timeZone: string; time: string | null; idempotencyKey: string; amount: number; unit: "portion" | "g" },
): Promise<{ ok: true; entry: LogEntry } | { ok: false; message: string }> {
  try {
    const row = await logRecipe(id, input);
    const [entry] = rememberEntries([row]);
    return { ok: true, entry };
  } catch (error) {
    if (error instanceof ServerUnreachable) return { ok: false, message: "Logging a recipe needs a connection." };
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't log that recipe." };
  }
}
