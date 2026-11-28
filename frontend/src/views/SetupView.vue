<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import NumberField from "../components/NumberField.vue";
import Segmented from "../components/Segmented.vue";
import { ACTIVITY, RATES, type ActivityKey, type Goal, type Sex } from "../lib/nutrition";
import { weightDial } from "../lib/dial";
import { rateText, type HeightUnit, type WeightUnit } from "../lib/units";
import { profile, saveSetup, setUnits } from "../state/profile";

const router = useRouter();
const actOpen = ref(false);
const year = new Date().getFullYear();
const age = computed(() => {
  if (!/^\d{4}$/.test(profile.form.birthYear.trim())) return null;
  return year - Number(profile.form.birthYear);
});

function setSex(value: string) { profile.form.sex = value as Sex; }
function setGoal(value: string) {
  profile.form.goal = value as Goal;
  if (value === "maintain") profile.form.rate = "";
}
function setActivity(key: ActivityKey) {
  profile.form.activity = key;
  actOpen.value = false;
}
function setRate(rate: number) {
  profile.form.rate = rate === 1 ? "1.0" : String(rate);
}

function setWeightUnit(value: string) { void setUnits(value as WeightUnit, profile.form.heightUnit); }
function setHeightUnit(value: string) { void setUnits(profile.form.weightUnit, value as HeightUnit); }
const weightWord = computed(() => (profile.form.weightUnit === "lb" ? "pounds" : "kilograms"));

async function onContinue() {
  if (await saveSetup()) await router.push("/profile");
}
</script>

<template>
  <main class="screen">
    <header class="screen-head">
      <h1 class="t-title">Set up</h1>
    </header>
    <p class="t-body c2">Add your profile and a first weigh-in. Targets stay hidden until both are saved. Nothing here is filled in for you, apart from the normal macro balance and this device’s time zone.</p>

    <section class="card">
      <span class="t-label c2">About you</span>
      <div class="frow sexrow">
        <span class="t-body c2">Sex</span>
        <span class="grow" />
        <Segmented size="compact" label="Sex" :model-value="profile.form.sex" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" @update:model-value="setSex" />
      </div>
      <label class="frow">
        <span class="t-body c2">Birth year</span>
        <NumberField v-model="profile.form.birthYear" class="ninput" dial="body.year" label="Birth year" inputmode="numeric" :maxlength="4" :min="year - 100" :max="year - 13" :live="(y) => `${year - y} y`" autofocus />
        <span v-if="age !== null" class="t-label c2">{{ age }} y</span>
      </label>
      <div class="frow unitrow">
        <span class="t-body c2">Weight in</span>
        <span class="grow" />
        <Segmented size="compact" label="Weight unit" :model-value="profile.form.weightUnit" :options="[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]" @update:model-value="setWeightUnit" />
      </div>
      <div class="frow unitrow">
        <span class="t-body c2">Height in</span>
        <span class="grow" />
        <Segmented size="compact" label="Height unit" :model-value="profile.form.heightUnit" :options="[{ value: 'cm', label: 'cm' }, { value: 'ftin', label: 'ft·in', ariaLabel: 'feet and inches' }]" @update:model-value="setHeightUnit" />
      </div>
      <label v-if="profile.form.heightUnit === 'cm'" class="frow">
        <span class="t-body c2">Height</span>
        <NumberField v-model="profile.form.heightCm" class="ninput" dial="body.height.cm" label="Height in centimetres" />
        <span class="t-label c2">cm</span>
      </label>
      <div v-else class="frow" role="group" aria-label="Height">
        <span class="t-body c2">Height</span>
        <NumberField v-model="profile.form.heightFt" class="ninput ft" dial="body.height.ft" label="Height, feet" inputmode="numeric" :maxlength="1" />
        <span class="t-label c2">ft</span>
        <NumberField v-model="profile.form.heightIn" class="ninput inch" dial="body.height.in" label="Height, inches" :maxlength="4" />
        <span class="t-label c2">in</span>
      </div>
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
      <label class="frow">
        <span class="t-body c2">Time zone</span>
        <input v-model="profile.form.timeZone" class="tz" type="text" autocomplete="off" aria-label="Time zone" />
      </label>
    </section>

    <section class="card">
      <span class="t-label c2">Goal</span>
      <Segmented size="compact" class="full" label="Goal" :model-value="profile.form.goal" :options="[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]" @update:model-value="setGoal" />
      <div v-if="profile.form.goal && profile.form.goal !== 'maintain'" class="rate" role="group" aria-label="Rate">
        <span class="t-body c2">Rate</span>
        <button v-for="rate in RATES" :key="rate" type="button" class="chip t-label" :class="{ on: Number(profile.form.rate) === rate }" @click="setRate(rate)">{{ rateText(rate, profile.form.weightUnit) }}</button>
        <span class="t-label c2">{{ profile.form.weightUnit }}/wk</span>
      </div>
      <label class="frow">
        <span class="t-body c2">Goal weight</span>
        <NumberField v-model="profile.form.goalWeight" class="ninput" :dial="weightDial('goal', profile.form.weightUnit)" :label="`Goal weight in ${weightWord}`" />
        <span class="t-label c2">{{ profile.form.weightUnit }}</span>
      </label>
    </section>

    <section class="card">
      <h2 class="t-head section-title">Your starting weight</h2>
      <label class="frow last">
        <span class="t-body c2">Today</span>
        <NumberField v-model="profile.form.weighIn" class="ninput" :dial="weightDial('weight', profile.form.weightUnit)" :label="`Starting weight in ${weightWord}`" />
        <span class="t-label c2">{{ profile.form.weightUnit }}</span>
      </label>
      <p class="t-label c2">Saved as your first weigh-in, in {{ profile.form.timeZone }}. The trend that day is this weight. A comma or a point both work.</p>
      <p class="t-capn c2 hint"><i class="odot" aria-hidden="true" />Until you have 2 weigh-ins within 7 days, the trend shows a small grey dot: it's less accurate. Weigh in 2+ times a week, ideally each morning.</p>
    </section>

    <p v-if="profile.error" class="alert" role="alert">{{ profile.error }}</p>
    <button type="button" class="btn primary block t-bodys" :disabled="profile.saving" @click="onContinue">
      {{ profile.saving ? "Saving…" : "Save and see targets" }}
    </button>
  </main>
</template>

<style scoped>
.frow { min-height: 44px; display: flex; align-items: center; gap: var(--space-s); border-bottom: 1px solid var(--color-border); width: 100%; text-align: left; }
.sexrow { flex-wrap: wrap; }
.hint { display: flex; gap: var(--space-s); align-items: flex-start; margin: var(--space-xs) 0 0; }
.odot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-secondary); flex: none; margin-top: var(--space-xs); }
.frow.last { border-bottom: 0; }
.ninput { width: 88px; margin-left: auto; text-align: right; background: transparent; border: 0; min-height: 44px; }
.ninput.ft { width: 32px; }
.ninput.inch { width: 4.2ch; margin-left: 0; }
.tz { margin-left: auto; width: 180px; text-align: right; background: transparent; border: 0; min-height: 44px; }
.acts { display: flex; flex-direction: column; }
.act { min-height: 44px; display: flex; align-items: center; gap: var(--space-m); text-align: left; border-radius: var(--radius-m); padding: 0 var(--space-s); }
.act.on { background: var(--color-surface-2); }
.rate { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-s); }
</style>
