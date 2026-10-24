<script setup lang="ts">
import Icon from "./Icon.vue";
import CircleBtn from "./CircleBtn.vue";
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
      <CircleBtn icon="x" :size="56" filled label="Close" class="close" @click="closeSheet" />
    </div>
  </Transition>
</template>

<style scoped>
.chooser-root { position: absolute; inset: 0; z-index: 25; background: rgba(0,0,0,.6); display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 20px; padding: 0 16px calc(var(--tabbar-h) - 64px); }
.chooser { width: 100%; max-width: 520px; display: flex; gap: 12px; padding: 12px; border-radius: var(--radius-sheet); background: var(--color-surface); }
.tile { flex: 1 1 0; min-height: 128px; border-radius: var(--radius-card); padding: 16px; background: var(--color-surface-2); display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; }
.tile:active { background: #303036; }
.ic { width: 40px; height: 40px; border-radius: 20px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-active .chooser, .fade-leave-active .chooser { transition: transform .25s cubic-bezier(.2,.8,.2,1); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.fade-enter-from .chooser, .fade-leave-to .chooser { transform: translateY(24px); }
</style>
