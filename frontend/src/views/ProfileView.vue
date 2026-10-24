<script setup lang="ts">
import { computed, ref } from "vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import Icon from "../components/Icon.vue";
import Segmented from "../components/Segmented.vue";
import { ACTIVITY, FAT_PRESETS, PROTEIN_PRESETS, RATES, type ActivityKey, type Goal, type MacroSetting, type Sex } from "../lib/nutrition";
import { parseDecimal } from "../lib/numbers";
import { boot } from "../state/boot";
import { clearAllDrafts, commitProfile, profile, shownTargets, weightCaption } from "../state/profile";
import { signOut } from "../auth/session";
import { openWeight } from "../ui";
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
const gap = computed(() => {
  const current = shown.value;
  if (!current) return "";
  const diff = current.tdee - current.kcal;
  if (diff === 0) return "Eat what you burn.";
  if (diff > 0) return `About ${diff} kcal a day below burn.`;
  return `About ${-diff} kcal a day above burn.`;
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
async function onSignOut() {
  if (!boot.config) return;
  clearAllDrafts();
  await signOut(boot.config);
}
</script>

<template>
  <main class="screen">
    <header class="screen-head">
      <h1 class="t-title">Profile</h1>
      <span class="grow" />
      <span class="t-label c2">Metric · kg, cm</span>
    </header>

    <div class="pgrid" :class="{ two: vp.tablet, desk: vp.desktop }">
      <div class="pcol">
        <section class="card">
          <span class="t-label c2">About you</span>
          <div class="frow sexrow">
            <span class="t-body c2">Sex</span>
            <span class="grow" />
            <Segmented label="Sex" :model-value="profile.form.sex" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" @update:model-value="setSex" />
          </div>
          <label class="frow">
            <span class="t-body c2">Birth year</span>
            <input v-model="profile.form.birthYear" class="ninput" type="text" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Birth year" @blur="onTextCommit" />
            <span v-if="age !== null" class="t-label c2">{{ age }} y</span>
          </label>
          <label class="frow">
            <span class="t-body c2">Height</span>
            <input v-model="profile.form.heightCm" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Height in centimetres" @blur="onTextCommit" />
            <span class="t-label c2">cm</span>
          </label>
          <button type="button" class="frow" @click="openWeight()">
            <span class="t-body c2">Weight</span>
            <span class="grow" />
            <span class="row lowrow t-label c2">
              <AccuracyDot v-if="caption.low" :interactive="false" />
              {{ caption.label }}
            </span>
            <span class="t-ns">{{ caption.value }}</span>
            <Icon name="right" :size="16" />
          </button>
          <button type="button" class="frow" :aria-expanded="actOpen" @click="actOpen = !actOpen">
            <span class="t-body c2">Activity</span>
            <span class="grow" />
            <span class="t-body">{{ profile.form.activity ? ACTIVITY[profile.form.activity].label : "Choose" }}</span>
            <Icon :name="actOpen ? 'down' : 'right'" :size="16" />
          </button>
          <div v-if="actOpen" class="acts">
            <button v-for="(item, key) in ACTIVITY" :key="key" type="button" class="act" :class="{ on: key === profile.form.activity }" @click="setActivity(key)">
              <span class="t-body grow">{{ item.label }}</span>
              <span class="t-label c2">{{ item.hint }}</span>
            </button>
          </div>
          <label class="frow last">
            <span class="t-body c2">Time zone</span>
            <input v-model="profile.form.timeZone" class="tz" type="text" autocomplete="off" aria-label="Time zone" @blur="onTextCommit" />
          </label>
        </section>

        <section class="card">
          <span class="t-label c2">Goal</span>
          <Segmented label="Goal" :model-value="profile.form.goal" :options="[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]" @update:model-value="setGoal" />
          <div v-if="profile.form.goal !== 'maintain'" class="rate" role="group" aria-label="Rate">
            <span class="t-body c2">Rate</span>
            <button v-for="rate in RATES" :key="rate" type="button" class="chip t-label" :class="{ on: Number(profile.form.rate) === rate }" @click="setRate(rate)">{{ rate === 1 ? "1.0" : rate }}</button>
            <span class="t-label c2">kg/wk</span>
          </div>
          <label class="frow last">
            <span class="t-body c2">Goal weight</span>
            <input v-model="profile.form.goalWeightKg" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Goal weight in kilograms" @blur="onTextCommit" />
            <span class="t-label c2">kg</span>
          </label>
          <p v-if="gap" class="t-label c2">{{ gap }}</p>
        </section>
      </div>

      <div class="pcol">
        <section v-if="shown" class="card">
          <div class="row">
            <h2 class="t-label c2">Your targets</h2>
            <span class="grow" />
            <span class="t-label c2">updates live</span>
          </div>
          <div class="stats">
            <div><span class="t-label c2">BMR</span><span class="t-ns" data-field="bmr">{{ shown.bmr }}</span><span class="t-label c2">kcal</span></div>
            <div><span class="t-label c2">Daily burn</span><span class="t-ns" data-field="tdee">{{ shown.tdee }}</span><span class="t-label c2">kcal</span></div>
            <div><span class="t-label c2">Eat</span><span class="t-nm" data-field="kcal">{{ shown.kcal }}</span><span class="t-label c2">kcal</span></div>
          </div>
          <div class="divider" />
          <div class="stats">
            <div><span class="t-label c2">Protein</span><span class="t-ns" data-field="protein">{{ shown.protein }}</span><span class="t-label c2">g</span></div>
            <div><span class="t-label c2">Fat</span><span class="t-ns" data-field="fat">{{ shown.fat }}</span><span class="t-label c2">g</span></div>
            <div><span class="t-label c2">Carbs</span><span class="t-ns" data-field="carbs">{{ shown.carbs }}</span><span class="t-label c2">g</span></div>
          </div>
          <p v-if="shown.floorApplied" class="t-body" data-floor="true">Raised to your BMR so the target does not go below it.</p>
        </section>

        <section class="card">
          <button type="button" class="frow last" :aria-expanded="customOpen" @click="customOpen = !customOpen">
            <span class="t-body">Customise</span>
            <span class="grow" />
            <span class="t-label c2">{{ customOpen ? "Hide" : "Normal balance" }}</span>
            <Icon :name="customOpen ? 'down' : 'right'" :size="16" />
          </button>
          <div v-if="customOpen" class="custom">
            <div role="group" aria-label="Protein">
              <span class="t-label c2">Protein</span>
              <div class="rate">
                <button v-for="item in PROTEIN_PRESETS" :key="item.key" type="button" class="chip t-label" :class="{ on: profile.form.proteinSetting === item.key }" @click="setProtein(item.key, item.value)">{{ item.label }}</button>
              </div>
              <label class="frow last">
                <span class="t-body c2">Exact</span>
                <input v-model="profile.form.proteinGramsPerKg" class="ninput" type="text" inputmode="decimal" aria-label="Exact protein, grams per kilogram" @blur="onExactProtein" />
                <span class="t-label c2">g/kg</span>
              </label>
            </div>
            <div role="group" aria-label="Fat">
              <span class="t-label c2">Fat</span>
              <div class="rate">
                <button v-for="item in FAT_PRESETS" :key="item.key" type="button" class="chip t-label" :class="{ on: profile.form.fatSetting === item.key }" @click="setFat(item.key, item.value)">{{ item.label }}</button>
              </div>
              <label class="frow last">
                <span class="t-body c2">Exact</span>
                <input v-model="profile.form.fatPercent" class="ninput" type="text" inputmode="decimal" aria-label="Exact fat, percent" @blur="onExactFat" />
                <span class="t-label c2">%</span>
              </label>
            </div>
            <button type="button" class="chip t-label" @click="resetMacros">Reset to default</button>
            <p class="t-body c2">More carbs means less protein or fat.</p>
          </div>
        </section>

        <p v-if="profile.citation" class="t-label c2">{{ profile.citation }}</p>
        <button v-if="boot.config" type="button" class="t-label c2 signout" @click="onSignOut">Sign out</button>
      </div>
    </div>
    <p v-if="profile.error" class="alert" role="alert">{{ profile.error }}</p>
  </main>
</template>

<style scoped>
.frow { min-height: 44px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--color-border); width: 100%; text-align: left; }
.sexrow { flex-wrap: wrap; }
.sexrow :deep(.seg) { width: auto; flex: 1 1 160px; min-width: 160px; }
.lowrow { gap: 6px; }
.frow.last { border-bottom: 0; }
.ninput { width: 88px; margin-left: auto; text-align: right; background: transparent; border: 0; min-height: 44px; }
.tz { margin-left: auto; width: 180px; text-align: right; background: transparent; border: 0; min-height: 44px; }
.acts, .custom { display: flex; flex-direction: column; gap: 8px; }
.act { min-height: 44px; display: flex; align-items: center; gap: 10px; text-align: left; border-radius: 10px; padding: 0 8px; }
.act.on { background: var(--color-surface-2); }
.rate { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.stats { display: flex; gap: 12px; }
.stats > div { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pgrid, .pcol { display: flex; flex-direction: column; gap: var(--space-gap); }
.two.pgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.desk.pgrid { grid-template-columns: minmax(0, 1.15fr) minmax(320px, 1fr); gap: 24px; }
.signout { align-self: flex-start; min-height: 44px; }
h2 { margin: 0; }
</style>
