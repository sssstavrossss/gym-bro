<script setup lang="ts">
/**
 * One on/off row: a name, a line about it, and a switch on the right. A locked row is on and
 * can't change (the first page of a card, Home's week). Used by the card pages sheet and
 * Settings → Home sections.
 */
defineProps<{ title: string; caption: string; on: boolean; locked?: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    type="button"
    class="srow"
    role="switch"
    :aria-checked="locked || on"
    :disabled="locked"
    @click="emit('toggle')"
  >
    <span class="col grow">
      <span class="t-body">{{ title }}</span>
      <span class="t-capn c2">{{ caption }}</span>
    </span>
    <span class="switch" :class="{ on: locked || on, lock: locked }" aria-hidden="true"><i /></span>
  </button>
</template>

<style scoped>
.srow { min-height: 52px; width: 100%; display: flex; align-items: center; gap: var(--space-m); text-align: left; padding: 0; }
.srow + .srow { border-top: 1px solid var(--color-border); }
.srow:disabled { opacity: 1; cursor: default; }
.srow .grow { min-width: 0; }
.switch { position: relative; width: 46px; height: 28px; border-radius: var(--radius-l); background: var(--color-track); flex: none; transition: background .15s; }
.switch i { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: var(--radius-m); background: var(--text-tertiary); transition: transform .15s, background .15s; }
.switch.on { background: var(--color-action); }
.switch.on i { transform: translateX(18px); background: var(--color-on-action); }
.switch.lock { opacity: .45; }
</style>
