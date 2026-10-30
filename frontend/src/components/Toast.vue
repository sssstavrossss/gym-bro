<script setup lang="ts">
import { ui } from "../ui";

function run() {
  const action = ui.toast?.action;
  ui.toast = null;
  action?.run();
}
</script>

<template>
  <Transition name="toast">
    <div v-if="ui.toast" :key="ui.toast.id" class="toast" role="status">
      <span class="t-label grow msg">{{ ui.toast.text }}</span>
      <button v-if="ui.toast.action" type="button" class="t-bodys undo" @click="run">{{ ui.toast.action.label }}</button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: absolute; left: 16px; right: 16px; bottom: calc(var(--tabbar-h) + 12px); z-index: 60;
  display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px;
  background: #1a1a1c; color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.5); max-width: calc(100% - 32px);
}
.msg { color: #fff; background: #1a1a1c; overflow-wrap: anywhere; }
.is-tablet .toast { left: 50%; right: auto; width: 440px; margin-left: -220px; }
.is-desktop .toast { left: 264px; right: auto; bottom: 24px; width: 420px; }
.undo { color: #fff; min-height: 44px; min-width: 44px; padding: 2px 4px; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s, transform .2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
