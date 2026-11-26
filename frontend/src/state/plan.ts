import { markRaw, reactive } from "vue";
import { ApiError, deletePlan, getPlan, putPlan, putPlanWorkout } from "../api";
import type { Plan, PlanAnswers, PlanExercise } from "../lib/plan";
import { trainingFrom } from "../lib/training";
import { deviceTimeZone, profile } from "./profile";

/** The training plan (README → Training plans). Offline, the last copy shows; making or changing one needs a connection. */
export const plan = reactive({
  state: "idle" as "idle" | "loading" | "ready" | "failed",
  current: null as Plan | null,
  saving: false,
});

export const PLAN_OFFLINE = "You're offline. Making or changing a plan needs a connection.";

export async function loadPlan(): Promise<void> {
  if (plan.state === "idle" || plan.state === "failed") plan.state = "loading";
  try {
    const found = await getPlan();
    plan.current = found ? markRaw(found) : null;
    plan.state = "ready";
  } catch {
    if (plan.state !== "ready") plan.state = "failed";
  }
}

/** Makes or remakes the plan. Returns null when saved, else what went wrong. */
export async function savePlan(answers: PlanAnswers): Promise<string | null> {
  if (plan.saving) return null;
  plan.saving = true;
  try {
    plan.current = markRaw(await putPlan(answers, deviceTimeZone()));
    plan.state = "ready";
    // The server keeps the answers as Your training, for the next plan.
    if (profile.saved) profile.saved = { ...profile.saved, training: trainingFrom(answers) };
    return null;
  } catch (error) {
    return error instanceof ApiError ? error.message : PLAN_OFFLINE;
  } finally {
    plan.saving = false;
  }
}

/** Saves one workout's exercises as edited by hand. Returns null when saved, else what went wrong. */
export async function savePlanWorkout(id: string, exercises: PlanExercise[], name?: string): Promise<string | null> {
  if (plan.saving) return null;
  plan.saving = true;
  try {
    plan.current = markRaw(await putPlanWorkout(id, exercises, name));
    return null;
  } catch (error) {
    return error instanceof ApiError ? error.message : PLAN_OFFLINE;
  } finally {
    plan.saving = false;
  }
}

/** Ends the plan, after the sheet asked. Returns null when ended, else what went wrong. */
export async function endPlan(): Promise<string | null> {
  try {
    await deletePlan();
  } catch (error) {
    return error instanceof ApiError ? error.message : PLAN_OFFLINE;
  }
  plan.current = null;
  return null;
}
