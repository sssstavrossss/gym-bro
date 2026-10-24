<script setup lang="ts">
import Icon from "./Icon.vue";
const props = withDefaults(defineProps<{ decimal?: boolean }>(), { decimal: true });
const emit = defineEmits<{ key: [string] }>();
const rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "⌫"]];
function press(k: string) {
  if (k === "." && !props.decimal) return;
  emit("key", k);
}
</script>

<template>
  <div class="keypad">
    <div v-for="(r, i) in rows" :key="i" class="krow">
      <button v-for="k in r" :key="k" type="button" class="key" :class="{ dim: k === '.' && !decimal }"
        :aria-label="k === '⌫' ? 'Delete' : k" @click="press(k)">
        <Icon v-if="k === '⌫'" name="back" :size="22" :sw="1.8" />
        <span v-else class="t-ns">{{ k }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.keypad { display: flex; flex-direction: column; gap: 8px; flex: none; }
.krow { display: flex; gap: 8px; }
.key { flex: 1 1 0; height: 50px; border-radius: var(--radius-control); background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; }
.key .t-ns { font-size: 1.2941rem; }
.key:active { background: #34343a; }
.key.dim { opacity: .3; }
.key .t-ns { font-size: min(1.2941rem, 30px); } /* keys keep their size; digits cap */
</style>
