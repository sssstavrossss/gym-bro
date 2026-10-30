<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { hasLog, log, retryPending, type LogEntry, type PendingAdd } from "../state/log";
import { openEdit, openFood } from "../ui";

defineProps<{ compact?: boolean; showEmpty?: boolean }>();
const rows = computed(() => [...log.entries].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id)));

function amountOf(entry: LogEntry): string {
  if (entry.unit && entry.amount) return `${entry.amount} ${entry.unit}`;
  return "";
}
function macros(entry: { protein: number; fat: number; carbs: number }): string {
  return `P${int(entry.protein)} F${int(entry.fat)} C${int(entry.carbs)}`;
}
async function retry(pending: PendingAdd) {
  await retryPending(pending.idempotencyKey);
}
</script>

<template>
  <div class="tl" :class="{ compact }">
    <div v-if="showEmpty && !hasLog()" class="empty col">
      <span class="eic"><Icon name="food" :size="22" /></span>
      <span class="t-head">Nothing logged yet today</span>
      <span class="t-label c2">Add food as you eat — each entry gets the time you add it.</span>
      <button type="button" class="primary-btn t-bodys ebtn" @click="openFood()"><Icon name="plus" :size="18" :sw="2.6" /> Add food</button>
    </div>
    <template v-else>
      <div v-for="pending in log.pending" :key="pending.idempotencyKey" class="frow pending">
        <span class="time t-label c2">{{ pending.time || "Now" }}</span>
        <span class="col grow two">
          <span class="t-body name">{{ pending.name }}</span>
          <span class="t-capn c2">Pending · {{ macros(pending) }}</span>
        </span>
        <button type="button" class="retry t-bodys" @click="retry(pending)">Retry</button>
        <span class="t-bodys kc" data-num>{{ int(pending.kcal) }}</span>
      </div>
      <button v-for="entry in rows" :key="entry.id" type="button" class="frow" @click="openEdit(entry.id)">
        <span class="time t-label num c2">{{ entry.time }}</span>
        <span class="col grow two">
          <span class="t-body name">{{ entry.name }}</span>
          <span class="t-capn c2">{{ amountOf(entry) ? `${amountOf(entry)} · ` : "" }}{{ macros(entry) }}</span>
        </span>
        <span class="t-bodys kc" data-num>{{ int(entry.kcal) }}</span>
      </button>
      <button v-if="rows.length || log.pending.length" type="button" class="addrow row" @click="openFood()">
        <span class="cbtn addc" style="--s: 44px" aria-hidden="true"><Icon name="plus" :size="16" :sw="2.4" /></span>
        <span class="t-body c2">Add food</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.tl { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 100%; }
.frow { min-height: 52px; gap: 8px; display: flex; align-items: center; flex-wrap: wrap; text-align: left; width: 100%; min-width: 0; background: transparent; border-radius: 10px; padding: 4px 0; }
.pending { border: 1px dashed var(--color-border); border-radius: 12px; padding: 8px; }
.time { width: 3.2rem; flex: none; }
.two { gap: 1px; min-width: 0; align-items: flex-start; }
.name { overflow-wrap: anywhere; min-width: 0; max-width: 100%; }
.kc { min-width: 2.6rem; text-align: right; flex: none; }
.retry { min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 22px; background: var(--color-surface-2); flex: none; }
.addrow { min-height: 44px; gap: 8px; text-align: left; }
.empty { align-items: center; text-align: center; gap: 8px; padding: 28px 16px; border-radius: var(--radius-card); border: 1px dashed var(--color-border); }
.eic { width: 44px; height: 44px; border-radius: 22px; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
.ebtn { width: auto; padding: 0 22px; min-height: 44px; margin-top: 8px; }
</style>
