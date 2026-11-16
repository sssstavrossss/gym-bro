<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { dismissRecalculateBanner, getRecalculateBanner } from "../api";
import { refreshInbox } from "../state/inbox";
import { openRecalculate, toast, ui } from "../ui";

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
    toast("Couldn't dismiss it, try again.");
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
  <section v-if="show" class="card rp" aria-labelledby="rp-h" data-recalc-prompt>
    <div class="grid">
    <span class="ic" aria-hidden="true"><Icon name="refresh" :size="17" /></span>
    <div class="col grow txt">
      <p id="rp-h" class="t-bodys m0">Recalculate this week</p>
      <span class="t-label c2">Update your target from last week.</span>
    </div>
    <button type="button" class="chip on t-label go" @click="openRecalculate">Recalculate</button>
    <button type="button" class="cbtn x" aria-label="Dismiss for this week" @click="dismiss"><Icon name="x" :size="16" /></button>
    </div>
  </section>
</template>

<style scoped>
/* One row on a phone. In a narrow column (desktop side column) the button drops under the text. */
.rp { container-type: inline-size; padding: 10px 4px 10px 14px; border: 1px solid var(--color-border-strong); }
.grid { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; grid-template-areas: "ic txt go x"; align-items: center; column-gap: 10px; row-gap: 6px; }
@container (max-width: 340px) {
  .grid { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "ic txt x" ". go go"; }
  .go { justify-self: start; }
}
.m0 { margin: 0; }
.ic { grid-area: ic; width: 34px; height: 34px; border-radius: 17px; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; }
.txt { grid-area: txt; min-width: 0; gap: 1px; }
.go { grid-area: go; font-weight: 600; padding-left: 14px; padding-right: 14px; }
.x { grid-area: x; color: var(--text-secondary); }
</style>
