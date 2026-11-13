<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import { useDialogFocus } from "../lib/focusTrap";
import Icon from "./Icon.vue";
import { viewed } from "../state/log";
import { closeSheet, openFood, openWeight, ui } from "../ui";

const root = ref<HTMLElement | null>(null);
const restoreFocus = useDialogFocus(() => ui.sheet === "chooser", root);

const route = useRoute();
function addFood() {
  const onDay = route.path.startsWith("/log") || route.path.startsWith("/today");
  openFood("search", onDay && viewed.date ? viewed.date : undefined);
}
</script>

<template>
  <Transition name="fade" :duration="250" @after-leave="restoreFocus">
    <div v-if="ui.sheet === 'chooser'" ref="root" class="chooser-root" role="dialog" aria-modal="true" aria-label="Add" tabindex="-1" @click.self="closeSheet">
      <div class="chooser">
        <button type="button" class="tile" @click="addFood()">
          <span class="ic"><Icon name="food" :size="20" :sw="2.2" /></span>
          <span class="grow" />
          <span class="t-head">Food</span>
          <span class="t-capn c2">Search or quick add</span>
        </button>
        <button type="button" class="tile" @click="openWeight()">
          <span class="ic"><Icon name="scale" :size="20" :sw="2.2" /></span>
          <span class="grow" />
          <span class="t-head">Weight</span>
          <span class="t-capn c2">Log today's weigh-in</span>
        </button>
      </div>
      <button type="button" class="close" aria-label="Close" @click="closeSheet">
        <Icon name="x" :size="22" :sw="2.4" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.chooser-root { position: absolute; inset: 0; z-index: 25; background: rgba(0,0,0,.6); display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 20px; padding: 0 16px calc(var(--tabbar-h) + 16px); }
.is-tablet .chooser-root { justify-content: center; padding: 24px 16px; }
.is-tablet .chooser { width: min(520px, 100%); }
.chooser { width: 100%; max-width: 520px; display: flex; gap: 12px; padding: 12px; border-radius: var(--radius-sheet); background: var(--color-surface); }
.tile { flex: 1 1 0; min-width: 0; min-height: 128px; border-radius: var(--radius-card); padding: 16px; background: var(--color-surface-2); display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; }
.tile:active { background: var(--color-hover); }
.ic { width: var(--control-s); height: var(--control-s); border-radius: 50%; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; }
.close {
  position: relative; width: var(--control-hit); height: var(--control-hit); border-radius: 50%;
  background: transparent; color: var(--color-on-action); display: flex; align-items: center; justify-content: center; isolation: isolate;
}
.close::before { content: ""; position: absolute; z-index: -1; width: var(--control-s); height: var(--control-s); border-radius: 50%; background: var(--color-action); }
.close > * { position: relative; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active, .fade-leave-active { transition: none; }
}
</style>
