import { foodAmountLabel, foodUnitOf, type FoodUnit } from "../lib/foodUnits";
import { heightText, signedWeight, weightText, type HeightUnit, type WeightUnit } from "../lib/units";
import { profile } from "./profile";

/** The units the account shows. Reactive: read inside a template or computed and it follows Settings. */
export function weightUnit(): WeightUnit {
  return profile.form.weightUnit ?? "kg";
}

export function heightUnit(): HeightUnit {
  return profile.form.heightUnit ?? "cm";
}

/** A weight in the shown unit, number only: "83.6" or "184.3". */
export function wt(kg: number, digits = 1): string {
  return weightText(kg, weightUnit(), digits);
}

/** A change in the shown unit, with its sign: "+0.4", "−1.1". */
export function wtSigned(kg: number, digits = 1): string {
  return signedWeight(kg, weightUnit(), digits);
}

/** A weight with its unit: "83.6 kg" or "184.3 lb". */
export function wtUnit(kg: number, digits = 1): string {
  return `${wt(kg, digits)} ${weightUnit()}`;
}

export function ht(cm: number): string {
  return heightText(cm, heightUnit());
}

/** How food amounts are shown: g (and ml) or oz (and fl oz). Macros and nutrients stay in grams. */
export function foodUnit(): FoodUnit {
  return foodUnitOf(profile.saved?.foodUnit);
}

/** A logged amount with its unit in the shown food unit: "113.4 g" or "4 oz", "2 slices". Use it for any food amount on screen. */
export function foodAmount(amount: number, unit: string): string {
  return foodAmountLabel(amount, unit, foodUnit());
}
