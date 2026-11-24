<script setup lang="ts">
import Icon from "./Icon.vue";
import { searchSeed, type DescribeRow } from "../lib/describe";
import { recentSubtitle } from "../lib/foodSheet";
import { foodUnit } from "../state/units";

// The review list Claude's matches land on: Describe a meal's foods and a recipe import's ingredients. Each
// found row has a check circle and opens its amount; a row with no match offers Search (and Quick add, where
// that exists).

defineProps<{
  rows: readonly DescribeRow[];
  /** "3 foods", "9 of 11 found". */
  title: string;
  /** Placeholder rows while Claude works, under this title. */
  finding?: string;
  label: string;
  /** Quick add on a row with no match (Describe; a recipe has no quick add). */
  quick?: boolean;
}>();

const emit = defineEmits<{
  toggle: [index: number];
  open: [index: number];
  search: [seed: string, index: number];
  quick: [name: string];
}>();
</script>

<template>
  <template v-if="finding">
    <div class="lhead" role="status"><h3 class="t-cap c2 section-title">{{ finding }}</h3></div>
    <ul class="rows" aria-hidden="true">
      <li v-for="width in [70, 80, 55, 65]" :key="width" class="drow">
        <span class="chk off faint" />
        <span class="col grow skc">
          <span class="sk" :style="{ width: width + '%' }" />
          <span class="sk thin" :style="{ width: width - 25 + '%' }" />
        </span>
      </li>
    </ul>
  </template>
  <template v-else>
    <div class="lhead">
      <h3 class="t-cap c2 section-title">{{ title }}</h3>
      <span class="grow" />
      <span v-if="rows.some((row) => row.food)" class="t-capn c2">tap one to change it</span>
    </div>
    <ul class="rows" :aria-label="label">
      <li v-for="(row, index) in rows" :key="row.key" class="drow" :class="{ top: !row.food }" :data-described="row.food ? 'found' : 'missing'">
        <template v-if="row.food">
          <button type="button" class="chkhit" :aria-pressed="row.on" :aria-label="`Include ${row.food.name}`" @click="emit('toggle', index)">
            <span class="chk" :class="{ off: !row.on }"><Icon v-if="row.on" name="check" :size="14" :sw="3" /></span>
          </button>
          <button type="button" class="pick grow" :class="{ dim: !row.on }" @click="emit('open', index)">
            <span class="col grow tx">
              <span class="row nm">
                <span class="t-body ell">{{ row.food.name }}</span>
                <span v-if="row.guessed" class="tag t-capn">guessed</span>
              </span>
              <span class="t-label c2">{{ recentSubtitle(row.food, row.amount, row.unit, foodUnit()) }}</span>
              <span class="t-capn c3 quote">“{{ row.phrase }}”</span>
            </span>
            <Icon name="right" :size="16" class="c3" />
          </button>
        </template>
        <template v-else>
          <span class="chkhit"><span class="chk off" /></span>
          <span class="col grow miss">
            <span class="col tx">
              <span class="t-body">No match for “{{ row.phrase }}”</span>
              <span class="t-label c2">{{ quick ? "Pick a food or type the calories." : "Pick a food, or leave it out." }}</span>
            </span>
            <span class="row gap8">
              <button type="button" class="btn sm secondary t-label" @click="emit('search', searchSeed(row), index)"><Icon name="search" :size="14" /><span>Search</span></button>
              <button v-if="quick" type="button" class="btn sm secondary t-label" @click="emit('quick', row.name || row.phrase)">Quick add</button>
            </span>
          </span>
        </template>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.lhead { display: flex; align-items: center; gap: var(--space-s); margin-top: var(--space-s); }
.lhead h3 { margin: 0; }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.drow { display: flex; align-items: center; gap: var(--space-s); border-bottom: 1px solid var(--color-border); min-width: 0; }
.drow.top { align-items: flex-start; }
.pick { display: flex; align-items: center; gap: var(--space-m); min-height: var(--control-hit); padding: var(--space-m) 0; background: none; border: 0; color: inherit; text-align: left; min-width: 0; width: 100%; cursor: pointer; }
.pick.dim .tx { opacity: .55; }
.tx { gap: 2px; min-width: 0; }
.nm { gap: var(--space-s); min-width: 0; align-items: center; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.quote { font-style: italic; }
.chkhit { flex: none; display: inline-flex; align-items: center; justify-content: center; width: var(--control-hit); height: var(--control-hit); margin-left: calc((var(--control-hit) - 24px) / -2); background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
.drow.top .chkhit { margin-top: var(--space-s); }
span.chkhit { cursor: default; }
.chk { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--color-action); color: var(--color-on-action); }
.chk.off { background: transparent; box-shadow: inset 0 0 0 2px var(--text-tertiary); }
.chk.faint { opacity: .4; }
.drow:has(.chk.faint) { padding: var(--space-m) 0; }
.miss { gap: var(--space-s); padding: var(--space-m) 0; min-width: 0; }
.gap8 { gap: var(--space-s); flex-wrap: wrap; }
.skc { gap: 8px; }
.sk { display: block; height: 12px; border-radius: 6px; background: var(--color-surface-2); }
.sk.thin { height: 10px; }
</style>
