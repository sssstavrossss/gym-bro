<script setup lang="ts">
import { computed, ref } from "vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import Icon from "../components/Icon.vue";
import NumberField from "../components/NumberField.vue";
import Segmented from "../components/Segmented.vue";
import TargetHistory from "../components/TargetHistory.vue";
import { ACTIVITY, FAT_PRESETS, PROTEIN_PRESETS, RATES, type ActivityKey, type Goal, type MacroSetting, type Sex } from "../lib/nutrition";
import { dayMonth, todayInZone } from "../lib/dates";
import { int } from "../lib/format";
import { fatCaption, goalStats, isExact, proteinCaption, saturatedCaption, sodiumCaption } from "../lib/goalCards";
import { goalLine } from "../lib/goalLine";
import { fatLimits, fatLimitsOf, sodiumLimitMg, sodiumLimitOf, type FatLimitsSetting, type SodiumLimitSetting } from "../lib/nutrientCards";
import { parseDecimal } from "../lib/numbers";
import { rateText, toKg } from "../lib/units";
import { commitProfile, deviceTimeZone, profile, setFatLimits, setSodiumLimit, shownTargets, weightCaption } from "../state/profile";
import { inbox } from "../state/inbox";
import { heightUnit, weightUnit, wt } from "../state/units";
import { openGoalWeight, openNotifications, openRecalculate, openSettings, openWeight } from "../ui";
import { vp } from "../lib/viewport";

const actOpen = ref(false);
const exactOpen = ref(false);
const year = new Date().getFullYear();
const age = computed(() => {
  if (!/^\d{4}$/.test(profile.form.birthYear.trim())) return null;
  return year - Number(profile.form.birthYear);
});
const shown = computed(() => shownTargets());
const caption = computed(() => weightCaption(profile.weight, weightUnit()));
/** The date the targets in effect started. A preview of unsaved edits has none. */
const updated = computed(() => (shown.value && shown.value === profile.targets ? profile.targets.effectiveDate : null));

const goalOptions: { value: Goal; label: string }[] = [{ value: "lose", label: "Lose" }, { value: "maintain", label: "Maintain" }, { value: "gain", label: "Gain" }];
const rateOptions = computed(() => RATES.map((rate) => ({ value: String(rate), label: rateText(rate, weightUnit()) })));
/** The rate as one of the options' values ("0.5", "1"), or "" when none is set. */
const rateValue = computed(() => (profile.form.rate.trim() ? String(Number(profile.form.rate)) : ""));
const presetOptions = (presets: readonly { key: string; label: string }[]) => presets.map((item) => ({ value: item.key as MacroSetting, label: item.label }));
const proteinOptions = presetOptions(PROTEIN_PRESETS);
const fatOptions = presetOptions(FAT_PRESETS);
const saturatedOptions: { value: FatLimitsSetting; label: string }[] = [{ value: "normal", label: "Standard" }, { value: "lower", label: "Strict" }];

const saturated = computed(() => fatLimitsOf(profile.saved?.fatLimits));
const limits = computed(() => fatLimits(saturated.value, shown.value?.kcal));
const sodiumOptions: { value: SodiumLimitSetting; label: string }[] = [{ value: "normal", label: "Standard" }, { value: "lower", label: "Strict" }];
const sodium = computed(() => sodiumLimitOf(profile.saved?.sodiumLimit));
const limitsError = ref("");
const macrosDefault = computed(() => profile.form.proteinSetting === "normal" && profile.form.fatSetting === "normal" && saturated.value === "normal" && sodium.value === "normal");

const goalKg = computed(() => {
  const typed = parseDecimal(profile.form.goalWeight);
  return typed == null ? null : toKg(typed, profile.form.weightUnit);
});

