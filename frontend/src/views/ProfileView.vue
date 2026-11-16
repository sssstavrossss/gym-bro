<script setup lang="ts">
import { computed, ref } from "vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import Icon from "../components/Icon.vue";
import Segmented from "../components/Segmented.vue";
import TargetHistory from "../components/TargetHistory.vue";
import { ACTIVITY, FAT_PRESETS, PROTEIN_PRESETS, RATES, type ActivityKey, type Goal, type MacroSetting, type Sex } from "../lib/nutrition";
import { dayMonth, todayInZone } from "../lib/dates";
import { int, kg } from "../lib/format";
import { goalLine } from "../lib/goalLine";
import { parseDecimal } from "../lib/numbers";
import { commitProfile, deviceTimeZone, profile, shownTargets, weightCaption } from "../state/profile";
import { inbox } from "../state/inbox";
import { openNotifications, openRecalculate, openSettings, openWeight } from "../ui";
import { vp } from "../lib/viewport";

const actOpen = ref(false);
const customOpen = ref(false);
const year = new Date().getFullYear();
const age = computed(() => {
  if (!/^\d{4}$/.test(profile.form.birthYear.trim())) return null;
  return year - Number(profile.form.birthYear);
});
const shown = computed(() => shownTargets());
const caption = computed(() => weightCaption(profile.weight));
/** The date the targets in effect started. A preview of unsaved edits has none. */
const updated = computed(() => (shown.value && shown.value === profile.targets ? profile.targets.effectiveDate : null));

const balance = computed(() => {
  const form = profile.form;
  if (form.proteinSetting === "normal" && form.fatSetting === "normal") return "Normal";
  const protein = PROTEIN_PRESETS.find((item) => item.key === form.proteinSetting)?.label ?? `${form.proteinGramsPerKg} g/kg`;
  const fat = FAT_PRESETS.find((item) => item.key === form.fatSetting)?.label ?? `${form.fatPercent}%`;
  return `Protein ${protein.toLowerCase()} · fat ${fat.toLowerCase()}`;
});

const line = computed(() => {
  const weight = profile.weight;
  return goalLine({
    goal: profile.form.goal,
    weightKg: weight?.trendKg ?? weight?.usedKg ?? null,
    goalKg: parseDecimal(profile.form.goalWeightKg),
    rateKg: parseDecimal(profile.form.rate),
    today: todayInZone(profile.form.timeZone || deviceTimeZone()),
  });
});

function setSex(value: string) {
  profile.form.sex = value as Sex;
  void commitProfile();
}
function setGoal(value: string) {
  profile.form.goal = value as Goal;
  if (value === "maintain") profile.form.rate = "";
  void commitProfile();
}
function setActivity(key: ActivityKey) {
  profile.form.activity = key;
  actOpen.value = false;
  void commitProfile();
}
function setRate(rate: number) {
  profile.form.rate = rate === 1 ? "1.0" : String(rate);
  void commitProfile();
}
function setProtein(key: MacroSetting, value: number) {
  profile.form.proteinSetting = key;
  profile.form.proteinGramsPerKg = value.toFixed(1);
  void commitProfile();
}
function setFat(key: MacroSetting, value: number) {
  profile.form.fatSetting = key;
  profile.form.fatPercent = Number.isInteger(value) ? String(value) : value.toFixed(1);
  void commitProfile();
}
function onExactProtein() {
  const parsed = parseDecimal(profile.form.proteinGramsPerKg);
  if (parsed == null) return;
  profile.form.proteinSetting = "exact";
  profile.form.proteinGramsPerKg = parsed.toFixed(1);
  void commitProfile();
}
function onExactFat() {
  const parsed = parseDecimal(profile.form.fatPercent);
  if (parsed == null) return;
  profile.form.fatSetting = "exact";
  profile.form.fatPercent = String(parsed);
  void commitProfile();
}
function resetMacros() {
  profile.form.proteinSetting = "normal";
  profile.form.proteinGramsPerKg = "2.0";
  profile.form.fatSetting = "normal";
  profile.form.fatPercent = "25";
  void commitProfile();
}
function onTextCommit() {
  void commitProfile();
}
</script>

