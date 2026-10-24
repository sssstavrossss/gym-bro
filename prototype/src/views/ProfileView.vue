<script setup lang="ts">
import AccuracyDot from "../components/AccuracyDot.vue";
import { computed, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import Segmented from "../components/Segmented.vue";
import MacroBalance from "../components/MacroBalance.vue";
import TargetHistory from "../components/TargetHistory.vue";
import GoalReached from "../components/GoalReached.vue";
import ManualTag from "../components/ManualTag.vue";
import { addDays, dayMonth, parse, weekdayShort } from "../lib/dates";
import { int, kg } from "../lib/format";
import { ACTIVITY, RATES, KCAL_PER_KG, MANUAL_MAX, MANUAL_MIN, impliedKgPerWeek, parseManualKcal, type ActivityKey, type Goal, type Sex } from "../lib/nutrition";
import { currentTarget, hasWeights, reasonText, setGoalMode, shown, state, targets, today, lowAccuracy, trendWeight } from "../store";
import { openWeight, toast, ui } from "../ui";
import { DEMO_STATES, applyDemo } from "../lib/demo";
import { useRouter } from "vue-router";
import { vp } from "../lib/viewport";

const p = state.profile;
const age = computed(() => parse(today).getFullYear() - p.birthYear);
const sex = computed({ get: () => p.sex, set: (v: Sex) => (p.sex = v) });
const goal = computed({ get: () => p.goal, set: (v: Goal) => (p.goal = v) });
const actOpen = ref(false);

function numInput(e: Event, key: "birthYear" | "heightCm", min: number, max: number) {
  const el = e.target as HTMLInputElement;
  const n = Math.round(Number(el.value));
  if (n >= min && n <= max) p[key] = n;
  el.value = String(p[key]);
}

// S7: goal mode
const mode = computed({ get: () => p.goalMode ?? "rate", set: (v: "rate" | "manual") => setGoalMode(v) });
const manualText = ref(String(p.manualKcal ?? ""));
const manualErr = ref<string | null>(null);
watch(() => p.manualKcal, (v) => { if (v != null && document.activeElement?.id !== "manual-kcal") manualText.value = String(v); });
function manualInput() {
  const { v, err } = parseManualKcal(manualText.value);
  manualErr.value = err;
  if (v != null) { p.manualKcal = v; manualText.value = String(v); }
}
function stepManual(d: number) {
  const n = Math.min(MANUAL_MAX, Math.max(MANUAL_MIN, Math.round(((p.manualKcal ?? 2000) + d) / 10) * 10));
  p.manualKcal = n; manualText.value = String(n); manualErr.value = null;
}
const manualInfo = computed(() => {
  const t = targets.value;
  const w = impliedKgPerWeek(t.tdee, p.manualKcal ?? 0);
  const ws = Math.abs(w) < 0.05 ? "≈ steady weight" : `≈ ${w < 0 ? "−" : "+"}${Math.abs(w).toFixed(1)} kg/week`;
  return `Burn about ${int(t.tdee)} kcal · your ${int(p.manualKcal ?? 0)} kcal ${ws}`;
});
const goalNote = computed(() => {
  const t = targets.value;
  const perDay = int(Math.abs(t.delta));
  if (p.goal === "maintain") return `Eat what you burn · weight stays around ${kg(trendWeight.value)} kg`;
  if (p.goal === "lose") {
    const toGo = trendWeight.value - p.goalWeight;
    if (toGo <= 0) return `≈ ${perDay} kcal/day below burn`;
    const days = Math.round((toGo / p.rate) * 7);
    return `≈ ${perDay} kcal/day below burn · ${p.goalWeight} kg around ${dayMonth(addDays(today, days))}`;
  }
  return `≈ ${perDay} kcal/day above burn · +${kg((p.rate * 30) / 7)} kg a month`;
});

function goalInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const n = Number(el.value.replace(",", "."));
  if (n >= 30 && n <= 300) p.goalWeight = Math.round(n * 10) / 10;
  el.value = kg(p.goalWeight);
}
const router = useRouter();
const demoOpen = ref(false);
const demoLabel = computed(() => DEMO_STATES.find((d) => d.key === ui.demo)?.label ?? "");
function demo(k: (typeof DEMO_STATES)[number]["key"]) {
  applyDemo(k);
  toast(`Demo: ${DEMO_STATES.find((d) => d.key === k)!.label}`);
  if (k !== "normal") router.push("/today");
}
void KCAL_PER_KG;
/** S1: the row in effect today, and what Monday's weekly update would give with the latest trend */
const cur = computed(() => currentTarget.value);
const nextMonday = computed(() => { const d = parse(today).getDay(); return addDays(today, ((8 - d) % 7) || 7); });
const nextKcal = computed(() => Math.round(targets.value.kcal));
const sinceLabel = computed(() => (cur.value ? (cur.value.date === today ? "today" : dayMonth(cur.value.date)) : ""));
</script>

