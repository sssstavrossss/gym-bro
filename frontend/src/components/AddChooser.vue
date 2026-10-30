<script setup lang="ts">
import Icon from "./Icon.vue";
import { closeSheet, openFood, openWeight, ui } from "../ui";
</script>

<template>
  <Transition name="fade">
    <div v-if="ui.sheet === 'chooser'" class="chooser-root" role="dialog" aria-modal="true" aria-label="Add" @click.self="closeSheet">
      <div class="chooser">
        <button type="button" class="tile" @click="openFood()">
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
.chooser { width: 100%; max-width: 520px; display: flex; gap: 12px; padding: 12px; border-radius: var(--radius-sheet); background: var(--color-surface); }
.tile { flex: 1 1 0; min-width: 0; min-height: 128px; border-radius: var(--radius-card); padding: 16px; background: var(--color-surface-2); display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; }
.tile:active { background: #303036; }
.ic { width: 44px; height: 44px; border-radius: 22px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; }
.close { width: 56px; height: 56px; border-radius: 28px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active, .fade-leave-active { transition: none; }
}
</style>
