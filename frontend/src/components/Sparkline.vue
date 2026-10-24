<script setup lang="ts">
import { computed } from "vue";
import type { WeightChartPoint } from "../api";
import { SPARK_HEIGHT, SPARK_WIDTH, sparklineLayout } from "../lib/sparkline";

const props = defineProps<{ series: WeightChartPoint[] }>();
const layout = computed(() => sparklineLayout(props.series.map((point) => ({
  weighInKg: point.weighInKg,
  trendKg: point.trendKg,
}))));
</script>

<template>
  <svg class="spark" :width="SPARK_WIDTH" :height="SPARK_HEIGHT" :viewBox="`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`" aria-hidden="true">
    <circle v-for="(dot, index) in layout.dots" :key="index" :cx="dot.cx" :cy="dot.cy" r="3" fill="#7DB1FF" fill-opacity="0.35" />
    <polyline :points="layout.line" fill="none" stroke="#7DB1FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.spark { flex: none; width: 132px; height: 52px; }
</style>