<template>
  <main class="screen">
    <header class="screen-head">
      <h1 class="t-title">Profile</h1>
      <span class="grow" />
      <span class="t-label c3">Metric · kg, cm</span>
    </header>

    <div class="pgrid" :class="{ two: vp.tablet, desk: vp.desktop }">
    <div class="pcol">
    <section class="card about">
      <span class="t-cap c3">About you</span>
      <div class="frow row">
        <span class="t-body c2">Sex</span><span class="grow" />
        <Segmented v-model="sex" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" :height="30" style="min-width: 150px" />
      </div>
      <label class="frow row">
        <span class="t-body c2">Birth year</span><span class="grow" />
        <input class="t-ns ninput" :value="p.birthYear" inputmode="numeric" maxlength="4" enterkeyhint="done" @change="numInput($event, 'birthYear', 1920, 2014)" />
        <span class="t-label c3">· {{ age }} y</span>
      </label>
      <label class="frow row">
        <span class="t-body c2">Height</span><span class="grow" />
        <input class="t-ns ninput" :value="p.heightCm" inputmode="numeric" maxlength="3" enterkeyhint="done" @change="numInput($event, 'heightCm', 120, 230)" />
        <span class="t-label c2">cm</span>
      </label>
      <button type="button" class="frow row" @click="openWeight()">
        <span class="t-body c2">Weight</span><span class="grow" />
        <template v-if="!hasWeights"><span class="t-label c3">no weigh-ins · using {{ kg(p.startWeight) }} kg</span><span class="t-label">Weigh in</span></template>
        <template v-else><span class="row lowrow t-label c3"><AccuracyDot v-if="lowAccuracy" :interactive="false" />{{ lowAccuracy ? "trend · low accuracy" : "trend" }}</span>
        <span class="base"><span class="t-ns">{{ kg(trendWeight) }}</span><span class="t-label c2">kg</span></span></template>
        <Icon name="right" :size="16" class="c3" />
      </button>
      <button type="button" class="frow row last" :aria-expanded="actOpen" @click="actOpen = !actOpen">
        <span class="t-body c2">Activity</span><span class="grow" />
        <span class="t-ns">{{ ACTIVITY[p.activity].label }}</span>
        <span class="t-label c3">{{ ACTIVITY[p.activity].hint }}</span>
        <Icon :name="actOpen ? 'down' : 'right'" :size="16" class="c3" />
      </button>
      <div v-if="actOpen" class="acts">
        <button v-for="(a, k) in ACTIVITY" :key="k" type="button" class="act row" :class="{ on: k === p.activity }"
          @click="p.activity = k as ActivityKey; actOpen = false">
          <span class="t-body grow">{{ a.label }}</span>
          <span class="t-label c3">{{ a.hint }} · ×{{ a.factor }}</span>
          <Icon v-if="k === p.activity" name="check" :size="16" :sw="2.6" />
        </button>
      </div>
    </section>

    <GoalReached />
    <section class="card goal">
      <div class="row"><span id="goal-h" class="t-cap c2">Goal</span><span class="grow" /><ManualTag v-if="mode === 'manual'" /></div>
      <!-- S7: goal mode; only the active mode's fields are shown -->
      <Segmented v-model="mode" aria-labelledby="goal-h" :options="[{ value: 'rate', label: 'By rate' }, { value: 'manual', label: 'My own number' }]" />
      <template v-if="mode === 'manual'">
        <div class="row mrow">
          <label for="manual-kcal" class="t-body c2 grow">Daily calories</label>
          <button type="button" class="cbtn stp" aria-label="10 kcal less" @click="stepManual(-10)"><Icon name="minus" :size="16" :sw="2.4" /></button>
          <input id="manual-kcal" v-model="manualText" class="t-ns ninput mk" inputmode="numeric" enterkeyhint="done" :aria-invalid="!!manualErr" aria-describedby="manual-msg"
            @change="manualInput" @keydown.enter.prevent="manualInput" />
          <span class="t-label c2">kcal</span>
          <button type="button" class="cbtn stp" aria-label="10 kcal more" @click="stepManual(10)"><Icon name="plus" :size="16" :sw="2.4" /></button>
        </div>
        <p id="manual-msg" class="t-capn m0" :class="manualErr ? 'errt' : 'c2'">{{ manualErr ? `! ${manualErr}` : `1,200–5,000 kcal in steps of 10 · ${manualInfo}` }}</p>
        <p v-if="targets.belowBmr" class="t-capn warn m0" role="status"><Icon name="info" :size="14" />Below your BMR ({{ int(targets.bmr) }} kcal). Kept as you set it.</p>
        <p v-if="targets.fatCut" class="t-capn warn m0" role="status"><Icon name="info" :size="14" />Your calories don't cover your protein and fat settings; fat is reduced to fit. Carbs are 0.</p>
      </template>
      <template v-else>
      <Segmented v-model="goal" :options="[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]" />
      <div v-if="p.goal !== 'maintain'" class="row rate">
        <span class="t-body c2">Rate</span><span class="grow" />
        <button v-for="r in RATES" :key="r" type="button" class="chip t-label" :class="{ on: p.rate === r }" @click="p.rate = r">{{ r === 1 ? "1.0" : r }}</button>
        <span class="t-label c3">kg/wk</span>
      </div>
      </template>
      <label class="row gw">
        <span class="t-body c2">Goal weight</span><span class="grow" />
        <input class="t-ns ninput" :value="kg(p.goalWeight)" inputmode="decimal" maxlength="5" enterkeyhint="done" aria-label="Goal weight in kg" @change="goalInput" />
        <span class="t-label c2">kg</span>
      </label>
      <span class="t-capn c2">{{ mode === "manual" ? (p.manualDir === "gain" ? "We'll ask when your trend reaches this weight." : "We'll ask when your trend gets down to this weight.") : goalNote }}</span>
    </section>

    </div>
    <div class="pcol side">
    <section class="card targets">
      <div class="row"><span class="t-cap c2">Your targets</span><span class="grow" /></div>
      <div v-if="cur" class="since col">
        <span class="t-label">Current target since {{ sinceLabel }}</span>
        <span class="t-capn c2">{{ reasonText(cur) }} · {{ cur.note }}</span>
      </div>
      <div class="row stats end">
        <div class="col grow"><span class="t-capm c2">BMR</span><span class="base"><span class="t-ns">{{ int(cur?.bmr ?? targets.bmr) }}</span><span class="t-label c2">kcal</span></span></div>
        <div class="col grow"><span class="t-capm c2">Daily burn</span><span class="base"><span class="t-ns">{{ int(cur?.tdee ?? targets.tdee) }}</span><span class="t-label c2">kcal</span></span></div>
        <div class="col grow"><span class="row g4"><span class="t-capm c2">Eat</span><ManualTag v-if="cur?.mode === 'manual'" /></span><span class="base"><span class="t-nm">{{ int(shown.kcal) }}</span><span class="t-label c2">kcal</span></span></div>
      </div>
      <div class="divider" />
      <div class="row stats">
        <div class="col grow"><span class="t-capm c2">Protein</span><span class="base"><span class="t-ns">{{ shown.p }}</span><span class="t-label c2">g</span></span><span class="t-capn c3">{{ p.proteinPerKg.toFixed(1) }} g/kg</span></div>
        <div class="col grow"><span class="t-capm c2">Fat</span><span class="base"><span class="t-ns">{{ shown.f }}</span><span class="t-label c2">g</span></span><span class="t-capn c3">{{ p.fatPct }}% of kcal</span></div>
        <div class="col grow"><span class="t-capm c2">Carbs</span><span class="base"><span class="t-ns">{{ shown.c }}</span><span class="t-label c2">g</span></span><span class="t-capn c3">the rest</span></div>
      </div>
      <p v-if="cur && nextKcal !== cur.kcal" class="t-capn c2 m0">Next weekly update {{ weekdayShort(nextMonday) }} {{ dayMonth(nextMonday) }}: about {{ int(nextKcal) }} kcal from your latest trend.</p>
      <p v-if="cur ? cur.floored : targets.floored" class="t-capn floor">Raised to your BMR — the target never goes below it. Consider a slower rate.</p>
    </section>
    <MacroBalance />
    <TargetHistory v-if="state.history.length" />

    <p v-if="vp.tablet" class="t-capn c3 how">BMR uses Mifflin-St Jeor with your trend weight. Daily burn = BMR × activity factor. <template v-if="p.goalMode === 'manual'">Eat = your own number; protein = g/kg × trend weight, fat = % of kcal, carbs the rest. Updated every Monday from the trend; the number stays.</template><template v-else>Eat = burn {{ p.goal === "lose" ? "−" : p.goal === "gain" ? "+" : "±" }} {{ int(Math.abs(targets.delta)) }} kcal ({{ p.goal === "maintain" ? "maintain" : `${p.rate} kg/week × 7,700 kcal ÷ 7` }}).</template></p>
    </div>
    </div>
    <!-- Prototype only: reviewer switch for states (hidden by default) -->
    <section class="demo col">
      <button type="button" class="row dhead" :aria-expanded="demoOpen" @click="demoOpen = !demoOpen">
        <span class="t-label c3 grow">Prototype · Demo states</span>
        <span class="t-capn c3">{{ demoLabel }}</span>
        <Icon :name="demoOpen ? 'down' : 'right'" :size="14" class="c3" />
      </button>
      <div v-if="demoOpen" class="dlist col" role="radiogroup" aria-label="Demo state">
        <button v-for="d in DEMO_STATES" :key="d.key" type="button" role="radio" :aria-checked="ui.demo === d.key" class="drow row" :class="{ on: ui.demo === d.key }" @click="demo(d.key)">
          <span class="col grow"><span class="t-label">{{ d.label }}</span><span class="t-capn c3">{{ d.hint }}</span></span>
          <Icon v-if="ui.demo === d.key" name="check" :size="14" :sw="2.6" />
        </button>
        <span class="t-capn c3 dnote">All data in this prototype is fictional. “Normal” restores the example data. Also: add ?demo=empty (etc.) to the URL.</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.about { gap: 0; padding-top: 12px; padding-bottom: 4px; }
