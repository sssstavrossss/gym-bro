<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import type { RecalculateReview } from "../api";
import { dayMonth, dayNum, weekdayShort } from "../lib/dates";
import { int } from "../lib/format";
import { burnStrip, farNote, farTitle, moveCaption, readingNote, readingsCaption } from "../lib/recalculate";
import { weightUnit, wt } from "../state/units";

/**
 * How the recalculate sheet got its burn: each stretch of weigh-ins against the weight the food
 * in between predicted, where the readings point with their spread, and a strip showing the old
 * burn stepping toward that range (at most 5% at a time). A burn far from the formula gets a note.
 * When the burn can't be measured yet it says why and that the current burn is kept.
 */
const props = defineProps<{ review: RecalculateReview }>();

const step = computed(() => props.review.step);
/** The server sends the readings a week at a time (a daily weigher's single days are mostly water). */
const readings = computed(() => props.review.readings);
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
const day = (date: string) => `${weekdayShort(date)} ${dayNum(date)}`;
const caption = computed(() => {
  const list = props.review.readings;
  return list.length ? readingsCaption(props.review.window.weighIns, dayMonth(list[0].from), props.review.tier) : "";
});
const eaten = computed(() => `${props.review.includedDays} of ${props.review.periodDays} days`);
</script>

<template>
  <section class="burn" aria-labelledby="burn-h" data-burn-card>
    <h3 id="burn-h" class="bh"><Icon name="scale" :size="16" class="c2" /> {{ step ? "How your burn was measured" : "Your burn was kept" }}</h3>
    <p v-if="!step" class="t-body cap" role="status" data-burn-blocked>{{ review.blocked }}</p>
    <div class="list t-label">
      <template v-if="readings.length">
        <div class="brow">
          <span class="grow">Weigh-ins<br><span class="t-capn c2">{{ caption }}.<template v-if="review.settledFrom"> The first week skipped: water weight.</template></span></span>
        </div>
        <ol class="reads" data-readings>
          <li v-for="reading in readings" :key="reading.from" class="read" :class="{ less: !reading.sure }" data-reading>
            <span class="dot" :class="reading.sure ? 'on' : 'off'" aria-hidden="true" />
            <span class="col grow">
              <span class="t-label">{{ day(reading.from) }} → {{ day(reading.to) }} <span class="c2">· {{ reading.days }} {{ reading.days === 1 ? "day" : "days" }}</span></span>
              <span class="t-capn c2">Expected {{ wt(reading.expectedKg) }}, weighed {{ wt(reading.endKg) }} {{ weightUnit() }}<template v-if="readingNote(reading)"> · {{ readingNote(reading) }}</template></span>
            </span>
            <span class="col rt">
              <span class="num">{{ int(reading.burn) }}</span>
              <span class="t-capn c2">{{ reading.sure ? "Sure" : "Less sure" }}</span>
            </span>
          </li>
        </ol>
      </template>
      <div v-if="review.averageKcal != null" class="brow">
        <span class="grow">Ate<br><span class="t-capn c2">{{ eaten }}</span></span>
        <span class="num">{{ int(review.averageKcal) }} kcal</span>
      </div>
      <div v-if="step" class="brow" data-measured-burn>
        <span class="grow">Readings point to<br><span class="t-capn c2">Sure readings count most</span></span>
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
        <div class="pin was" :style="{ left: pos(strip.was) }" />
        <div class="pin new" :style="{ left: pos(strip.now) }" />
        <span v-if="Math.abs(strip.was - strip.now) >= 22" class="mark" :style="{ left: pos(strip.was) }">Was {{ int(step.prior) }}</span>
        <span class="mark" :style="{ left: pos(strip.now) }"><b>New {{ int(step.burn) }}</b></span>
      </div>
      <div class="ticks" aria-hidden="true">
        <span v-for="tick in strip.ticks" :key="tick" :style="tickStyle(tick, strip.min, strip.max)">{{ int(tick) }}</span>
      </div>
      <p class="t-capn c2 cap" data-burn-step>{{ moveCaption(step, review.tier) }}</p>
      <p class="sr-only">Your burn was {{ int(step.prior) }} and is now {{ int(step.burn) }} kcal.</p>
    </template>
    <div v-if="review.farShare != null" class="warn" role="note" data-burn-far>
      <Icon name="info" :size="16" class="c2 wi" />
      <span class="col">
        <span class="t-label">{{ farTitle(review.farShare) }}</span>
        <span class="t-capn c2">{{ farNote(review.farShare, review.formula.tdee) }}</span>
      </span>
    </div>
  </section>
</template>

<style scoped>
.burn { background: var(--color-surface-2); border-radius: var(--radius-l); padding: var(--space-m) var(--space-l); display: flex; flex-direction: column; gap: var(--space-s); box-shadow: var(--d-edge); }
.bh { display: flex; align-items: center; gap: var(--space-s); margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.cap { margin: 0; }
.list { display: flex; flex-direction: column; }
.brow { display: flex; align-items: baseline; gap: var(--space-s); padding: var(--space-s) 0; }
.brow + .brow, .reads + .brow { border-top: 1px solid var(--color-border); }
.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.reads { list-style: none; margin: 0 0 var(--space-xs); padding: 0; display: flex; flex-direction: column; gap: var(--space-s); }
.read { display: flex; align-items: flex-start; gap: var(--space-s); }
.read .col { gap: 1px; min-width: 0; }
.rt { align-items: flex-end; text-align: right; gap: 1px; flex: none; }
.read.less .num { color: var(--text-secondary); }
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; box-sizing: border-box; }
.dot.on { background: var(--text-primary); }
.dot.off { border: 2px solid var(--text-tertiary); }
.strip { position: relative; height: 56px; margin: var(--space-2xs) 6px 0; }
.axis { position: absolute; left: 0; right: 0; top: 22px; height: 2px; background: var(--color-border); border-radius: 2px; }
.band { position: absolute; top: 16px; height: 14px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 7px; box-sizing: border-box; }
.arrow { position: absolute; top: 22px; height: 2px; background: var(--text-secondary); }
.pin { position: absolute; top: 15px; width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; box-sizing: border-box; }
.pin.was { border: 2px solid var(--text-tertiary); background: var(--color-surface-2); }
.pin.new { background: var(--text-primary); box-shadow: 0 0 0 2px var(--color-surface-2); }
.mark { position: absolute; top: 36px; transform: translateX(-50%); white-space: nowrap; font-size: 12px; color: var(--text-secondary); }
.mark b { color: var(--text-primary); font-weight: 600; }
.ticks { position: relative; height: 16px; margin: 0 6px; color: var(--text-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.ticks span { position: absolute; top: 0; }
.warn { display: flex; gap: var(--space-s); align-items: flex-start; background: var(--color-surface); border-radius: var(--radius-m); padding: var(--space-s) var(--space-m); }
.warn .col { gap: 2px; }
.wi { flex: none; margin-top: 2px; }
/* At the largest text the burn and Sure go under the dates, so the dates keep the width. */
html.dt-xl .read { flex-wrap: wrap; }
html.dt-xl .read .rt { flex-basis: 100%; flex-direction: row; align-items: baseline; gap: var(--space-s); padding-left: calc(10px + var(--space-s)); }
</style>
