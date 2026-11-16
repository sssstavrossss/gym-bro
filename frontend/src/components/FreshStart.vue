<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { addDays, shortDate } from "../lib/dates";
import { int } from "../lib/format";
import { gapLabel } from "../lib/weightDisplay";
import { dismissFresh } from "../lib/prompts";
import { boot } from "../state/boot";
import { answerFreshStart, profile } from "../state/profile";
import { wtUnit } from "../state/units";
import { toast } from "../ui";

const fresh = computed(() => profile.weight?.freshStart ?? null);
const before = computed(() => profile.targets?.kcal ?? null);
const after = computed(() => profile.proposal?.kcal ?? null);
const lastBefore = computed(() => (fresh.value ? addDays(fresh.value.date, -fresh.value.daysSincePrevious) : ""));

async function yes() {
  const next = after.value;
  const ok = await answerFreshStart(true);
  if (!ok) return;
  toast(next != null ? `New target from today: ${int(next)} kcal` : "Targets recalculated from today's weight");
}

async function no() {
  const date = fresh.value?.date;
  const ok = await answerFreshStart(false);
  if (!ok || !date) return;
  dismissFresh(boot.accountId, date);
  toast("Kept your targets · Monday's update runs as usual");
}
</script>

<template>
  <section v-if="fresh" class="card outline fs" role="region" aria-labelledby="fs-h">
    <div class="row top">
      <span class="disc" aria-hidden="true"><Icon name="scale" :size="16" /></span>
      <div class="col grow">
        <h2 id="fs-h" class="t-bodys section-title m0">Fresh start</h2>
        <span class="t-label c2">It's been {{ gapLabel(fresh.daysSincePrevious) }} · last weigh-in {{ shortDate(lastBefore) }}</span>
      </div>
    </div>
    <p class="t-body m0">Recalculate your targets from today's weight?</p>
    <p class="t-label c2 m0 nums">Trend restarts at {{ wtUnit(profile.weight?.latestKg ?? profile.weight?.trendKg ?? 0) }}
      <template v-if="before != null && after != null"> · {{ int(before) }} → {{ int(after) }} kcal</template>
    </p>
    <div class="row btns">
      <button type="button" class="btn sm primary t-label" @click="yes"><Icon name="refresh" :size="14" /> Recalculate</button>
      <button type="button" class="btn sm secondary t-label" @click="no">Not now</button>
    </div>
    <p class="t-capn c2 m0">Either way, the weekly update runs on Monday as usual.</p>
  </section>
</template>

<style scoped>
.m0 { margin: 0; }
.top { gap: var(--space-m); align-items: flex-start; }
.btns { gap: var(--space-s); flex-wrap: wrap; }
</style>
