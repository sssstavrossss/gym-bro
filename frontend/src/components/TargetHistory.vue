<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import CappedList from "./CappedList.vue";
import { dayMonth, weekdayShort } from "../lib/dates";
import { int } from "../lib/format";
import { getTargetHistory, type TargetHistoryRow } from "../api";
import { ui } from "../ui";

const rows = ref<TargetHistoryRow[]>([]);

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
    <div class="row thead">
      <h2 id="th-h" class="section-title c2 grow">Target history</h2>
      <span class="t-capn c3">{{ rows.length }} {{ rows.length === 1 ? "change" : "changes" }}</span>
    </div>
    <CappedList tag="ol" :max-rows="5" :watch-key="rows.length" class="list" data-history-list>
      <li v-for="(row, index) in rows" :key="`${row.date}-${index}`" class="hrow" :class="{ quiet: row.reasons.includes('recalculation_declined') }">
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
    </CappedList>
  </section>
</template>

<style scoped>
.hist { gap: var(--space-s); }
/* The list element is rendered by CappedList, so its rules go through :deep. Five rows show; the rest scroll. */
.hist :deep(.list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.thead { align-items: baseline; gap: var(--space-s); }
.hrow { display: flex; flex-wrap: wrap; gap: var(--space-m); align-items: flex-start; padding: var(--space-m) 0; border-bottom: 1px solid var(--color-border); }
.hrow:last-child { border-bottom: 0; }
.quiet .t-label { color: var(--text-tertiary); }
.dt { width: 3.75rem; max-width: 100%; flex: none; gap: 1px; }
/* Narrow enough that date, reason and numbers share one row on a 375px phone; the reason ellipses. */
.mid { min-width: 0; flex: 1 1 5.5rem; gap: var(--space-2xs); }
.mid > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.right { align-items: flex-end; text-align: right; gap: var(--space-2xs); flex: 1 1 auto; max-width: 100%; }
:global(html.dt-xl) .hrow { flex-direction: column; }
:global(html.dt-xl) .right { align-items: flex-start; text-align: left; }
h2 { margin: 0; }
</style>