<template>
  <main class="screen">
    <header class="screen-head phead">
      <h1 class="t-title grow">Profile</h1>
      <button type="button" class="cbtn hbtn" :aria-label="inbox.badge > 0 ? 'Notifications, new' : 'Notifications'" data-bell @click="openNotifications">
        <Icon name="bell" :size="18" />
        <span v-if="inbox.badge > 0" class="hdot" aria-hidden="true" />
      </button>
      <button type="button" class="cbtn hbtn" aria-label="Settings" data-cog @click="openSettings">
        <Icon name="cog" :size="18" />
      </button>
    </header>

    <div class="pgrid" :class="{ two: vp.tablet, desk: vp.desktop }">
      <div class="pcol">
        <section v-if="shown" class="card o1" aria-labelledby="tg-h" data-targets>
          <div class="row thead">
            <h2 id="tg-h" class="section-title c2 grow">Your targets</h2>
            <span v-if="updated" class="t-capn c3" data-updated>Updated {{ dayMonth(updated) }}</span>
          </div>
          <div class="stats top">
            <div><span class="t-label c2">Eat</span><span class="figure"><span class="t-nm" data-field="kcal">{{ int(shown.kcal) }}</span><span class="t-label c2">kcal</span></span></div>
            <div><span class="t-label c2">Daily burn</span><span class="figure"><span class="t-ns" data-field="tdee">{{ int(shown.tdee) }}</span><span class="t-label c2">kcal</span></span></div>
            <div><span class="t-label c2">BMR</span><span class="figure"><span class="t-ns" data-field="bmr">{{ int(shown.bmr) }}</span><span class="t-label c2">kcal</span></span></div>
          </div>
          <div class="divider" />
          <div class="stats">
            <div><span class="t-label c2">Protein</span><span class="figure"><span class="t-ns" data-field="protein">{{ int(shown.protein) }}</span><span class="t-label c2">g</span></span></div>
            <div><span class="t-label c2">Fat</span><span class="figure"><span class="t-ns" data-field="fat">{{ int(shown.fat) }}</span><span class="t-label c2">g</span></span></div>
            <div><span class="t-label c2">Carbs</span><span class="figure"><span class="t-ns" data-field="carbs">{{ int(shown.carbs) }}</span><span class="t-label c2">g</span></span></div>
          </div>
          <p v-if="shown.floorApplied" class="t-body" data-floor="true">Raised to your BMR so the target does not go below it.</p>
          <button type="button" class="chip t-label recalc" @click="openRecalculate">Recalculate</button>
        </section>

        <TargetHistory class="o4" />
      </div>

      <div class="pcol">
        <section class="card o2" aria-labelledby="goal-h">
          <h2 id="goal-h" class="section-title c2">Goal</h2>
          <div class="compact-seg">
            <Segmented label="Goal" :model-value="profile.form.goal" :options="[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]" @update:model-value="setGoal" />
          </div>
          <div v-if="profile.form.goal !== 'maintain'" class="rate" role="group" aria-label="Rate">
            <span class="t-body c2">Rate</span>
            <button v-for="rate in RATES" :key="rate" type="button" class="chip t-label" :class="{ on: Number(profile.form.rate) === rate }" @click="setRate(rate)">{{ rate === 1 ? "1.0" : rate }}</button>
            <span class="t-label c2">kg/wk</span>
          </div>
          <div class="col">
            <label class="frow">
              <span class="t-body c2">Goal weight</span>
              <span class="fval">
                <input v-model="profile.form.goalWeightKg" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Goal weight in kilograms" @blur="onTextCommit" />
                <span class="t-label c2">kg</span>
              </span>
            </label>
            <button type="button" class="frow" :class="{ last: !customOpen }" :aria-expanded="customOpen" data-macro-balance @click="customOpen = !customOpen">
              <span class="t-body c2">Macro balance</span>
              <span class="grow" />
              <span class="t-body bal">{{ balance }}</span>
              <Icon :name="customOpen ? 'down' : 'right'" :size="16" class="fchev" />
            </button>
          </div>
          <div v-if="customOpen" class="custom">
            <div role="group" aria-label="Protein">
              <span class="t-label c2">Protein</span>
              <div class="rate">
                <button v-for="item in PROTEIN_PRESETS" :key="item.key" type="button" class="chip t-label" :class="{ on: profile.form.proteinSetting === item.key }" @click="setProtein(item.key, item.value)">{{ item.label }}</button>
              </div>
              <label class="frow last">
                <span class="t-body c2">Exact</span>
                <span class="fval">
                  <input v-model="profile.form.proteinGramsPerKg" class="ninput" type="text" inputmode="decimal" aria-label="Exact protein, grams per kilogram" @blur="onExactProtein" />
                  <span class="t-label c2">g/kg</span>
                </span>
              </label>
            </div>
            <div role="group" aria-label="Fat">
              <span class="t-label c2">Fat</span>
              <div class="rate">
                <button v-for="item in FAT_PRESETS" :key="item.key" type="button" class="chip t-label" :class="{ on: profile.form.fatSetting === item.key }" @click="setFat(item.key, item.value)">{{ item.label }}</button>
              </div>
              <label class="frow last">
                <span class="t-body c2">Exact</span>
                <span class="fval">
                  <input v-model="profile.form.fatPercent" class="ninput" type="text" inputmode="decimal" aria-label="Exact fat, percent" @blur="onExactFat" />
                  <span class="t-label c2">%</span>
                </span>
              </label>
            </div>
            <button type="button" class="chip t-label reset" @click="resetMacros">Reset to default</button>
            <p class="t-body c2 m0">More carbs means less protein or fat.</p>
          </div>
          <p v-if="line" class="t-label c2 m0 gline" data-goal-line>
            <template v-if="line.kind === 'reached'">You're at your goal weight.</template>
            <template v-else>{{ kg(line.fromKg) }} → {{ kg(line.toKg) }} kg · <b>{{ kg(line.leftKg) }} kg to go</b>, about <b>{{ line.weeks }} {{ line.weeks === 1 ? "week" : "weeks" }}</b> ({{ line.by }})</template>
          </p>
        </section>

        <section class="card about o3" aria-labelledby="about-h">
          <h2 id="about-h" class="section-title c2 about-kicker">About you</h2>
          <div class="frow sexrow compact-seg">
            <span class="t-body c2">Sex</span>
            <span class="grow" />
            <Segmented class="sexseg" label="Sex" :model-value="profile.form.sex" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" @update:model-value="setSex" />
          </div>
          <label class="frow">
            <span class="t-body c2">Birth year</span>
            <span class="fval">
              <input v-model="profile.form.birthYear" class="ninput" type="text" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Birth year" @blur="onTextCommit" />
              <span v-if="age !== null" class="t-label c2">{{ age }} y</span>
            </span>
          </label>
          <label class="frow">
            <span class="t-body c2">Height</span>
            <span class="fval">
              <input v-model="profile.form.heightCm" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Height in centimetres" @blur="onTextCommit" />
              <span class="t-label c2">cm</span>
            </span>
          </label>
          <button type="button" class="frow" @click="openWeight()">
            <span class="t-body c2">Weight</span>
            <span class="grow" />
            <span class="row lowrow t-label c2">
              <AccuracyDot v-if="caption.low" :interactive="false" />
              {{ caption.label }}
            </span>
            <span class="fval t-ns">{{ caption.value }}</span>
            <Icon name="right" :size="16" class="fchev" />
          </button>
          <button type="button" class="frow last" :aria-expanded="actOpen" @click="actOpen = !actOpen">
            <span class="t-body c2">Activity</span>
            <span class="grow" />
            <span class="t-body">{{ profile.form.activity ? ACTIVITY[profile.form.activity].label : "Choose" }}</span>
            <Icon :name="actOpen ? 'down' : 'right'" :size="16" class="fchev" />
          </button>
          <div v-if="actOpen" class="acts">
            <button v-for="(item, key) in ACTIVITY" :key="key" type="button" class="act" :class="{ on: key === profile.form.activity }" @click="setActivity(key)">
              <span class="t-body grow">{{ item.label }}</span>
              <span class="t-label c2">{{ item.hint }}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
    <p v-if="profile.error" class="alert" role="alert">{{ profile.error }}</p>
  </main>
