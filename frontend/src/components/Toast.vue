<script setup lang="ts">
import { computed, watch } from "vue";
import { vp } from "../lib/viewport";
import { runToastAction, ui } from "../ui";

/** Phone and tablet: while the food sheet is open, pin the toast to the top. Desktop stays at the bottom. */
const parked = computed(() => ui.sheet === "food" && !vp.desktop);
const lift = computed(() => ui.selecting && !parked.value);

function place() {
  const el = document.querySelector(".toast.top");
  const space = parked.value && ui.toast && el
    ? `${Math.ceil(el.getBoundingClientRect().height) + 12}px`
    : "0px";
  document.documentElement.style.setProperty("--food-toast-space", space);
}

watch([() => ui.toast?.id ?? 0, parked], () => {
  place();
}, { flush: "post" });
</script>

<template>
  <Transition name="toast" mode="out-in">
    <div v-if="ui.toast" :key="ui.toast.id" class="toast" :class="{ top: parked, lift }" role="status">
      <span class="t-label grow msg">{{ ui.toast.text }}</span>
      <button v-if="ui.toast.action" type="button" class="t-bodys undo" @click="runToastAction">{{ ui.toast.action.label }}</button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: absolute; left: 16px; right: 16px; bottom: calc(var(--tabbar-h) + 12px); z-index: 60;
  display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px;
  background: var(--color-surface); color: var(--text-primary); box-shadow: 0 10px 30px rgba(0,0,0,.5); max-width: calc(100% - 32px);
}
.msg { color: var(--text-primary); background: var(--color-surface); overflow-wrap: anywhere; }
/* Above the sheet, in the gap the sheet header leaves open. Safe area stays below the clock. */
.toast.top {
  bottom: auto; top: calc(var(--sat) + 8px); z-index: 70;
}
.is-tablet .toast { left: 50%; right: auto; width: 440px; margin-left: -220px; }
.is-tablet .toast.top { left: 16px; right: 16px; width: auto; margin-left: 0; }
.is-desktop .toast { left: 264px; right: auto; bottom: 24px; width: 420px; }
.toast.lift { bottom: calc(140px + max(var(--sab), 12px)); }
.is-desktop .toast.lift { bottom: 140px; }
.undo { color: var(--color-action); min-height: 44px; min-width: 44px; padding: 2px 4px; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s, transform .2s; }
.toast-enter-from { opacity: 1; transform: translateY(8px); }
.toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
