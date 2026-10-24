<script setup lang="ts">
import { ICONS } from "../lib/icons";
withDefaults(defineProps<{ name: string; size?: number; sw?: number }>(), { size: 20, sw: 2 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="sw"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS[name]" />
</template>
