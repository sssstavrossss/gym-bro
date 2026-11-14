<script setup lang="ts">
import Icon from "./Icon.vue";
defineProps<{ on: boolean }>();
</script>

<template>
  <span class="face" :class="{ on }" aria-hidden="true">
    <span class="dot" />
    <Icon name="check" :size="12" :sw="3.4" class="tick" />
  </span>
</template>

<style scoped>
.face { position: absolute; inset: 0; }
.dot, .tick {
  position: absolute; left: 50%; top: 50%;
  width: 16px; height: 16px;
  transform: translate(-50%, -50%);
}
.dot {
  border-radius: 8px; background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--text-tertiary);
  transition: background .18s ease, box-shadow .18s ease;
}
.tick { color: var(--color-on-action); opacity: 0; transition: opacity .18s ease; }
.face.on .dot { background: var(--color-action); box-shadow: none; }
.face.on .tick { opacity: 1; }
</style>
