<script setup lang="ts">
import { computed } from "vue";
import type { WeightChartPoint } from "../api";

const props = defineProps<{ series: WeightChartPoint[] }>();
const path = computed(() => {
  const pts = props.series.filter((point) => point.trendKg != null);
  if (pts.length < 2) return "";
  const values = pts.map((point) => point.trendKg!);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const full = props.series;
  let pen = false;
  return full.map((point, index) => {
    if (point.trendKg == null) {
      pen = false;
      return "";
    }
    const x = (index * 72) / Math.max(full.length - 1, 1);
    const y = 4 + ((hi - point.trendKg) / span) * 28;
    const command = `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
    return command;
  }).join(" ");
});
</script>

<template>
  <svg class="spark" width="72" height="36" viewBox="0 0 72 36" aria-hidden="true">
    <path :d="path" fill="none" stroke="#7DB1FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.spark { flex: none; }
</style>