</template>

<style scoped>
.phead { gap: 4px; }
.phead .t-title { min-width: 0; }
/* The discs line up with the page's right edge: the 44px hit box overhangs by the gap around the 32px disc. */
.hbtn { color: var(--text-secondary); }
.hbtn:last-child { margin-right: calc((var(--control-s) - var(--control-hit)) / 2); }
.hdot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--text-primary); box-shadow: 0 0 0 2px var(--color-bg); }
.thead { align-items: baseline; gap: 8px; }
[data-targets] { container-type: inline-size; }
/* Narrow phones: Eat gets its own line. */
@container (max-width: 290px) {
  .stats.top { flex-wrap: wrap; row-gap: var(--space-gap); }
  .stats.top > div:first-child { flex-basis: 100%; }
}
.gline b { color: var(--text-primary); font-weight: 600; }
.m0 { margin: 0; }
.bal { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.frow { min-height: 44px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--color-border); width: 100%; text-align: left; }
.sexrow { flex-wrap: wrap; }
.compact-seg :deep(.seg) { min-height: 30px; padding: 3px; border-radius: 10px; }
.sexrow :deep(.seg) { width: auto; flex: 0 0 auto; min-width: 150px; margin-left: auto; }
html:not(.dt-xl) .compact-seg :deep(.seg-btn) {
  min-width: 44px; min-height: 24px; padding: 2px 8px; border-radius: 8px;
}
html:not(.dt-xl) .sexrow :deep(.seg-btn) { padding: 2px var(--space-gap); }
html:not(.dt-xl) .compact-seg :deep(.seg-btn)::after {
  content: ""; position: absolute; inset: min(0px, calc((100% - 44px) / 2)) 0;
}
.lowrow { gap: 6px; }
.frow.last { border-bottom: 0; }
.fval { display: inline-flex; align-items: baseline; gap: 8px; margin-left: auto; white-space: nowrap; flex-wrap: nowrap; flex: none; }
.fval .ninput { margin-left: 0; }
.ninput { width: 88px; margin-left: auto; text-align: right; background: transparent; border: 0; min-height: 44px; }
.fchev { color: var(--text-tertiary); flex: none; }
.recalc, .reset { align-self: flex-start; }
.acts, .custom { display: flex; flex-direction: column; gap: var(--space-gap); }
.act { min-height: 44px; display: flex; align-items: center; gap: 10px; text-align: left; border-radius: 10px; padding: 0 8px; }
.act.on { background: var(--color-surface-2); }
.rate { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.stats { display: flex; gap: 12px; }
.stats > div { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.figure { display: inline-flex; align-items: baseline; gap: 4px; flex-wrap: nowrap; white-space: nowrap; min-width: 0; }
/* Phone: one column in order of importance. Wider: outputs (targets, history) left, inputs (goal, about you) right. */
.pgrid, .pcol { display: flex; flex-direction: column; gap: var(--space-gap); min-width: 0; }
.pgrid:not(.two):not(.desk) .pcol { display: contents; }
.pgrid:not(.two):not(.desk) .o1 { order: 1; }
.pgrid:not(.two):not(.desk) .o2 { order: 2; }
.pgrid:not(.two):not(.desk) .o3 { order: 3; }
.pgrid:not(.two):not(.desk) .o4 { order: 4; }
.two.pgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.desk.pgrid { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; }
.two .frow, .desk .frow { min-width: 0; }
h2 { margin: 0; }
/* xxxL and up: label on top, value under it, left-aligned. A value never splits from its unit. */
.dt-l .about-kicker { letter-spacing: 0.04em; text-transform: uppercase; }
.dt-l .frow { position: relative; flex-direction: column; flex-wrap: nowrap; align-items: flex-start; gap: 2px; padding: 8px 0; height: auto; }
.dt-l .frow > .grow { display: none; }
.dt-l .frow > * { max-width: 100%; }
.dt-l .frow:has(.fchev) { padding-right: 28px; }
.dt-l .fchev { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
.dt-l .fval { margin-left: 0; }
.dt-l .fval .ninput { width: 6.5ch; min-width: 2ch; text-align: left; }
@supports (field-sizing: content) {
  .dt-l .fval .ninput { field-sizing: content; width: auto; min-width: 2ch; }
}
.dt-l .sexrow :deep(.seg) { flex: 1 1 auto; width: 100%; max-width: 100%; min-width: 0; align-self: stretch; }
.dt-l .lowrow { white-space: normal; max-width: 100%; }
.dt-l .bal { white-space: normal; }
.dt-xl .stats { flex-direction: column; align-items: stretch; }
.dt-xl .stats > div { width: 100%; max-width: 100%; }
.dt-xl .pcol > p { max-width: 100%; overflow-wrap: anywhere; }
</style>
