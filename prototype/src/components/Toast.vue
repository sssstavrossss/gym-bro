<script setup lang="ts">
import { ui } from "../ui";
function run() { ui.toast?.action?.run(); ui.toast = null; }
</script>

<template>
  <Transition name="toast">
    <div v-if="ui.toast" :key="ui.toast.id" class="toast" :class="{ top: ui.sheet }" role="status">
      <span class="t-label grow">{{ ui.toast.text }}</span>
      <button v-if="ui.toast.action" type="button" class="t-bodys undo" @click="run">{{ ui.toast.action.label }}</button>
    </div>
  </Transition>
</template>

<style scoped>
.toast { position: absolute; left: 16px; right: 16px; bottom: calc(var(--tabbar-h) + 12px); z-index: 60; display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px; background: #2f2f34; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
.toast.top { bottom: auto; top: max(8px, calc(var(--sat) - 34px)); padding: 10px 16px; }
.is-tablet .toast { left: 50%; right: auto; width: 440px; margin-left: -220px; }
.is-desktop .toast, .is-desktop .toast.top { left: 264px; right: auto; top: auto; bottom: 24px; width: 420px; padding: 12px 16px; }
.undo { color: #fff; padding: 2px 4px; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s, transform .2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
