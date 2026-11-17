<script setup lang="ts">
import { computed } from "vue";
import { coverageNote, nutrientRing, panelCoverage, type NutrientPerson, type NutrientRing } from "../lib/nutrientCards";
import type { NutrientMap, NutrientPanelDef, NutrientSource } from "../lib/nutrients";
import { openNutrient } from "../ui";

const props = defineProps<{
  panel: NutrientPanelDef;
  values: NutrientMap;
  /** Daily average over the week. Empty hides the inner rings. */
  week: NutrientMap;
  entries: readonly NutrientSource[];
  person: NutrientPerson;
  /** One food's portion on the food sheet: the rings don't open the day's nutrient sheet. */
  portion?: boolean;
}>();

const OUTER = 16;
const INNER = 11;
const outerLength = 2 * Math.PI * OUTER;
const innerLength = 2 * Math.PI * INNER;

const rings = computed(() => props.panel.keys.map((key) => nutrientRing(key, props.values[key] ?? 0, props.week[key], props.person)));
const note = computed(() => coverageNote(panelCoverage(props.entries, props.panel.keys)));

/** A stroke that draws `fill` of the circle. A sliver stays visible above 0. */
function dash(fill: number, length: number): string {
  return `${Math.max(0.5, fill * length)} ${length}`;
}

function centre(ring: NutrientRing): string {
  if (ring.percent == null) return "—";
  return ring.percent > 999 ? "999+" : String(ring.percent);
}

function label(ring: NutrientRing): string {
  // The text on screen, in its order ("48% Vit A, 48.8 µg"), so voice control can say what it
  // sees. The bracket carries the full name and what the percent means.
  const notes = [ring.name === ring.label ? "" : ring.name, ring.percent == null ? "" : "of the daily reference"].filter(Boolean);
  const head = `${ring.percent == null ? "" : `${centre(ring)}% `}${ring.label}${notes.length ? ` (${notes.join(", ")})` : ""}`;
  const parts = [head, ring.amount];
  if (ring.overLimit) parts.push("above the upper limit");
  // A button opens the nutrient sheet; on the food sheet the ring is only a picture.
  return props.portion ? parts.join(", ") : `${parts.join(", ")}. Details`;
}
</script>

<template>
  <div class="panel rings" :data-panel="panel.id">
    <div class="head">
      <span class="section-title panel-title">{{ panel.title }}</span>
      <span class="t-capn c3">% of daily reference</span>
      <span v-if="note" class="t-capn c3 note">{{ note }}</span>
    </div>
    <div class="grid">
      <component
        :is="portion ? 'div' : 'button'"
        v-for="ring in rings"
        :key="ring.key"
        :type="portion ? undefined : 'button'"
        :role="portion ? 'img' : undefined"
        class="ring"
        :class="{ pressable: !portion, hit: ring.hit, over: ring.overLimit }"
        :data-ring="ring.key"
        :aria-label="label(ring)"
        @click="portion || openNutrient(ring.key, person.kcalTarget)"
      >
        <span class="dial" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle class="otrack" cx="20" cy="20" :r="OUTER" />
            <circle v-if="ring.overLimit" class="limit" cx="20" cy="20" :r="OUTER" />
            <circle v-else-if="ring.fill > 0" class="fill" cx="20" cy="20" :r="OUTER" :stroke-dasharray="dash(ring.fill, outerLength)" transform="rotate(-90 20 20)" />
            <template v-if="ring.weekFill != null">
              <circle class="wtrack" cx="20" cy="20" :r="INNER" />
              <circle v-if="ring.weekFill > 0" class="week" data-week-ring cx="20" cy="20" :r="INNER" :stroke-dasharray="dash(ring.weekFill, innerLength)" transform="rotate(-90 20 20)" />
            </template>
          </svg>
          <span class="pc" :class="{ long: centre(ring).length > 2 }">{{ centre(ring) }}</span>
        <!-- Each closing tag shares a line with the next span, so a space parts the words ("48 Vit A 48.8 µg"), as in the name. -->
        </span> <span class="t-capn name">{{ ring.label }}</span> <span class="amt c3">{{ ring.amount }}</span>
      </component>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: var(--space-xs); min-width: 0; height: 100%; box-sizing: border-box; }
.head { display: flex; align-items: baseline; gap: var(--space-s); min-width: 0; white-space: nowrap; }
.note { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); row-gap: 6px; margin-top: var(--space-2xs); }
.ring {
  display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0;
  padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer;
  border-radius: var(--radius-xs);
}
.dial { position: relative; width: 40px; height: 40px; display: grid; place-items: center; }
.dial svg { position: absolute; inset: 0; }
circle { fill: none; }
.otrack { stroke: var(--color-track); stroke-width: 3.5; }
/* Grey while under the reference, white once it is met: the macro bars' colours. */
.fill { stroke: var(--color-progress); stroke-width: 3.5; stroke-linecap: round; }
.ring.hit .fill { stroke: var(--color-hit); }
/* Above the upper limit: the whole ring, dashed, like the striped over bars. */
.limit { stroke: var(--over-mark); stroke-width: 3.5; stroke-dasharray: 3 2.6; }
.wtrack { stroke: var(--color-track); stroke-width: 1.5; stroke-opacity: 0.6; }
.week { stroke: var(--text-tertiary); stroke-width: 1.5; stroke-linecap: round; }
.pc { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pc.long { font-size: 9px; letter-spacing: -0.02em; }
.name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amt { font-size: 10px; line-height: 1.1; white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>
