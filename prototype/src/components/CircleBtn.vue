<script setup lang="ts">
import Icon from "./Icon.vue";
const props = withDefaults(defineProps<{ icon: string; size?: number; filled?: boolean; label: string; disabled?: boolean }>(), { size: 32, filled: false });
const iconSize = Math.round(props.size * 0.55);
</script>

<template>
  <button type="button" class="cbtn" :class="{ filled }" :style="{ '--s': size + 'px' }" :aria-label="label" :disabled="disabled">
    <Icon :name="icon" :size="iconSize" :sw="2.4" />
  </button>
</template>
