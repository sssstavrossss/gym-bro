<script setup lang="ts">
import { computed } from "vue";
import { addDays } from "../lib/dates";
import { state, trend } from "../store";
const props = defineProps<{ end: string }>();
const W = 132, H = 52;
const d = computed(() => {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(props.end, i - 6));
  const w = dates.map((x) => state.weights[x] ?? null);
  const t = dates.map((x) => trend(x));
  const vals = [...w, ...t].filter((v): v is number => v != null);
  const hi = Math.max(...vals) + 0.05, lo = Math.min(...vals) - 0.05;
  const span = Math.max(hi - lo, 0.6);
  const y = (v: number) => (((hi - v) / span) * (H - 12) + 6).toFixed(1);
  const x = (i: number) => 6 + i * 20;
  return {
    dots: w.map((v, i) => (v == null ? null : { cx: x(i), cy: y(v) })).filter(Boolean) as { cx: number; cy: string }[],
    line: t.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" "),
  };
});
</script>

<template>
  <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
    <circle v-for="(p, i) in d.dots" :key="i" :cx="p.cx" :cy="p.cy" r="3" fill="#7DB1FF" fill-opacity="0.35" />
    <polyline :points="d.line" fill="none" stroke="#7DB1FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
