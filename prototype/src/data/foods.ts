// Example food database (fictional values, rounded). Values are per 100 g — or per 100 ml when `liquid`.
// `usual` is the one-tap amount in grams; `servings` are sizes the source gives (piece, slice, scoop…).
export interface Serving { name: string; g: number; mine?: boolean }
export interface Food {
  id: string;
  name: string;
  kcal: number;
  p: number;
  f: number;
  c: number;
  usual: number;
  /** values are per 100 ml (1 ml counted as 1 g); unlocks the ml unit */
  liquid?: boolean;
  servings?: Serving[];
  /** usual unit for one-tap add (default g) and its amount */
  usualUnit?: string;
  usualAmount?: number;
  // custom foods (S3)
  mine?: boolean;
  brand?: string;
  barcode?: string;
  /** entered per serving without a weight: only the serving unit makes sense */
  servingOnly?: boolean;
  deleted?: boolean;
}

export const FOODS: Food[] = [
  { id: "chicken", name: "Chicken breast, cooked", kcal: 165, p: 31, f: 3.6, c: 0, usual: 180 },
  { id: "rice", name: "Basmati rice, cooked", kcal: 130, p: 2.5, f: 0.5, c: 28, usual: 200 },
  { id: "yogurt", name: "Greek yogurt 0%", kcal: 59.2, p: 10.4, f: 0.4, c: 3.6, usual: 250, servings: [{ name: "pot", g: 170 }] },
  { id: "salmon", name: "Salmon fillet", kcal: 208, p: 20, f: 13.4, c: 0, usual: 150 },
  { id: "eggs", name: "Eggs, whole", kcal: 143, p: 12.6, f: 9.5, c: 0.7, usual: 120, servings: [{ name: "piece", g: 60 }], usualUnit: "piece", usualAmount: 2 },
  { id: "banana", name: "Banana", kcal: 89, p: 1.1, f: 0.3, c: 22.8, usual: 120, servings: [{ name: "piece", g: 120 }], usualUnit: "piece", usualAmount: 1 },
  { id: "whey", name: "Whey protein", kcal: 400, p: 80, f: 6.7, c: 6.7, usual: 30, servings: [{ name: "scoop", g: 30 }], usualUnit: "scoop", usualAmount: 1 },
  { id: "oats", name: "Rolled oats", kcal: 379, p: 13.2, f: 6.5, c: 67.7, usual: 60 },
  { id: "blueberries", name: "Blueberries", kcal: 57, p: 0.7, f: 0.3, c: 14, usual: 100 },
  { id: "pb", name: "Peanut butter", kcal: 588, p: 25, f: 50, c: 20, usual: 32, servings: [{ name: "tbsp", g: 16 }] },
  { id: "avocado", name: "Avocado", kcal: 160, p: 2, f: 14.7, c: 8.5, usual: 50 },
  { id: "oil", name: "Olive oil", kcal: 884, p: 0, f: 100, c: 0, usual: 10, servings: [{ name: "tbsp", g: 14 }] },
  { id: "almonds", name: "Almonds", kcal: 579, p: 21.2, f: 49.9, c: 21.6, usual: 30 },
  { id: "sweetpotato", name: "Sweet potato, baked", kcal: 90, p: 2, f: 0.2, c: 20.7, usual: 200 },
  { id: "broccoli", name: "Broccoli, steamed", kcal: 35, p: 2.4, f: 0.4, c: 7.2, usual: 150 },
  { id: "beef5", name: "Beef mince 5%, cooked", kcal: 175, p: 27, f: 7.5, c: 0, usual: 150 },
  { id: "tuna", name: "Tuna in water, drained", kcal: 116, p: 26, f: 1, c: 0, usual: 120 },
  { id: "cottage", name: "Cottage cheese", kcal: 98, p: 11, f: 4.3, c: 3.4, usual: 200 },
  { id: "bread", name: "Wholemeal bread", kcal: 247, p: 13, f: 3.4, c: 41, usual: 80, servings: [{ name: "slice", g: 40 }] },
  { id: "pasta", name: "Pasta, cooked", kcal: 158, p: 5.8, f: 0.9, c: 31, usual: 220 },
  { id: "apple", name: "Apple", kcal: 52, p: 0.3, f: 0.2, c: 14, usual: 180, servings: [{ name: "piece", g: 180 }] },
  { id: "milk", name: "Milk, semi-skimmed", kcal: 50, p: 3.5, f: 1.7, c: 4.8, usual: 250, liquid: true, servings: [{ name: "glass", g: 250 }], usualUnit: "ml", usualAmount: 250 },
  { id: "cheddar", name: "Cheddar", kcal: 403, p: 25, f: 33, c: 1.3, usual: 30 },
  { id: "tofu", name: "Tofu, firm", kcal: 144, p: 17, f: 8.7, c: 2.8, usual: 150 },
  { id: "feta", name: "Feta", kcal: 264, p: 14, f: 21, c: 4, usual: 50 },
  { id: "honey", name: "Honey", kcal: 304, p: 0.3, f: 0, c: 82, usual: 20 },
];

/** Built-in foods only. Use `findFood` from the store to include custom foods. */
export const foodById = (id: string) => FOODS.find((f) => f.id === id);

// ---------- units (S2) ----------
const PLURAL: Record<string, string> = { piece: "pieces", slice: "slices", scoop: "scoops", serving: "servings", pot: "pots", glass: "glasses", tbsp: "tbsp", cup: "cups", bar: "bars" };
/** "2 pieces", "250 ml", "0.5 slice" */
export function amountLabel(amount: number, unit: string): string {
  const a = Number(amount.toFixed(2)).toString();
  if (unit === "g" || unit === "ml") return `${a} ${unit}`;
  return `${a} ${amount === 1 || amount < 1 ? unit : PLURAL[unit] ?? unit + "s"}`;
}

/** Macros for an amount, rounded the way they are shown. */
export function macrosFor(food: Food, grams: number) {
  const k = grams / 100;
  return {
    kcal: Math.round(food.kcal * k),
    p: Math.round(food.p * k),
    f: Math.round(food.f * k),
    c: Math.round(food.c * k),
  };
}
