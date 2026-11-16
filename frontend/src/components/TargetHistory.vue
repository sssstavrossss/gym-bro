<script setup lang="ts">
import { onMounted, watch } from "vue";
import CappedList from "./CappedList.vue";
import { dayMonth, weekdayShort } from "../lib/dates";
import { int } from "../lib/format";
import { history, loadHistory } from "../state/history";
import { ui } from "../ui";

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

/** Profile opening counts as seeing the targets; the dots still show for this visit. */
onMounted(() => { void loadHistory(true); });
watch(() => ui.sheet, (sheet, previous) => {
  if (previous === "recalculate" && sheet !== "recalculate") void loadHistory();
});
</script>

<template>
  <section v-if="history.rows.length" class="card hist" aria-labelledby="th-h" data-target-history>
    <div class="row thead">
      <h2 id="th-h" class="section-title c2 grow">Target history</h2>
      <span class="t-capn c3">{{ history.rows.length }} {{ history.rows.length === 1 ? "change" : "changes" }}</span>
    </div>
    <CappedList tag="ol" :max-rows="5" :watch-key="history.rows.length" class="list" data-history-list>
      <li
        v-for="(row, index) in history.rows"
        :key="`${row.date}-${index}`"
        class="hrow"
        :class="{ quiet: row.reasons.includes('recalculation_declined') }"
        :data-history-row="index"
        :data-new="history.fresh.includes(index) || undefined"
      >
        <span class="col dt">
          <span class="t-label">{{ dayMonth(row.date) }}</span>
          <span class="t-capn c2">{{ weekdayShort(row.date) }}</span>
        </span>
        <span class="col grow mid">
          <span class="t-label rtitle"><i v-if="history.fresh.includes(index)" class="ndot" aria-hidden="true" />{{ title(row.reasons) }}<span v-if="history.fresh.includes(index)" class="sr-only">, new</span></span>
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
.hist { gap: calc(var(--space-gap) / 2); }
/* The list element is rendered by CappedList, so its rules go through :deep. Five rows show; the rest scroll. */
.hist :deep(.list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.thead { align-items: baseline; gap: 8px; }
.hrow { display: flex; flex-wrap: wrap; gap: var(--space-gap); align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--color-border); }
.hrow:last-child { border-bottom: 0; }
.quiet .t-label { color: var(--text-tertiary); }
/* Same dot as the Profile tab: new since you last looked. */
.ndot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--text-primary); margin-right: 6px; vertical-align: 0.1em; }
.dt { width: 3.75rem; max-width: 100%; flex: none; gap: 1px; }
/* Narrow enough that date, reason and numbers share one row on a 375px phone; the reason ellipses. */
.mid { min-width: 0; flex: 1 1 5.5rem; gap: 2px; }
.mid > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.right { align-items: flex-end; text-align: right; gap: 2px; flex: 1 1 auto; max-width: 100%; }
:global(html.dt-xl) .hrow { flex-direction: column; }
:global(html.dt-xl) .right { align-items: flex-start; text-align: left; }
h2 { margin: 0; }
</style>
