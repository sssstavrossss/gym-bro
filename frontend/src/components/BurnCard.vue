<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import type { RecalculateReview } from "../api";
import { spanLabel } from "../lib/dates";
import { int } from "../lib/format";
import { burnStrip, measureNote, stepCaption } from "../lib/recalculate";
import { weightUnit, wtSigned } from "../state/units";

/**
 * How the recalculate sheet got its burn: the weight slope, what was eaten, the measured burn
 * with its spread, and a strip showing the old burn stepping toward the measured range.
 * When the burn can't be measured yet it says why and that the current burn is kept.
 */
const props = defineProps<{ review: RecalculateReview }>();

const fit = computed(() => props.review.fit);
const step = computed(() => props.review.step);
const strip = computed(() => {
  const value = step.value;
  return value ? burnStrip(value.prior, value.measured, value.measuredSd, value.burn) : null;
});
const pos = (at: number) => `${at.toFixed(2)}%`;
const arrow = computed(() => {
  const value = strip.value;
  if (!value) return null;
  const left = Math.min(value.was, value.now);
  return { left: pos(left), width: pos(Math.abs(value.was - value.now)) };
});
/** A tick's label centres on it, but one near an edge lines up with that edge instead. */
function tickStyle(tick: number, min: number, max: number) {
  const at = ((tick - min) / (max - min)) * 100;
  const shift = at < 6 ? "0" : at > 94 ? "-100%" : "-50%";
  return { left: pos(at), transform: `translateX(${shift})` };
}
const eaten = computed(() => `${props.review.includedDays} of ${props.review.periodDays} days`);
</script>

<template>
  <section class="burn" aria-labelledby="burn-h" data-burn-card>
    <h3 id="burn-h" class="bh"><Icon name="scale" :size="16" class="c2" /> {{ step ? "How your burn was measured" : "Your burn was kept" }}</h3>
    <p v-if="!step" class="t-body cap" role="status" data-burn-blocked>{{ review.blocked }}</p>
    <div class="list t-label">
      <div v-if="fit" class="brow">
        <span class="grow">Weight<br><span class="t-capn c2">{{ fit.weighIns }} weigh-ins, {{ spanLabel(fit.first, fit.last) }}.<template v-if="review.settledFrom"> The first week skipped: water weight.</template></span></span>
        <span class="num">{{ wtSigned(fit.rateKgPerWeek, 2) }} {{ weightUnit() }}/wk</span>
      </div>
      <div v-if="review.averageKcal != null" class="brow">
        <span class="grow">Ate<br><span class="t-capn c2">{{ eaten }}</span></span>
        <span class="num">{{ int(review.averageKcal) }} kcal</span>
      </div>
      <div v-if="step && fit" class="brow" data-measured-burn>
        <span class="grow">Measured burn<br><span class="t-capn c2">{{ measureNote(fit.rateKgPerWeek) }}</span></span>
        <span class="num">{{ int(step.measured) }} ± {{ int(step.measuredSd) }}</span>
      </div>
      <div v-else class="brow" data-kept-burn>
        <span class="grow">Burn<br><span class="t-capn c2">Kept from your last update</span></span>
        <span class="num">{{ int(review.burn) }} kcal</span>
      </div>
    </div>
    <template v-if="step && strip && arrow">
      <div class="strip" aria-hidden="true">
        <div class="axis" />
        <div class="band" :style="{ left: pos(strip.band.left), width: pos(strip.band.width) }" />
        <div class="arrow" :style="arrow" />
        <div class="dot was" :style="{ left: pos(strip.was) }" />
        <div class="dot new" :style="{ left: pos(strip.now) }" />
        <span v-if="Math.abs(strip.was - strip.now) >= 22" class="mark" :style="{ left: pos(strip.was) }">Was {{ int(step.prior) }}</span>
        <span class="mark" :style="{ left: pos(strip.now) }"><b>New {{ int(step.burn) }}</b></span>
      </div>
      <div class="ticks" aria-hidden="true">
        <span v-for="tick in strip.ticks" :key="tick" :style="tickStyle(tick, strip.min, strip.max)">{{ int(tick) }}</span>
      </div>
      <p class="t-capn c2 cap" data-burn-step>{{ stepCaption(step.gain) }}</p>
      <p class="sr-only">Your burn was {{ int(step.prior) }} and is now {{ int(step.burn) }} kcal.</p>
    </template>
  </section>
</template>

<style scoped>
.burn { background: var(--color-surface-2); border-radius: var(--radius-l); padding: var(--space-m) var(--space-l); display: flex; flex-direction: column; gap: var(--space-s); }
.bh { display: flex; align-items: center; gap: var(--space-s); margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.cap { margin: 0; }
.list { display: flex; flex-direction: column; }
.brow { display: flex; align-items: baseline; gap: var(--space-s); padding: var(--space-s) 0; }
.brow + .brow { border-top: 1px solid var(--color-border); }
.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.strip { position: relative; height: 56px; margin: var(--space-2xs) 6px 0; }
.axis { position: absolute; left: 0; right: 0; top: 22px; height: 2px; background: var(--color-border); border-radius: 2px; }
.band { position: absolute; top: 16px; height: 14px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 7px; box-sizing: border-box; }
.arrow { position: absolute; top: 22px; height: 2px; background: var(--text-secondary); }
.dot { position: absolute; top: 15px; width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; box-sizing: border-box; }
.dot.was { border: 2px solid var(--text-tertiary); background: var(--color-surface-2); }
.dot.new { background: var(--text-primary); box-shadow: 0 0 0 2px var(--color-surface-2); }
.mark { position: absolute; top: 36px; transform: translateX(-50%); white-space: nowrap; font-size: 12px; color: var(--text-secondary); }
.mark b { color: var(--text-primary); font-weight: 600; }
.ticks { position: relative; height: 16px; margin: 0 6px; color: var(--text-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.ticks span { position: absolute; top: 0; }
</style>
