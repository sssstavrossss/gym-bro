<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Bar from "./Bar.vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import OverTag from "./OverTag.vue";
import { getNutrientSources, type NutrientSourceFood } from "../api";
import { daySources, nutrientRing, referenceText } from "../lib/nutrientCards";
import { dayNutrients, formatNutrient, nutrientName, nutrientRow, referenceFor, upperLimit } from "../lib/nutrients";
import { viewed } from "../state/log";
import { nutrientWeek } from "../state/nutrientWeek";
import { nutrientPerson } from "../state/profile";
import { closeSheet, ui } from "../ui";

const open = computed(() => ui.sheet === "nutrient" && ui.nutrient != null);
const key = computed(() => ui.nutrient?.key ?? "");
const person = computed(() => nutrientPerson(ui.nutrient?.kcalTarget ?? null));
const row = computed(() => (key.value ? nutrientRow(key.value) : null));
const name = computed(() => (key.value ? nutrientName(key.value) : ""));
const format = (value: number) => (row.value ? formatNutrient(value, row.value.unit, row.value.fine) : "");

// The Home card always shows the viewed day, so the sheet reads the same entries.
const entries = computed(() => viewed.entries);
const today = computed(() => (key.value ? dayNutrients(entries.value)[key.value] ?? 0 : 0));
const weekValue = computed(() => (key.value ? nutrientWeek.average[key.value] : null));
const ring = computed(() => (key.value ? nutrientRing(key.value, today.value, weekValue.value, person.value) : null));
const refText = computed(() => (key.value ? referenceText(key.value, person.value) : ""));
const limit = computed(() => (key.value ? upperLimit(key.value) : null));
const sources = computed(() => {
  if (!key.value) return { rows: [], missing: [] };
  return daySources(entries.value, key.value, referenceFor(key.value, person.value.sex, person.value.age, person.value.kcalTarget));
});

const good = ref<NutrientSourceFood[]>([]);
const goodState = ref<"loading" | "ready" | "failed">("loading");
let latest = 0;

async function loadGood(nutrient: string) {
  const ticket = ++latest;
  goodState.value = "loading";
  good.value = [];
  try {
    const response = await getNutrientSources(nutrient);
    if (ticket !== latest) return;
    good.value = response.foods;
    goodState.value = "ready";
  } catch {
    if (ticket === latest) goodState.value = "failed";
  }
}

watch(() => (open.value ? key.value : ""), (nutrient) => {
  if (nutrient) void loadGood(nutrient);
}, { immediate: true });
</script>

<template>
  <BottomSheet :open="open" :label="name || 'Nutrient'" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <div class="col grow">
          <h2 class="t-head m0">{{ name }}</h2>
          <span v-if="refText" class="t-label c2" data-reference>{{ refText }}</span>
        </div>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div v-if="ring" class="col body" data-nutrient-sheet>
      <div class="col gap-s">
        <div class="row now">
          <span class="t-head num" data-amount>{{ ring.amount }}</span>
          <span v-if="ring.percent != null" class="t-label c2">{{ ring.percent }}%</span>
          <OverTag v-if="ring.overLimit && limit != null" :text="`Above ${format(limit)}`" />
          <span v-if="weekValue != null" class="t-label c2 end" data-week>7-day avg <b class="num c1">{{ format(weekValue) }}</b></span>
        </div>
        <Bar :pct="ring.fill" :hit="ring.hit" :over="ring.overLimit" />
        <span v-if="weekValue != null" class="t-capn c3">Average of the {{ nutrientWeek.loggedDays }} logged {{ nutrientWeek.loggedDays === 1 ? "day" : "days" }} in the 7 days to this one.</span>
      </div>

      <section class="col gap-s" aria-labelledby="nutrient-day">
        <h3 id="nutrient-day" class="t-cap c2 section-title m0">Where it came from</h3>
        <p v-if="sources.rows.length === 0" class="t-label c3 m0">Nothing logged this day has {{ name }}.</p>
        <div v-for="source in sources.rows" :key="source.id" class="col src" data-day-source>
          <div class="row line">
            <span class="t-label grow name">{{ source.name }}</span>
            <span class="t-label num">{{ format(source.value) }}</span>
          </div>
          <Bar :pct="source.fraction" />
        </div>
        <p v-if="sources.missing.length" class="t-label c3 m0" data-missing>No {{ name }} data: {{ sources.missing.join(", ") }}</p>
      </section>

      <section class="col gap-s" aria-labelledby="nutrient-good">
        <h3 id="nutrient-good" class="t-cap c2 section-title m0">Good sources you've logged</h3>
        <p v-if="goodState === 'loading'" class="t-label c3 m0">Loading…</p>
        <p v-else-if="goodState === 'failed'" class="t-label c3 m0">Couldn't load your foods.</p>
        <p v-else-if="good.length === 0" class="t-label c3 m0">None of the foods you've logged list {{ name }} yet.</p>
        <div v-for="food in good" :key="food.id" class="row line" data-good-source>
          <span class="t-label grow name">{{ food.name }}<span v-if="food.brand" class="c3"> · {{ food.brand }}</span></span>
          <span class="t-label c2"><span class="num c1">{{ format(food.per100) }}</span> / 100 {{ food.basis === "ml" ? "ml" : "g" }}</span>
        </div>
      </section>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: flex-start; }
.m0 { margin: 0; }
.body { gap: var(--space-l); padding-bottom: var(--space-s); }
.gap-s { gap: var(--space-s); }
.now { align-items: baseline; gap: var(--space-s); flex-wrap: wrap; }
.end { margin-left: auto; }
.num { font-weight: 700; font-variant-numeric: tabular-nums; }
.c1 { color: var(--text-primary); }
.src { gap: 3px; }
.line { align-items: baseline; gap: var(--space-s); min-width: 0; }
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
