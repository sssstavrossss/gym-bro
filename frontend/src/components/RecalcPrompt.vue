<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { dismissRecalculateBanner, getRecalculateBanner } from "../api";
import { connection } from "../state/connection";
import { refreshInbox } from "../state/inbox";
import { openRecalculate, toastError, ui } from "../ui";

/**
 * This week's recalculate reminder, on Home while it is open. It closes itself once a
 * recalculation is saved this week; ✕ dismisses it until next Monday.
 */
const show = ref(false);
async function load() {
  try {
    show.value = (await getRecalculateBanner()).show;
  } catch {
    show.value = false;
  }
}
async function dismiss() {
  show.value = false;
  try {
    await dismissRecalculateBanner();
    void refreshInbox();
  } catch {
    show.value = true;
    toastError("Couldn't dismiss it. Try again.");
  }
}
onMounted(() => { void load(); });
watch(() => ui.sheet, (sheet, previous) => {
  if (previous === "recalculate" && sheet !== "recalculate") {
    void load();
    void refreshInbox();
  }
});
</script>

<template>
  <section v-if="show && !connection.offline" class="card outline rp" aria-labelledby="rp-h" data-recalc-prompt>
    <div class="grid">
    <span class="disc ic" aria-hidden="true"><Icon name="refresh" :size="16" /></span>
    <div class="col grow txt">
      <p id="rp-h" class="t-bodys m0">Recalculate this week</p>
      <span class="t-label c2">Update your target from last week.</span>
    </div>
    <button type="button" class="btn sm primary t-label go" @click="openRecalculate">Recalculate</button>
    <button type="button" class="cbtn x" aria-label="Dismiss for this week" @click="dismiss"><Icon name="x" :size="16" /></button>
    </div>
  </section>
</template>

<style scoped>
/* One row on a phone. In a narrow column (desktop side column) the button drops under the text. */
.rp { container-type: inline-size; }
.grid { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; grid-template-areas: "ic txt go x"; align-items: center; column-gap: var(--space-m); row-gap: var(--space-s); }
@container (max-width: 340px) {
  .grid { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "ic txt x" ". go go"; }
  .go { justify-self: start; }
}
.m0 { margin: 0; }
.ic { grid-area: ic; }
.txt { grid-area: txt; min-width: 0; gap: 1px; }
.go { grid-area: go; }
/* The 44px hit box overhangs the card padding so the 32px disc lines up with the text edge. */
.x { grid-area: x; color: var(--text-secondary); margin: calc((var(--control-s) - var(--control-hit)) / 2); }
</style>
