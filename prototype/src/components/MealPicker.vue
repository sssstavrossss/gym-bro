<script setup lang="ts">
// Chip with a small drop-down list (meal picker, day picker …).
import { ref } from "vue";
import Icon from "./Icon.vue";
const props = defineProps<{ label: string; options: { value: string; label: string; hint?: string }[]; modelValue: string; align?: "left" | "right" }>();
const emit = defineEmits<{ "update:modelValue": [string] }>();
const open = ref(false);
function pick(v: string) { emit("update:modelValue", v); open.value = false; }
void props;
</script>

<template>
  <div class="picker">
    <button type="button" class="mchip" :aria-expanded="open" @click="open = !open">
      <span class="t-label">{{ label }}</span>
      <Icon name="down" :size="14" class="c2" />
    </button>
    <template v-if="open">
      <div class="catch" @click="open = false" />
      <div class="menu" :class="align === 'left' ? 'left' : 'right'" role="listbox">
        <button v-for="o in options" :key="o.value" type="button" class="opt" role="option"
          :aria-selected="o.value === modelValue" @click="pick(o.value)">
          <span class="t-body grow">{{ o.label }}</span>
          <span v-if="o.hint" class="t-label c3">{{ o.hint }}</span>
          <Icon v-if="o.value === modelValue" name="check" :size="16" :sw="2.6" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.picker { position: relative; }
.mchip { position: relative; min-height: 32px; height: auto; padding: 0 8px 0 12px; border-radius: 16px; background: var(--color-surface-2); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.catch { position: fixed; inset: 0; z-index: 40; }
.menu { position: absolute; top: 38px; z-index: 41; min-width: 200px; background: #2f2f34; border-radius: 14px; padding: 6px; box-shadow: 0 12px 32px rgba(0,0,0,.6); display: flex; flex-direction: column; }
.menu.right { right: 0; }
.menu.left { left: 0; }
.opt { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 10px; border-radius: 10px; text-align: left; }
.opt:active { background: #3a3a40; }
.opt svg { width: 16px; }
.mchip::after { content: ""; position: absolute; inset: -6px 0; } /* 44 pt hit area */
.dt-xl .mchip { white-space: normal; }
</style>
