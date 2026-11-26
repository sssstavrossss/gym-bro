<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { todayIso } from "../lib/dates";
import { lastWeighInLine, nudgeBackOn, nudgeDismissed } from "../lib/weightDisplay";
import { profile } from "../state/profile";
import { openWeight } from "../ui";

/**
 * On Home when there are too few weigh-ins to measure the burn (the server's `weighInNudge`):
 * a weigh-in a week lets Recalculate learn it. ✕ hides it on this device for a week.
 */
const KEY = "gymbro-weigh-nudge-back-on";
function read(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
const backOn = ref(read());
const today = computed(() => profile.weight?.asOf || todayIso());
const show = computed(() => profile.weight?.weighInNudge === true && !nudgeDismissed(backOn.value, today.value));
const line = computed(() => {
  const last = lastWeighInLine(profile.weight?.latestDate, today.value);
  return last ? `So Gym Bro can learn your burn. ${last}` : "So Gym Bro can learn your burn.";
});

function dismiss() {
  backOn.value = nudgeBackOn(today.value);
  try { localStorage.setItem(KEY, backOn.value); } catch { /* still hidden for this visit */ }
}
</script>

<template>
  <section v-if="show" class="card outline wn" aria-labelledby="wn-h" data-weigh-nudge>
    <div class="grid">
      <span class="disc ic" aria-hidden="true"><Icon name="scale" :size="16" /></span>
      <div class="col grow txt">
        <p id="wn-h" class="t-bodys m0">Weigh in once a week</p>
        <span class="t-label c2">{{ line }}</span>
      </div>
      <button type="button" class="btn sm primary t-label go" @click="openWeight">Log weight</button>
      <button type="button" class="cbtn x" aria-label="Hide for a week" @click="dismiss"><Icon name="x" :size="16" /></button>
    </div>
  </section>
</template>

<style scoped>
/* The same layout as the recalculate prompt: one row on a phone, the button under the text in a narrow column. */
.wn { container-type: inline-size; }
.grid { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; grid-template-areas: "ic txt go x"; align-items: center; column-gap: var(--space-m); row-gap: var(--space-s); }
@container (max-width: 340px) {
  .grid { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "ic txt x" ". go go"; }
  .go { justify-self: start; }
}
.m0 { margin: 0; }
.ic { grid-area: ic; }
.txt { grid-area: txt; min-width: 0; gap: 1px; }
.go { grid-area: go; }
.x { grid-area: x; color: var(--text-secondary); margin: calc((var(--control-s) - var(--control-hit)) / 2); }
</style>
