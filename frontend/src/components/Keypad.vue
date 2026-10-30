<script setup lang="ts">
import Icon from "./Icon.vue";
const props = withDefaults(defineProps<{ decimal?: boolean }>(), { decimal: true });
const emit = defineEmits<{ key: [string] }>();
const rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "⌫"]];
function press(key: string) {
  if (key === "." && !props.decimal) return;
  emit("key", key);
}
</script>

<template>
  <div class="keypad" role="group" aria-label="Number keypad">
    <div v-for="(row, index) in rows" :key="index" class="krow">
      <button v-for="key in row" :key="key" type="button" class="key" :class="{ dim: key === '.' && !decimal }"
        :aria-label="key === '⌫' ? 'Delete digit' : key" @click="press(key)">
        <Icon v-if="key === '⌫'" name="back" :size="22" :sw="1.8" />
        <span v-else class="t-ns">{{ key }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.keypad { display: flex; flex-direction: column; gap: 8px; flex: none; max-width: 100%; }
.krow { display: flex; gap: 8px; }
.key { flex: 1 1 0; min-width: 44px; height: 50px; border-radius: var(--radius-control); background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; }
.key .t-ns { font-size: min(1.2941rem, 30px); }
.key:active { background: #34343a; }
.key.dim { opacity: .3; }
</style>
