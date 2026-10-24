<script setup lang="ts">
// First run (no profile yet): short setup, then the targets. No invented defaults — every answer is the user's.
import { computed, nextTick, reactive, ref, watch } from "vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";
import { ACTIVITY, RATES, targets as calcTargets, DEFAULT_FAT, DEFAULT_PROTEIN, type ActivityKey, type Goal, type Profile, type Sex } from "../lib/nutrition";
import { int, kg } from "../lib/format";
import { parse } from "../lib/dates";
import { finishOnboarding, today } from "../store";
import { toast, ui } from "../ui";
import { useRouter } from "vue-router";

const router = useRouter();
const STEPS = ["Welcome", "About you", "Weight", "Activity", "Goal", "Your targets"];
const step = ref(0);
// each step starts at the top (at large text sizes the Continue button is below the fold)
const obEl = ref<HTMLElement>();
watch(step, () => nextTick(() => obEl.value?.scrollTo({ top: 0 })));
const f = reactive({ sex: "" as Sex | "", birthYear: "", height: "", weight: "", activity: "" as ActivityKey | "", goal: "" as Goal | "", rate: 0, goalWeight: "" });
const num = (s: string) => Number(s.replace(",", "."));
const year = computed(() => parse(today).getFullYear());
const valid = computed(() => [
  true,
  !!f.sex && num(f.birthYear) >= 1920 && num(f.birthYear) <= year.value - 12 && num(f.height) >= 120 && num(f.height) <= 230,
  num(f.weight) >= 30 && num(f.weight) <= 300,
  !!f.activity,
  !!f.goal && (f.goal === "maintain" || f.rate > 0) && (f.goal === "maintain" || (num(f.goalWeight) >= 30 && num(f.goalWeight) <= 300)),
  true,
][step.value]);
const profile = computed<Profile>(() => ({
  sex: (f.sex || "male") as Sex, birthYear: num(f.birthYear), heightCm: num(f.height), activity: (f.activity || "moderate") as ActivityKey,
  goal: (f.goal || "maintain") as Goal, rate: f.rate || 0.5, goalWeight: num(f.goalWeight) || num(f.weight), startWeight: num(f.weight),
  proteinPerKg: DEFAULT_PROTEIN, fatPct: DEFAULT_FAT,
}));
const t = computed(() => calcTargets(profile.value, num(f.weight), year.value));
const sexM = computed({ get: () => f.sex as string, set: (v: string) => (f.sex = v as Sex) });
const goalM = computed({ get: () => f.goal as string, set: (v: string) => { f.goal = v as Goal; if (v === "maintain") f.rate = 0; } });
function next() { if (valid.value) step.value++; }
function finish() {
  finishOnboarding(profile.value, num(f.weight));
  ui.demo = "normal";
  router.push("/today");
  toast("You're set up. Log your first food with +");
}
</script>

