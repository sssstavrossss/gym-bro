<script setup lang="ts">
// S4: full-screen "Server unreachable" — replaces the browser's own error page. Shown in the "down"
// demo state and whenever the device reports it is offline (navigator.onLine). Calm, no red, no blame.
import { nextTick, onMounted, ref } from "vue";
import Icon from "./Icon.vue";
const props = defineProps<{ offline: boolean; lastSync: string }>();
const emit = defineEmits<{ retry: []; browse: [] }>();
const trying = ref(false);
const tried = ref<string | null>(null);
const h = ref<HTMLElement | null>(null);
function retry() {
  trying.value = true;
  setTimeout(() => {
    trying.value = false;
    const d = new Date();
    tried.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    emit("retry");
  }, 900);
}
onMounted(() => nextTick(() => h.value?.focus()));
void props;
</script>

<template>
  <div class="down" role="alertdialog" aria-modal="true" aria-labelledby="down-h" aria-describedby="down-b">
    <div class="inner col">
      <span class="badge" aria-hidden="true"><Icon :name="offline ? 'wifioff' : 'server'" :size="30" :sw="1.8" /></span>
      <h1 id="down-h" ref="h" tabindex="-1" class="t-title">{{ offline ? "You're offline" : "Can't reach Gym Bro" }}</h1>
      <p id="down-b" class="t-body c2">
        {{ offline ? "Gym Bro needs a connection to load and save your log." : "The server isn't answering right now — it may be restarting or asleep." }}
        Nothing you've logged is lost.
      </p>
      <div class="facts col t-label">
        <span class="row"><Icon name="check" :size="14" :sw="2.6" /> Your log is saved on the server</span>
        <span class="row"><Icon name="clock" :size="14" :sw="2.2" /> Last synced today at {{ lastSync }}</span>
      </div>
      <button type="button" class="primary-btn t-bodys" :disabled="trying" :aria-busy="trying" @click="retry">
        <Icon name="refresh" :size="18" :class="{ spin: trying }" /> {{ trying ? "Trying…" : "Try again" }}
      </button>
      <p class="t-capn c2 m0" aria-live="polite">{{ tried ? `Still unreachable · last tried ${tried}. We'll also retry when the connection is back.` : "We'll retry automatically when the connection is back." }}</p>
      <button type="button" class="ghost t-label" @click="emit('browse')">View last synced data (read-only)</button>
    </div>
  </div>
</template>

<style scoped>
.down { position: fixed; inset: 0; z-index: 90; background: var(--color-bg); display: flex; align-items: center; justify-content: center;
  padding: calc(var(--sat, 0px) + 24px) 24px calc(var(--sab, 0px) + 24px); overflow-y: auto; }
.inner { max-width: 420px; width: 100%; gap: 14px; align-items: flex-start; }
.badge { width: 64px; height: 64px; border-radius: 20px; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
h1 { margin: 0; outline: none; }
p { margin: 0; }
.m0 { margin: 0; }
.facts { gap: 8px; padding: 12px 14px; border-radius: 14px; background: var(--color-surface); width: 100%; }
.facts .row { gap: 8px; }
.primary-btn { margin-top: 8px; gap: 8px; }
.ghost { min-height: 44px; align-self: center; text-decoration: underline; text-underline-offset: 3px; color: var(--text-secondary); }
.ghost:hover { color: var(--text-primary); }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
