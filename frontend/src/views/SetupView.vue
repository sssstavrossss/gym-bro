<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import Segmented from "../components/Segmented.vue";
import { ACTIVITY, RATES, type ActivityKey, type Goal, type Sex } from "../lib/nutrition";
import { profile, saveSetup } from "../state/profile";

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
      <div class="frow">
        <span class="t-body c2">Sex</span>
        <Segmented :model-value="profile.form.sex" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" @update:model-value="setSex" />
      </div>
      <label class="frow">
        <span class="t-body c2">Birth year</span>
        <input v-model="profile.form.birthYear" class="ninput" type="text" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Birth year" />
        <span v-if="age !== null" class="t-label c2">{{ age }} y</span>
      </label>
      <label class="frow">
        <span class="t-body c2">Height</span>
        <input v-model="profile.form.heightCm" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Height in centimetres" />
        <span class="t-label c2">cm</span>
      </label>
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
      <Segmented :model-value="profile.form.goal" :options="[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]" @update:model-value="setGoal" />
      <div v-if="profile.form.goal && profile.form.goal !== 'maintain'" class="rate" role="group" aria-label="Rate">
        <span class="t-body c2">Rate</span>
        <button v-for="rate in RATES" :key="rate" type="button" class="chip t-label" :class="{ on: Number(profile.form.rate) === rate }" @click="setRate(rate)">{{ rate === 1 ? "1.0" : rate }}</button>
        <span class="t-label c2">kg/wk</span>
      </div>
      <label class="frow">
        <span class="t-body c2">Goal weight</span>
        <input v-model="profile.form.goalWeightKg" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Goal weight in kilograms" />
        <span class="t-label c2">kg</span>
      </label>
    </section>

    <section class="card">
      <h2 class="t-head">Your starting weight</h2>
      <label class="frow last">
        <span class="t-body c2">Today</span>
        <input v-model="profile.form.weighInKg" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Starting weight in kilograms" />
        <span class="t-label c2">kg</span>
      </label>
      <p class="t-label c2">Saved as your first weigh-in, in {{ profile.form.timeZone }}. The trend that day is this weight. A comma or a point both work.</p>
    </section>

    <p v-if="profile.error" class="alert" role="alert">{{ profile.error }}</p>
    <button type="button" class="primary-btn t-bodys" :disabled="profile.saving" @click="onContinue">
      {{ profile.saving ? "Saving…" : "Save and see targets" }}
    </button>
  </main>
</template>

<style scoped>
.frow { min-height: 44px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--color-border); width: 100%; text-align: left; }
.frow.last { border-bottom: 0; }
.ninput { width: 88px; margin-left: auto; text-align: right; background: transparent; border: 0; min-height: 44px; }
.tz { margin-left: auto; width: 180px; text-align: right; background: transparent; border: 0; min-height: 44px; }
.acts { display: flex; flex-direction: column; }
.act { min-height: 44px; display: flex; align-items: center; gap: 10px; text-align: left; border-radius: 10px; padding: 0 8px; }
.act.on { background: var(--color-surface-2); }
.rate { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
</style>
