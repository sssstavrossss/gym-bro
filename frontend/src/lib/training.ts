// Your training (README → Your training): the answers every new plan starts from, saved on the account.
// The goal and the days stay with each plan.
import { defaultAnswers, EQUIPMENT, EXPERIENCES, JOINTS, type EquipmentPreset, type Experience, type Joint, type Plan, type PlanAnswers } from "./plan";

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

const EXPERIENCE_TEXT: Record<Experience, string> = { new: "New to training", some: "Some experience", experienced: "Experienced" };

/** "Full gym · 60 min · Some experience": what a plan will use, in a line. */
export function usingLine(training: TrainingSettings): string {
  const kit = EQUIPMENT.filter((item) => training.equipment.includes(item.id)).map((item) => item.label).join(", ");
  return [kit, `${training.minutes} min`, EXPERIENCE_TEXT[training.experience]].filter(Boolean).join(" · ");
}

/** One answer that differs between the plan and Your training, as Update plan shows it. */
export interface TrainingChange {
  label: string;
  now: string;
  next: string;
}

const listText = <T extends string>(items: readonly { id: T; label: string }[], picked: readonly T[], none: string) =>
  items.filter((item) => picked.includes(item.id)).map((item) => item.label).join(", ") || none;

/**
 * What Your training has that the plan doesn't yet: time, experience, equipment and areas to go easy on. The warm-up
 * and cool-down aren't here; the plan follows those at once.
 */
export function trainingChanges(plan: TrainingSettings, training: TrainingSettings): TrainingChange[] {
  const a = trainingFrom(plan);
  const b = trainingFrom(training);
  const changes: TrainingChange[] = [];
  if (a.minutes !== b.minutes) changes.push({ label: "Time", now: `${a.minutes} min`, next: `${b.minutes} min` });
  if (a.experience !== b.experience) {
    const label = (value: Experience) => EXPERIENCES.find((item) => item.value === value)?.label ?? value;
    changes.push({ label: "Experience", now: label(a.experience), next: label(b.experience) });
  }
  if (a.equipment.join() !== b.equipment.join()) changes.push({ label: "Equipment", now: listText(EQUIPMENT, a.equipment, "None"), next: listText(EQUIPMENT, b.equipment, "None") });
  if (a.goEasy.join() !== b.goEasy.join()) changes.push({ label: "Go easy on", now: listText(JOINTS, a.goEasy, "Nothing"), next: listText(JOINTS, b.goEasy, "Nothing") });
  return changes;
}

/** "Your plan was made with 40 min and Some experience.": the answers it hasn't taken yet, as they were. */
export function planBehindLine(changes: readonly TrainingChange[]): string {
  const parts = changes.map((item) => {
    if (item.label === "Experience") return EXPERIENCE_TEXT[EXPERIENCES.find((option) => option.label === item.now)?.value ?? "some"];
    if (item.label === "Go easy on") return item.now === "Nothing" ? "nothing to go easy on" : `${item.now} to go easy on`;
    return item.now;
  });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
  return `Your plan was made with ${list}.`;
}
