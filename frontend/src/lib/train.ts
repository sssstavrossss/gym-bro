// Which cards the Train page shows (views/TrainView.vue). Pure, so the rules are tested.

export type LoadState = "idle" | "loading" | "ready" | "failed";

export interface TrainInput {
  /** A workout is going on this phone. */
  active: boolean;
  /** The plan's load state, and whether there is one. */
  planState: LoadState;
  hasPlan: boolean;
  /** Workout history's load state and how many rows it has, with finished ones still waiting to send. */
  historyState: LoadState;
  historyRows: number;
  waiting: number;
}

export interface TrainCards {
  /** "Workout in progress" with Resume, at the top. */
  inProgress: boolean;
  /** Start a workout (no plan) or Something else today (a plan): empty or described. Not while one runs. */
  start: boolean;
  /** Make a plan, once the plan has loaded and there is none. */
  makePlan: boolean;
  /** Explore the library, for someone without a plan yet. */
  explore: boolean;
  /** "Trained before?": log what you did, once history has loaded and holds nothing. */
  trainedBefore: boolean;
  /** History, once it holds something (or failed to load, to say so and try again). */
  history: boolean;
}

export function trainCards(input: TrainInput): TrainCards {
  const noPlan = input.planState === "ready" && !input.hasPlan;
  const anyHistory = input.historyRows > 0 || input.waiting > 0;
  return {
    inProgress: input.active,
    start: !input.active,
    makePlan: noPlan,
    explore: noPlan,
    trainedBefore: input.historyState === "ready" && !anyHistory,
    history: anyHistory || input.historyState === "failed",
  };
}

/** The Start a workout card's title and caption. */
export function startText(hasPlan: boolean, canDescribe: boolean): { title: string; caption: string } {
  const title = hasPlan ? "Something else today?" : "Start a workout";
  if (hasPlan) return { title, caption: canDescribe ? "Off the plan: add exercises as you go, or describe it" : "Off the plan: add exercises as you go" };
  return { title, caption: canDescribe ? "Add exercises as you go, or describe it" : "Add exercises as you go and tick off each set" };
}
