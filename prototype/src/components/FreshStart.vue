<script setup lang="ts">
// S8 Q6: after more than 4 weeks without a weigh-in the trend restarts from the new weigh-in, and we ask once.
// Yes → a target row today (reason fresh_start). Not now → nothing written. Monday's update runs either way.
import { computed } from "vue";
import Icon from "./Icon.vue";
import { int, kg } from "../lib/format";
import { shortDate, addDays } from "../lib/dates";
import { gapLabel } from "../lib/trend";
import { answerFresh, freshPrompt, shown, state, targets } from "../store";
import { toast } from "../ui";
const f = computed(() => freshPrompt.value);
const manual = computed(() => state.profile.goalMode === "manual");
const lastBefore = computed(() => (f.value ? addDays(f.value.date, -f.value.gapDays) : ""));
const next = computed(() => Math.round(targets.value.kcal));
function yes() { answerFresh(true); toast(manual.value ? `Macros updated from ${kg(f.value?.kg ?? 0)} kg` : `New target from today: ${int(next.value)} kcal`); }
function no() { answerFresh(false); toast("Kept your targets · Monday's update runs as usual"); }
</script>

<template>
  <section v-if="f" class="card fs" role="region" aria-labelledby="fs-h">
    <div class="row top"><span class="ic" aria-hidden="true"><Icon name="scale" :size="18" /></span>
      <div class="col grow"><h2 id="fs-h" class="t-bodys m0">Fresh start</h2>
        <span class="t-label c2">It's been {{ gapLabel(f.gapDays) }} · last weigh-in {{ shortDate(lastBefore) }}</span></div></div>
    <p class="t-body m0">Recalculate your targets from today's weight?</p>
    <p class="t-label c2 m0 nums">Trend restarts at {{ kg(f.kg) }} kg · <template v-if="manual">your {{ int(shown.kcal) }} kcal stays, macros follow</template><template v-else>{{ int(shown.kcal) }} → {{ int(next) }} kcal</template></p>
    <div class="row btns">
      <button type="button" class="chip on t-label big" @click="yes">Recalculate</button>
      <button type="button" class="chip t-label big" @click="no">Not now</button>
    </div>
    <p class="t-capn c2 m0">Either way, the weekly update runs on Monday as usual.</p>
  </section>
</template>

<style scoped>
.fs { gap: 10px; border: 1px solid var(--color-border-strong); }
.m0 { margin: 0; }
.top { gap: 12px; }
.ic { width: 36px; height: 36px; border-radius: 18px; background: var(--color-surface-2); color: var(--text-primary); display: flex; align-items: center; justify-content: center; flex: none; }
.btns { gap: 8px; flex-wrap: wrap; }
.chip.big { min-height: 44px; padding: 0 16px; border-radius: 22px; color: var(--text-primary); }
.chip.big.on { color: var(--color-on-action); }
</style>
