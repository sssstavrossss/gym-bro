import { computed } from "vue";
import { ApiError, putSettings, ServerUnreachable } from "../api";
import { trainingFrom, trainingOf, type TrainingSettings } from "../lib/training";
import { plan } from "./plan";
import { profile } from "./profile";

/** Your training (README → Your training): the account's, else the plan's, else the defaults. */
export const training = computed<TrainingSettings>(() => trainingOf(profile.saved?.training, plan.current));

/** What was saved before the changes waiting to be sent (undefined: nothing waiting). */
let before: TrainingSettings | null | undefined;
let timer: number | undefined;
let waiting: ((error: string) => void)[] = [];

/**
 * Saves Your training on the account. The sheet shows the change at once; it is sent a moment after the last
 * tap, so quick taps send once, and goes back if the save fails. Resolves with an error, or "".
 */
export function saveTraining(next: TrainingSettings): Promise<string> {
  const saved = profile.saved;
  if (!saved) return Promise.resolve("Set up your profile first.");
  if (before === undefined) before = saved.training ?? null;
  profile.saved = { ...saved, training: trainingFrom(next) };
  window.clearTimeout(timer);
  timer = window.setTimeout(send, 400);
  return new Promise((resolve) => waiting.push(resolve));
}

async function send(): Promise<void> {
  const was = before;
  const done = waiting;
  before = undefined;
  waiting = [];
  let error = "";
  try {
    const saved = await putSettings({ training: training.value });
    // A change made while this was sending goes next; until then the screen keeps it.
    if (before === undefined && profile.saved && saved.training) profile.saved = { ...profile.saved, training: saved.training };
  } catch (failure) {
    if (profile.saved) profile.saved = { ...profile.saved, training: was ?? null };
    error = failure instanceof ServerUnreachable ? "You're offline, so Your training wasn't changed."
      : failure instanceof ApiError ? failure.message : "Couldn't save Your training.";
  }
  for (const resolve of done) resolve(error);
}
