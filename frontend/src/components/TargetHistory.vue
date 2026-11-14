<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { dayMonth, weekdayShort } from "../lib/dates";
import { int } from "../lib/format";
import { getTargetHistory, type TargetHistoryRow } from "../api";
import { ui } from "../ui";

const rows = ref<TargetHistoryRow[]>([]);
const all = ref(false);
const shown = computed(() => (all.value ? rows.value : rows.value.slice(0, 5)));

function title(reasons: string[]): string {
  if (reasons.includes("recalculation_declined")) return "Declined";
  if (reasons.includes("recalculation_formula") || reasons.includes("recalculation_adaptive")) return "Recalculated";
  if (reasons.includes("weekly_recalculation")) return "Weekly update";
  if (reasons.includes("macro_balance_change")) return "Macro balance change";
  if (reasons.includes("fresh_start")) return "Fresh start";
  if (reasons.includes("manual_changed")) return "Own number changed";
  if (reasons.includes("mode_switch")) return "Goal mode switch";
  if (reasons.includes("profile_change")) return "Profile change";
  return "Target change";
}
function hint(reasons: string[]): string {
  if (reasons.includes("recalculation_adaptive")) return "From your logs";
  if (reasons.includes("recalculation_formula")) return "From the formula";
  if (reasons.includes("weekly_recalculation")) return "Trend weight updated";
  return "";
}

async function reload() {
  try { rows.value = (await getTargetHistory()).rows; } catch { rows.value = []; }
}
onMounted(() => { void reload(); });
watch(() => ui.sheet, (sheet, previous) => {
  if (previous === "recalculate" && sheet !== "recalculate") void reload();
});
</script>

<template>
  <section v-if="rows.length" class="card hist" aria-labelledby="th-h" data-target-history>
    <div class="row">
      <h2 id="th-h" class="t-cap c2">Target history</h2>
      <span class="grow" />
      <span class="t-capn c2">read-only · newest first</span>
    </div>
    <ol class="list">
      <li v-for="(row, index) in shown" :key="`${row.date}-${index}`" class="hrow" :class="{ quiet: row.reasons.includes('recalculation_declined') }">
        <span class="col dt">
          <span class="t-label">{{ dayMonth(row.date) }}</span>
          <span class="t-capn c2">{{ weekdayShort(row.date) }}</span>
        </span>
        <span class="col grow mid">
          <span class="t-label">{{ title(row.reasons) }}</span>
          <span v-if="row.suggestedKcal != null" class="t-capn c2">Suggested {{ int(row.suggestedKcal) }} · kept {{ int(row.kcal) }}</span>
          <span v-else-if="hint(row.reasons)" class="t-capn c2">{{ hint(row.reasons) }}</span>
        </span>
        <span v-if="row.suggestedKcal == null" class="col right">
          <span class="t-bodys num">{{ int(row.kcal) }} <span class="t-capn c2">kcal</span></span>
          <span class="t-capn c2 num">P{{ row.protein }} · F{{ row.fat }} · C{{ row.carbs }}</span>
        </span>
      </li>
    </ol>
    <button v-if="rows.length > 5" type="button" class="more t-label" :aria-expanded="all" @click="all = !all">{{ all ? "Show fewer" : `Show all ${rows.length} changes` }}</button>
    <p class="t-capn c2 foot">Past days keep the target they had. Accepted recalculations that change the target and every declined recalculation are listed.</p>
  </section>
</template>

<style scoped>
.hist { gap: calc(var(--space-gap) / 2); }
.row { flex-wrap: wrap; align-items: flex-start; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hrow { display: flex; flex-wrap: wrap; gap: var(--space-gap); align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--color-border); }
.hrow:last-child { border-bottom: 0; }
.quiet .t-label { color: var(--text-tertiary); }
.dt { width: auto; max-width: 100%; flex: none; gap: 1px; }
.mid { min-width: 0; flex: 1 1 8rem; gap: 2px; }
.right { align-items: flex-end; text-align: right; gap: 2px; flex: 1 1 auto; max-width: 100%; }
:global(html.dt-xl) .hrow { flex-direction: column; }
:global(html.dt-xl) .right { align-items: flex-start; text-align: left; }
.more { align-self: flex-start; min-height: 44px; text-decoration: underline; text-underline-offset: 3px; }
.foot { margin: 0; }
h2 { margin: 0; }
</style>
