import { reactive } from "vue";
import {
  ApiError,
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  logRecipe,
  ServerUnreachable,
  updateRecipe,
  type Recipe,
  type RecipeWrite,
} from "../api";
import { log, rememberEntries, type LogEntry } from "./log";

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
  } catch (error) {
    if (error instanceof ServerUnreachable) log.unreachable = true;
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
    if (error instanceof ServerUnreachable) {
      log.unreachable = true;
      return { ok: false, message: "Server unreachable, try again." };
    }
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't save that recipe." };
  }
}

export async function retireRecipe(id: string): Promise<boolean> {
  try {
    await deleteRecipe(id);
    savedRecipes.list = savedRecipes.list.filter((recipe) => recipe.id !== id);
    return true;
  } catch (error) {
    if (error instanceof ServerUnreachable) log.unreachable = true;
    return false;
  }
}

export async function fetchRecipe(id: string): Promise<{ ok: true; recipe: Recipe } | { ok: false; message: string }> {
  try {
    return { ok: true, recipe: await getRecipe(id) };
  } catch (error) {
    if (error instanceof ServerUnreachable) {
      log.unreachable = true;
      return { ok: false, message: "Server unreachable, try again." };
    }
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
    if (error instanceof ServerUnreachable) {
      log.unreachable = true;
      return { ok: false, message: "Server unreachable, try again." };
    }
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't log that recipe." };
  }
}
