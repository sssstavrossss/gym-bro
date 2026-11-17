<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import CappedList from "./CappedList.vue";
import Icon from "./Icon.vue";
import { dayMonth, weekdayShort } from "../lib/dates";
import { int } from "../lib/format";
import { changeChip, detailRows, historyItems, historySub, historyTitle, type HistoryUnits } from "../lib/targetHistory";
import { getTargetHistory, type TargetHistoryRow } from "../api";
import { ht, weightUnit, wt, wtSigned } from "../state/units";
import { ui } from "../ui";

const PAGE = 20;
const rows = ref<TargetHistoryRow[]>([]);
const total = ref(0);
const more = ref(false);
const loading = ref(false);
/** The one recalculation whose saved details are open. */
const openKey = ref("");

const units = computed<HistoryUnits>(() => ({
  weight: (kg) => String(Number(wt(kg, 2))),
  weightSigned: (kg) => wtSigned(kg, 2),
  weightUnit: weightUnit(),
  height: ht,
}));
const items = computed(() => historyItems(rows.value));

async function reload() {
  try {
    const page = await getTargetHistory(0, PAGE);
    rows.value = page.rows;
    total.value = page.total;
    more.value = page.more;
  } catch {
    rows.value = [];
  }
}

async function older() {
  if (loading.value) return;
  loading.value = true;
  try {
    const page = await getTargetHistory(rows.value.length, PAGE);
    rows.value = [...rows.value, ...page.rows];
    total.value = page.total;
    more.value = page.more;
  } catch {
    // The button stays, so the person can try again.
  } finally {
    loading.value = false;
  }
}

function toggle(key: string) {
  openKey.value = openKey.value === key ? "" : key;
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
      <span class="t-capn c3">{{ total }} {{ total === 1 ? "change" : "changes" }}</span>
    </div>
    <CappedList tag="ol" :max-rows="6" :watch-key="`${items.length}-${openKey}`" class="list" data-history-list>
      <li v-for="item in items" :key="item.key" :class="item.kind === 'month' ? 'month' : 'hrow'" :data-history-item="item.kind">
        <span v-if="item.kind === 'month'" class="t-capn c3">{{ item.label }}</span>
        <div v-else-if="item.kind === 'declines'" class="top quiet">
          <span class="col dt">
            <span class="t-label">{{ dayMonth(item.rows[0].date) }}</span>
            <span class="t-capn c2">{{ weekdayShort(item.rows[0].date) }}</span>
          </span>
          <span class="col grow mid">
            <span class="t-label">{{ item.label }}</span>
            <span class="t-capn c2">Kept {{ int(item.rows[0].kcal) }}</span>
          </span>
        </div>
        <template v-else>
          <component
            :is="item.row.recalculation ? 'button' : 'div'"
            :type="item.row.recalculation ? 'button' : undefined"
            class="top"
            :class="{ quiet: item.row.kind === 'declined', tap: !!item.row.recalculation }"
            :aria-expanded="item.row.recalculation ? openKey === item.key : undefined"
            @click="item.row.recalculation && toggle(item.key)"
          >
            <span class="col dt">
              <span class="t-label">{{ dayMonth(item.row.date) }}</span>
              <span class="t-capn c2">{{ weekdayShort(item.row.date) }}</span>
            </span>
            <span class="col grow mid">
              <span class="t-label">{{ historyTitle(item.row) }}<Icon v-if="item.row.recalculation" name="down" :size="14" class="c2 chev" :class="{ up: openKey === item.key }" /></span>
              <span class="t-capn c2 sub">{{ historySub(item.row, units) }}</span>
            </span>
            <span v-if="item.row.kind !== 'declined'" class="col right">
              <span class="t-bodys num">{{ int(item.row.kcal) }} <span class="t-capn c2">kcal</span></span>
              <span v-if="changeChip(item.row)" class="delta num" data-change-chip>{{ changeChip(item.row) }}</span>
              <span v-else-if="item.row.previousKcal != null" class="t-capn c2">no change</span>
              <span v-else class="t-capn c2 num">P{{ item.row.protein }} · F{{ item.row.fat }} · C{{ item.row.carbs }}</span>
            </span>
          </component>
          <dl v-if="openKey === item.key" class="det" data-history-details>
            <template v-for="[label, value] in detailRows(item.row, units)" :key="label">
              <dt>{{ label }}</dt>
              <dd class="num">{{ value }}</dd>
            </template>
          </dl>
        </template>
      </li>
    </CappedList>
    <button v-if="more" type="button" class="btn sm secondary t-label older" :disabled="loading" data-history-older @click="older">
      <Icon name="down" :size="14" /> Show older
    </button>
  </section>
</template>

<style scoped>
.hist { gap: var(--space-s); }
/* The list element is rendered by CappedList, so its rules go through :deep. Six items show; the rest scroll. */
.hist :deep(.list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.thead { align-items: baseline; gap: var(--space-s); }
.month { padding: var(--space-m) 0 var(--space-2xs); text-transform: uppercase; letter-spacing: 0.04em; }
.month:first-child { padding-top: 0; }
.hrow { display: flex; flex-direction: column; gap: var(--space-s); padding: var(--space-m) 0; border-bottom: 1px solid var(--color-border); }
.hrow:has(+ .month), .hrow:last-child { border-bottom: 0; }
.top { display: flex; gap: var(--space-m); align-items: flex-start; width: 100%; text-align: left; color: inherit; font: inherit; background: none; padding: 0; border: 0; }
.tap { cursor: pointer; }
.quiet .t-label { color: var(--text-tertiary); }
.dt { width: 3.75rem; flex: none; gap: 1px; }
.mid { min-width: 0; flex: 1 1 5.5rem; gap: var(--space-2xs); }
.mid > .t-label { display: inline-flex; align-items: center; gap: var(--space-xs); }
/* The reason and its burn line wrap; a profile change can list several fields. */
.sub { overflow-wrap: anywhere; }
.chev { transition: transform .15s; }
.chev.up { transform: rotate(180deg); }
.right { align-items: flex-end; text-align: right; gap: var(--space-2xs); flex: none; }
.num { font-variant-numeric: tabular-nums; }
.delta { font-size: 12px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-pill); background: var(--color-surface-2); color: var(--text-primary); }
.det {
  margin: 0 0 0 calc(3.75rem + var(--space-m)); background: var(--color-surface-2); border-radius: var(--radius-m);
  padding: var(--space-s) var(--space-m); display: grid; grid-template-columns: auto 1fr; gap: var(--space-xs) var(--space-m); font-size: 13px;
}
.det dt { color: var(--text-secondary); white-space: nowrap; }
.det dd { margin: 0; text-align: right; }
.older { align-self: center; }
:global(html.dt-xl) .top { flex-direction: column; }
:global(html.dt-xl) .right { align-items: flex-start; text-align: left; }
:global(html.dt-xl) .det { margin-left: 0; }
h2 { margin: 0; }
</style>