const line = computed(() => {
  const weight = profile.weight;
  return goalLine({
    goal: profile.form.goal,
    weightKg: weight?.trendKg ?? weight?.usedKg ?? null,
    goalKg: goalKg.value,
    rateKg: parseDecimal(profile.form.rate),
    today: todayInZone(profile.form.timeZone || deviceTimeZone()),
  });
});
const stats = computed(() => (line.value?.kind === "way" ? goalStats(line.value, wt, weightUnit()) : null));

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
function setRate(value: string) {
  const rate = Number(value);
  profile.form.rate = rate === 1 ? "1.0" : String(rate);
  void commitProfile();
}
function setProtein(key: MacroSetting) {
  const preset = PROTEIN_PRESETS.find((item) => item.key === key);
  if (!preset) return;
  profile.form.proteinSetting = key;
  profile.form.proteinGramsPerKg = preset.value.toFixed(1);
  void commitProfile();
}
function setFat(key: MacroSetting) {
  const preset = FAT_PRESETS.find((item) => item.key === key);
  if (!preset) return;
  profile.form.fatSetting = key;
  profile.form.fatPercent = String(preset.value);
  void commitProfile();
}
/** Saturated fat only sets the Fats card limits, so it saves as a setting and leaves the targets alone. */
async function setSaturated(value: FatLimitsSetting) {
  limitsError.value = await setFatLimits(value);
}
/** The same for sodium: only the Carbs card and the Progress Sodium page change. */
async function setSodium(value: SodiumLimitSetting) {
  limitsError.value = await setSodiumLimit(value);
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
  if (saturated.value !== "normal") void setSaturated("normal");
  if (sodium.value !== "normal") void setSodium("normal");
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
      <button type="button" class="cbtn hbtn" aria-label="Settings" data-cog @click="openSettings()">
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
          <button type="button" class="btn sm primary t-label recalc" @click="openRecalculate"><Icon name="refresh" :size="14" /> Recalculate</button>
        </section>

        <TargetHistory class="o4" />
      </div>

      <div class="pcol">
        <section class="card o2" aria-labelledby="goal-h">
          <h2 id="goal-h" class="section-title c2">Goal</h2>
          <Segmented size="compact" class="full" label="Goal" :model-value="profile.form.goal" :options="goalOptions" @update:model-value="setGoal" />
          <div class="col">
            <div v-if="profile.form.goal !== 'maintain'" class="frow mrow">
              <span class="col mlab">
                <span class="t-body c2">Rate</span>
                <span class="t-capn c2">{{ weightUnit() }}/wk</span>
              </span>
              <Segmented size="compact" label="Rate" :model-value="rateValue" :options="rateOptions" @update:model-value="setRate" />
            </div>
            <!-- Named by its own text (axe: the name must contain what is shown); the spaces keep the words apart. -->
            <button type="button" class="frow last" data-goal-weight @click="openGoalWeight">
              <span class="t-body c2">Goal weight</span> <span class="gfield"><span class="t-body t-ns gnum">{{ profile.form.goalWeight || "—" }}</span> <span class="t-label c2">{{ weightUnit() }}</span><span class="sr-only">, change</span><Icon name="edit" :size="14" class="c3" /></span>
            </button>
          </div>
          <dl v-if="stats" class="gstats" data-goal-line>
            <div v-for="item in stats" :key="item.label">
              <dt class="t-capn c2">{{ item.label }}</dt>
              <dd class="t-bodys">{{ item.value }}</dd>
            </div>
          </dl>
          <p v-else-if="line?.kind === 'reached'" class="t-label c2 m0 gstats reached" data-goal-line>You're at your goal weight.</p>
        </section>

        <section class="card o2" aria-labelledby="macros-h" data-macros>
          <div class="row thead">
            <h2 id="macros-h" class="section-title c2 grow">Macros</h2>
            <span v-if="shown" class="t-capn c2">of {{ int(shown.kcal) }} kcal</span>
          </div>
          <div class="col">
            <div class="frow mrow" role="group" aria-labelledby="m-protein">
              <span class="col mlab">
                <span class="row mname"><span id="m-protein" class="t-body">Protein</span><span v-if="isExact(profile.form.proteinSetting)" class="xmark t-capn" data-exact>Exact</span></span>
                <span class="t-capn c2">{{ proteinCaption(profile.form.proteinGramsPerKg, shown?.protein ?? null) }}</span>
              </span>
              <Segmented size="compact" label="Protein" :model-value="profile.form.proteinSetting" :options="proteinOptions" @update:model-value="setProtein" />
            </div>
            <div class="frow mrow" role="group" aria-labelledby="m-fat">
              <span class="col mlab">
                <span class="row mname"><span id="m-fat" class="t-body">Fat</span><span v-if="isExact(profile.form.fatSetting)" class="xmark t-capn" data-exact>Exact</span></span>
                <span class="t-capn c2">{{ fatCaption(profile.form.fatPercent, shown?.fat ?? null) }}</span>
              </span>
              <Segmented size="compact" label="Fat" :model-value="profile.form.fatSetting" :options="fatOptions" @update:model-value="setFat" />
            </div>
            <div class="frow mrow">
              <span class="col mlab">
                <span class="t-body">Carbs</span>
                <span class="t-capn c2">The rest of the calories</span>
              </span>
              <span v-if="shown" class="t-body t-ns mval">{{ int(shown.carbs) }} g</span>
            </div>
            <div class="frow mrow" data-saturated-setting>
              <span class="col mlab">
                <span class="t-body">Saturated fat</span>
                <span class="t-capn c2" data-saturated-caption>{{ saturatedCaption(limits) }}</span>
              </span>
              <Segmented size="compact" label="Saturated fat" :model-value="saturated" :options="saturatedOptions" @update:model-value="setSaturated" />
            </div>
            <div class="frow mrow" :class="{ last: !exactOpen }" data-sodium-setting>
              <span class="col mlab">
                <span class="t-body">Sodium</span>
                <span class="t-capn c2" data-sodium-caption>{{ sodiumCaption(sodiumLimitMg(sodium)) }}</span>
              </span>
              <Segmented size="compact" label="Sodium" :model-value="sodium" :options="sodiumOptions" @update:model-value="setSodium" />
            </div>
            <template v-if="exactOpen">
              <label class="frow">
                <span class="t-body c2">Exact protein</span>
                <span class="fval">
                  <NumberField v-model="profile.form.proteinGramsPerKg" class="ninput" dial="profile.protein" label="Exact protein, grams per kilogram" :format="(v) => v.toFixed(1)" @commit="onExactProtein" />
                  <span class="t-label c2">g/kg</span>
                </span>
              </label>
              <label class="frow last">
                <span class="t-body c2">Exact fat</span>
                <span class="fval">
                  <NumberField v-model="profile.form.fatPercent" class="ninput" dial="profile.fat" label="Exact fat, percent" @commit="onExactFat" />
                  <span class="t-label c2">%</span>
                </span>
              </label>
            </template>
          </div>
          <p v-if="limitsError" class="t-body m0" role="alert">{{ limitsError }}</p>
          <div class="row macts">
            <button type="button" class="btn sm secondary t-label" :aria-expanded="exactOpen" data-exact-values @click="exactOpen = !exactOpen"><Icon :name="exactOpen ? 'check' : 'edit'" :size="14" /> {{ exactOpen ? "Done" : "Exact values" }}</button>
            <button v-if="!macrosDefault" type="button" class="btn sm secondary t-label" @click="resetMacros"><Icon name="undo" :size="14" /> Reset</button>
          </div>
        </section>

        <section class="card about o3" aria-labelledby="about-h">
          <h2 id="about-h" class="section-title c2 about-kicker">About you</h2>
          <div class="frow sexrow">
            <span class="t-body c2">Sex</span>
            <span class="grow" />
            <Segmented size="compact" class="sexseg" label="Sex" :model-value="profile.form.sex" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" @update:model-value="setSex" />
          </div>
          <label class="frow">
            <span class="t-body c2">Birth year</span>
            <span class="fval">
              <NumberField v-model="profile.form.birthYear" class="ninput" dial="body.year" label="Birth year" inputmode="numeric" :maxlength="4" :min="year - 100" :max="year - 13" :live="(y) => `${year - y} y`" @commit="onTextCommit" />
              <span v-if="age !== null" class="t-label c2">{{ age }} y</span>
            </span>
          </label>
          <label v-if="heightUnit() === 'cm'" class="frow">
            <span class="t-body c2">Height</span>
            <span class="fval">
              <NumberField v-model="profile.form.heightCm" class="ninput" dial="body.height.cm" label="Height in centimetres" @commit="onTextCommit" />
              <span class="t-label c2">cm</span>
            </span>
          </label>
          <div v-else class="frow" role="group" aria-label="Height">
            <span class="t-body c2">Height</span>
            <span class="fval">
              <NumberField v-model="profile.form.heightFt" class="ninput ft" dial="body.height.ft" label="Height, feet" inputmode="numeric" :maxlength="1" @commit="onTextCommit" />
              <span class="t-label c2">ft</span>
              <NumberField v-model="profile.form.heightIn" class="ninput inch" dial="body.height.in" label="Height, inches" :maxlength="4" @commit="onTextCommit" />
              <span class="t-label c2">in</span>
            </span>
          </div>
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
.phead { gap: var(--space-xs); }
.phead .t-title { min-width: 0; }
/* The discs line up with the page's right edge: the 44px hit box overhangs by the gap around the 32px disc. */
.hbtn { color: var(--text-secondary); }
.hbtn:last-child { margin-right: calc((var(--control-s) - var(--control-hit)) / 2); }
.hdot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--text-primary); box-shadow: 0 0 0 2px var(--color-bg); }
.thead { align-items: baseline; gap: var(--space-s); }
[data-targets] { container-type: inline-size; }
/* Narrow phones: Eat gets its own line. */
@container (max-width: 290px) {
  .stats.top { flex-wrap: wrap; row-gap: var(--space-m); }
  .stats.top > div:first-child { flex-basis: 100%; }
}
.m0 { margin: 0; }
.frow { min-height: 44px; display: flex; align-items: center; gap: var(--space-s); border-bottom: 1px solid var(--color-border); width: 100%; text-align: left; }
.sexrow { flex-wrap: wrap; }
.lowrow { gap: var(--space-s); }
.frow.last { border-bottom: 0; }
.fval { display: inline-flex; align-items: baseline; gap: var(--space-s); margin-left: auto; white-space: nowrap; flex-wrap: nowrap; flex: none; }
.fval .ninput { margin-left: 0; }
.ninput { width: 88px; margin-left: auto; text-align: right; background: transparent; border: 0; min-height: 44px; }
.ninput.ft { width: 32px; }
.ninput.inch { width: 4.2ch; }
.fchev { color: var(--text-tertiary); flex: none; }
.recalc { align-self: flex-start; }
/* A row with a label and a caption on the left and a control on the right. */
.mrow { min-height: 52px; padding: var(--space-xs) 0; }
.mlab { flex: 1 1 auto; min-width: 0; gap: var(--space-2xs); }
.mname { gap: var(--space-s); }
.mval { margin-left: auto; white-space: nowrap; }
/* Set by hand: no preset is lit, so a quiet mark says why. */
.xmark { padding: 0 var(--space-s); border-radius: 999px; box-shadow: inset 0 0 0 1px var(--color-border-strong, var(--color-border)); color: var(--text-secondary); line-height: 1.5; }
/* Goal weight reads as a field: a tinted box with a pencil. It opens the goal weight sheet. */
.gfield { display: inline-flex; align-items: center; gap: var(--space-xs); flex: none; margin-left: auto; min-height: 36px; padding: 0 var(--space-m); border-radius: var(--radius-m); background: var(--color-surface-2); box-shadow: var(--d-sunk); }
.gnum { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.gfield .c3 { align-self: center; margin-left: var(--space-2xs); }
/* The goal's three figures use the shared .gstats (main.css). */
.gstats.reached { display: block; }
.macts { gap: var(--space-s); flex-wrap: wrap; }
.macts .btn { display: inline-flex; align-items: center; gap: var(--space-xs); }
.acts { display: flex; flex-direction: column; gap: var(--space-m); }
.act { min-height: 44px; display: flex; align-items: center; gap: var(--space-m); text-align: left; border-radius: var(--radius-m); padding: 0 var(--space-s); }
.act.on { background: var(--color-surface-2); }
.stats { display: flex; gap: var(--space-m); }
.stats > div { flex: 1; display: flex; flex-direction: column; gap: var(--space-2xs); min-width: 0; }
.figure { display: inline-flex; align-items: baseline; gap: var(--space-xs); flex-wrap: nowrap; white-space: nowrap; min-width: 0; }
/* Phone: one column in order of importance. Wider: outputs (targets, history) left, inputs (goal, about you) right. */
.pgrid, .pcol { display: flex; flex-direction: column; gap: var(--space-m); min-width: 0; }
.pgrid:not(.two):not(.desk) .pcol { display: contents; }
.pgrid:not(.two):not(.desk) .o1 { order: 1; }
.pgrid:not(.two):not(.desk) .o2 { order: 2; }
.pgrid:not(.two):not(.desk) .o3 { order: 3; }
.pgrid:not(.two):not(.desk) .o4 { order: 4; }
.two.pgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-l); align-items: start; }
.desk.pgrid { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: var(--space-xl); }
.two .frow, .desk .frow { min-width: 0; }
h2 { margin: 0; }
/* xxxL and up: label on top, value under it, left-aligned. A value never splits from its unit. */
.dt-l .about-kicker { letter-spacing: 0.04em; text-transform: uppercase; }
.dt-l .frow { position: relative; flex-direction: column; flex-wrap: nowrap; align-items: flex-start; gap: var(--space-2xs); padding: var(--space-s) 0; height: auto; }
.dt-l .frow > .grow { display: none; }
.dt-l .frow > * { max-width: 100%; }
.dt-l .frow:has(.fchev) { padding-right: var(--space-2xl); }
.dt-l .fchev { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
.dt-l .fval, .dt-l .gfield, .dt-l .mval { margin-left: 0; }
.dt-l .fval .ninput { width: 6.5ch; min-width: 2ch; text-align: left; }
@supports (field-sizing: content) {
  .dt-l .fval .ninput { field-sizing: content; width: auto; min-width: 2ch; }
}
.dt-l .sexrow :deep(.seg), .dt-l .mrow :deep(.seg) { flex: 1 1 auto; width: 100%; max-width: 100%; min-width: 0; align-self: stretch; }
.dt-l .lowrow { white-space: normal; max-width: 100%; }
.dt-xl .stats { flex-direction: column; align-items: stretch; }
.dt-xl .stats > div { width: 100%; max-width: 100%; }
.dt-xl .pcol > p { max-width: 100%; overflow-wrap: anywhere; }
</style>