<template>
  <div ref="obEl" class="ob" role="dialog" aria-modal="true" aria-label="Set up Gym Bro">
    <div class="obc col">
      <div class="row top">
        <button v-if="step > 0" type="button" class="cbtn" aria-label="Back" @click="step--"><Icon name="left" :size="18" :sw="2.4" /></button>
        <span v-else style="width: 32px" />
        <div class="row dots" aria-hidden="true"><span v-for="(s, i) in STEPS" :key="s" class="d" :class="{ on: i <= step }" /></div>
        <span class="t-capn c3 cnt">{{ step + 1 }} / {{ STEPS.length }}</span>
      </div>

      <form class="col body" @submit.prevent="step === STEPS.length - 1 ? finish() : next()">
        <!-- 0 -->
        <template v-if="step === 0">
          <!-- app mark: icon B, medium-size variant (icons/icon-b-md.svg) -->
          <span class="mark" aria-hidden="true"><svg width="56" height="56" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#0B0B0C"/> <rect x="64" y="476" width="896" height="72" rx="36" fill="#4C4C54"/> <rect x="134" y="424" width="60" height="176" rx="18" fill="#74747C"/> <rect x="830" y="424" width="60" height="176" rx="18" fill="#74747C"/> <circle cx="512" cy="512" r="290" fill="#FFFFFF"/> <path d="M596.3 418.4 A126 126 0 1 0 611.3 589.6 L611.3 512 L536 512" fill="none" stroke="#0B0B0C" stroke-width="84" stroke-linejoin="miter"/></svg></span>
          <h1 class="t-title">Set up your targets</h1>
          <p class="t-body c2">A few questions — about a minute. Your calorie and macro targets are worked out from your answers; nothing is shown until you're done.</p>
          <ul class="t-label c2 ul"><li>Log food with a time, no meal types</li><li>Weigh in most mornings for a steady trend</li><li>Change anything later in Profile</li></ul>
        </template>
        <!-- 1 -->
        <template v-else-if="step === 1">
          <h1 class="t-title">About you</h1>
          <p class="t-label c2">Used for your base metabolic rate (Mifflin-St Jeor).</p>
          <span class="t-capm c2">Sex</span>
          <Segmented v-model="sexM" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" :height="40" />
          <div class="row two">
            <label class="fld col"><span class="t-capm c2">Birth year</span><input v-model="f.birthYear" class="t-ns" inputmode="numeric" maxlength="4" placeholder="e.g. 1990" autocomplete="off" /></label>
            <label class="fld col"><span class="t-capm c2">Height · cm</span><input v-model="f.height" class="t-ns" inputmode="numeric" maxlength="3" placeholder="e.g. 180" autocomplete="off" /></label>
          </div>
        </template>
        <!-- 2 -->
        <template v-else-if="step === 2">
          <h1 class="t-title">Your weight today</h1>
          <p class="t-label c2">This is your first weigh-in. Targets use it until your trend is ready (3 weigh-ins within 7 days).</p>
          <label class="fld big row"><input v-model="f.weight" class="t-dl" inputmode="decimal" maxlength="5" placeholder="0.0" autocomplete="off" aria-label="Weight in kg" /><span class="t-head c2">kg</span></label>
          <span v-if="f.weight && !valid" class="t-label">Enter a weight between 30 and 300 kg — 83,4 and 83.4 both work.</span>
        </template>
        <!-- 3 -->
        <template v-else-if="step === 3">
          <h1 class="t-title">How active are you?</h1>
          <p class="t-label c2">Your daily burn = base rate × this factor. Count training and daily movement.</p>
          <div class="col opts" role="radiogroup">
            <button v-for="(a, k) in ACTIVITY" :key="k" type="button" role="radio" :aria-checked="f.activity === k" class="opt row" :class="{ on: f.activity === k }" @click="f.activity = k as ActivityKey">
              <span class="col grow"><span class="t-body">{{ a.label }}</span><span class="t-capn c2">{{ a.hint }}</span></span><span class="t-label c3">×{{ a.factor }}</span>
            </button>
          </div>
        </template>
        <!-- 4 -->
        <template v-else-if="step === 4">
          <h1 class="t-title">Your goal</h1>
          <Segmented v-model="goalM" :options="[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]" :height="40" />
          <template v-if="f.goal && f.goal !== 'maintain'">
            <span class="t-capm c2">Rate · kg per week</span>
            <div class="row rates"><button v-for="r in RATES" :key="r" type="button" class="chip t-label" :class="{ on: f.rate === r }" @click="f.rate = r">{{ r === 1 ? "1.0" : r }}</button></div>
            <span class="t-capn c3">0.5 kg/week is a steady pace for most people.</span>
            <label class="fld row"><span class="col grow"><span class="t-capm c2">Goal weight</span><input v-model="f.goalWeight" class="t-ns" inputmode="decimal" maxlength="5" placeholder="e.g. 80" autocomplete="off" /></span><span class="t-label c2">kg</span></label>
          </template>
        </template>
        <!-- 5 -->
        <template v-else>
          <h1 class="t-title">Your daily targets</h1>
          <div class="card tg">
            <div class="row"><span class="col grow"><span class="t-capm c2">Eat</span><span class="base"><span class="t-dl">{{ int(t.kcal) }}</span><span class="t-label c2">kcal</span></span></span></div>
            <div class="row stats">
              <span class="col grow"><span class="t-capm c2">Protein</span><span class="t-ns">{{ Math.round(t.protein) }} g</span></span>
              <span class="col grow"><span class="t-capm c2">Fat</span><span class="t-ns">{{ Math.round(t.fat) }} g</span></span>
              <span class="col grow"><span class="t-capm c2">Carbs</span><span class="t-ns">{{ Math.round(t.carbs) }} g</span></span>
            </div>
            <div class="divider" />
            <span class="t-capn c2">Base rate {{ int(t.bmr) }} · daily burn {{ int(t.tdee) }} kcal · {{ f.goal === "maintain" ? "maintain" : `${f.goal} ${f.rate} kg/week` }} · {{ kg(num(f.weight)) }} kg</span>
            <span v-if="t.floored" class="t-capn c2">Raised to your base rate — the target never goes below it.</span>
          </div>
          <p class="t-label c2">Protein 2.0 g/kg, fat 25 % of calories, carbs the rest. Adjust under Profile → Macro balance.</p>
        </template>

        <span class="grow" />
        <button type="submit" class="primary-btn t-bodys" :disabled="!valid">{{ step === 0 ? "Get started" : step === STEPS.length - 1 ? "Start logging" : "Continue" }}</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ob { position: absolute; inset: 0; z-index: 40; background: var(--color-bg); display: flex; justify-content: center; overflow-y: auto; }
