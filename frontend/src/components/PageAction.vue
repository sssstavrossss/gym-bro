<script setup lang="ts">
import Icon from "./Icon.vue";

/** The first row of an Add food page that makes something new ("New recipe"), with a line naming what it can do. */
defineProps<{ title: string; detail: string }>();
const emit = defineEmits<{ open: [] }>();

/** Opens on press, like the rows below it, so the keyboard can come up with the form on a phone. */
function press(event: PointerEvent) {
  if (event.pointerType === "mouse") return;
  event.preventDefault();
  emit("open");
}
</script>

<template>
  <button type="button" class="paction row" @pointerdown="press" @click="emit('open')">
    <span class="disc filled" aria-hidden="true"><Icon name="plus" :size="16" :sw="2.4" /></span>
    <span class="col grow ptext">
      <span class="t-body">{{ title }}</span>
      <span class="t-label c2">{{ detail }}</span>
    </span>
    <Icon name="right" :size="18" class="c3" />
  </button>
</template>

<style scoped>
.paction {
  width: 100%; min-height: 56px; gap: var(--space-m); padding: var(--space-s) 0;
  border-bottom: 1px solid var(--color-border); text-align: left; background: transparent; flex: none;
}
.ptext { gap: var(--space-2xs); min-width: 0; align-items: flex-start; }
</style>
