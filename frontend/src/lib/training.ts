// Your training (README → Your training): the answers every new plan starts from, saved on the account.
// The goal and the days stay with each plan.
import { defaultAnswers, EQUIPMENT, JOINTS, type EquipmentPreset, type Experience, type Joint, type Plan, type PlanAnswers } from "./plan";

export interface TrainingSettings {
  minutes: number;
  experience: Experience;
  equipment: EquipmentPreset[];
  goEasy: Joint[];
  warmUp: boolean;
  coolDown: boolean;
}

/** A plan's answers, as they're kept for the next plan. */
export function trainingFrom(answers: Pick<PlanAnswers, keyof TrainingSettings>): TrainingSettings {
  return {
    minutes: answers.minutes,
    experience: answers.experience,
    equipment: EQUIPMENT.map((item) => item.id).filter((id) => answers.equipment.includes(id)),
    goEasy: JOINTS.map((item) => item.id).filter((id) => answers.goEasy.includes(id)),
    warmUp: answers.warmUp ?? false,
    coolDown: answers.coolDown ?? false,
  };
}

/**
 * The account's, else the current plan's (made before Your training was saved), else the setup's defaults.
 * An account with no equipment saved takes the default, since a plan needs some.
 */
export function trainingOf(saved: TrainingSettings | null | undefined, plan: Plan | null | undefined): TrainingSettings {
  if (saved && saved.equipment.length) return trainingFrom(saved);
  if (plan) return trainingFrom(plan);
  return trainingFrom(defaultAnswers());
}

/** A new plan's answers: the goal and days given, the rest from Your training. */
export function withTraining(answers: PlanAnswers, training: TrainingSettings): PlanAnswers {
  return { ...answers, ...trainingFrom(training) };
}

export function sameTraining(a: TrainingSettings, b: TrainingSettings): boolean {
  const x = trainingFrom(a);
  const y = trainingFrom(b);
  return x.minutes === y.minutes && x.experience === y.experience && x.warmUp === y.warmUp && x.coolDown === y.coolDown
    && x.equipment.join() === y.equipment.join() && x.goEasy.join() === y.goEasy.join();
}

const EXPERIENCE_TEXT: Record<Experience, string> = { new: "New to training", some: "Some experience", experienced: "Experienced" };

/** "Full gym · 60 min · Some experience": what a plan will use, in a line. */
export function usingLine(training: TrainingSettings): string {
  const kit = EQUIPMENT.filter((item) => training.equipment.includes(item.id)).map((item) => item.label).join(", ");
  return [kit, `${training.minutes} min`, EXPERIENCE_TEXT[training.experience]].filter(Boolean).join(" · ");
}