.frow { min-height: 44px; flex-wrap: wrap; row-gap: 2px; gap: 8px; border-bottom: 1px solid var(--color-border); width: 100%; text-align: left; }
.frow.last { border-bottom: 0; }
.ninput { width: 3.6em; text-align: right; background: transparent; border: 0; outline: 0; padding: 0; color: var(--text-primary); border-radius: 0; -webkit-appearance: none; appearance: none; }
.ninput:focus { color: #fff; text-decoration: underline; text-underline-offset: 4px; text-decoration-color: var(--text-tertiary); }
.acts { display: flex; flex-direction: column; padding: 4px 0 8px; border-top: 1px solid var(--color-border); }
.act { min-height: 44px; gap: 10px; padding: 0 8px; border-radius: 10px; text-align: left; }
.act.on { background: var(--color-surface-2); }
.goal { gap: 10px; padding-top: 12px; }
.rate { gap: 6px; flex-wrap: wrap; justify-content: flex-end; row-gap: 8px; }
.targets { padding-top: 12px; }
.g4 { gap: 6px; }
.mrow { gap: 8px; min-height: 44px; }
.mrow .mk { width: 3.4em; border-bottom: 1px solid var(--color-border-strong); }
.stp { --s: 32px; }
.warn { display: flex; gap: 6px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; border: 1px dashed var(--text-tertiary); color: var(--text-secondary); }
.errt { color: var(--text-primary); }
.since { gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); }
.m0 { margin: 0; }
.stats { gap: 8px; align-items: flex-start; }
.stats.end { align-items: flex-end; }
.stats .col { gap: 2px; }
.center { text-align: center; }
.gw { min-height: 44px; gap: 8px; border-top: 1px solid var(--color-border); cursor: text; }
.floor { margin: 0; padding: 8px 10px; border-radius: 10px; border: 1px dashed var(--text-tertiary); color: var(--text-secondary); }
.demo { margin-top: 32px; gap: 4px; border-top: 1px solid var(--color-border); padding-top: 8px; }
.dhead { gap: 8px; min-height: 44px; text-align: left; }
.dlist { gap: 2px; }
.drow { gap: 10px; min-height: 44px; padding: 6px 10px; border-radius: 10px; text-align: left; }
.drow.on { background: var(--color-surface); }
.can-hover .drow:hover { background: var(--color-surface); }
.dnote { padding: 8px 10px 0; }
.pgrid, .pcol { display: flex; flex-direction: column; gap: var(--space-gap); }
.two.pgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.two .pcol { gap: 16px; }
.two .side { position: sticky; top: calc(var(--sat) + 16px); }
.desk.pgrid { grid-template-columns: minmax(0, 1.2fr) minmax(360px, 1fr); gap: 24px; }
.desk .pcol { gap: 20px; }
.desk .side { top: 32px; }
.desk .targets { padding: 20px; gap: 16px; }
.how { margin: 0 4px; line-height: 1.45; }
.can-hover .frow:is(button):hover { background: linear-gradient(90deg, transparent, rgba(255,255,255,.03)); }
.stats > .col { min-width: 0; }
.lowrow { gap: 6px; align-items: center; }
</style>