.obc { width: 100%; max-width: 520px; padding: calc(var(--sat) + 12px) 20px max(var(--sab), 20px); gap: 16px; min-height: 100%; }
.top { gap: 12px; min-height: 44px; }
.dots { flex: 1 1 auto; gap: 6px; }
.d { flex: 1 1 0; height: 4px; border-radius: 2px; background: var(--color-track); }
.d.on { background: var(--color-action); }
.cnt { min-width: 32px; text-align: right; white-space: nowrap; }
.body { flex: 1 1 auto; gap: 14px; }
.body p { margin: 0; }
.mark { width: 56px; height: 56px; border-radius: 13px; overflow: hidden; display: flex; margin: 24px 0 8px; box-shadow: 0 0 0 1px var(--color-border); }
.ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; }
.two { gap: 12px; }
.two .fld { flex: 1 1 0; }
.fld { flex: none; gap: 4px; padding: 12px 14px; border-radius: var(--radius-control); background: var(--color-surface); cursor: text; }
.fld input { background: transparent; border: 0; outline: 0; padding: 0; min-width: 0; width: 100%; color: #fff; }
.fld input::placeholder { color: var(--text-tertiary); }
.fld:focus-within { box-shadow: inset 0 0 0 1.5px var(--color-action); }
.fld.big { align-items: baseline; gap: 8px; padding: 18px 16px; }
.fld.big input { width: 100%; }
.opts { gap: 8px; }
.opt { gap: 10px; min-height: 56px; padding: 8px 14px; border-radius: var(--radius-control); background: var(--color-surface); text-align: left; }
.opt.on { box-shadow: inset 0 0 0 1.5px var(--color-action); }
.rates { gap: 8px; }
.rates .chip { min-height: 36px; padding: 0 16px; border-radius: 18px; }
.tg { gap: 12px; padding: 20px; }
.stats { gap: 8px; }
.is-desktop .ob { align-items: center; background: rgba(0,0,0,.92); }
.is-desktop .obc { min-height: 0; height: min(720px, calc(100% - 64px)); border-radius: var(--radius-sheet); background: var(--color-surface); padding: 24px 32px 28px; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
.is-desktop .fld, .is-desktop .opt { background: var(--color-surface-2); }
.is-tablet .obc { padding-top: calc(var(--sat) + 48px); }
/* Dynamic Type: paired fields stack at AX sizes; inputs never narrower than their placeholder */
.dt-xl .two { flex-direction: column; flex-wrap: nowrap; }
.dt-xl .two > .fld { width: 100%; }
.dt-xl .dots { flex-basis: 100%; order: 3; }
</style>
