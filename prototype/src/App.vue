<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import TabBar from "./components/TabBar.vue";
import SideNav from "./components/SideNav.vue";
import AddChooser from "./components/AddChooser.vue";
import FoodSheet from "./components/FoodSheet.vue";
import WeightSheet from "./components/WeightSheet.vue";
import AccuracySheet from "./components/AccuracySheet.vue";
import Toast from "./components/Toast.vue";
import CopySheet from "./components/CopySheet.vue";
import GroupSheet from "./components/GroupSheet.vue";
import SelectBar from "./components/SelectBar.vue";
import Onboarding from "./components/Onboarding.vue";
import ServerDown from "./components/ServerDown.vue";
import { nowHM } from "./lib/time";
import { state } from "./store";
import { DEMO_STATES, applyDemo, isDemoState } from "./lib/demo";
import { openRowId } from "./components/swipeState";
import { vp } from "./lib/viewport";
import { closeAccuracy, closeSheet, endSelect, openFood, openWeight, ui } from "./ui";

const route = useRoute();
const scroller = ref<HTMLElement | null>(null);
watch(() => route.fullPath, () => { scroller.value?.scrollTo({ top: 0 }); openRowId.value = null; if (ui.sheet !== "copy") endSelect(); });

// ?demo=<state> opens a demo state directly (reviewers, screenshots).
const q = new URLSearchParams(location.search).get("demo");
if (isDemoState(q)) applyDemo(q);
const demoLabel = () => DEMO_STATES.find((d) => d.key === ui.demo)?.label ?? "";

// Keyboard shortcuts (useful on desktop, harmless elsewhere).
function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement;
  const typing = el.closest("input, textarea, [contenteditable='true']") !== null;
  if (e.key === "Escape") {
    if (!ui.sheet && ui.selecting) { e.preventDefault(); endSelect(); return; }
    if (!ui.sheet) return;
    e.preventDefault();
    // In food detail, Esc steps back to the list first.
    if (ui.sheet === "food" && ui.detailFoodId && !ui.editEntry) ui.detailFoodId = null;
    else if (ui.sheet === "accuracy") closeAccuracy();
    else closeSheet();
    return;
  }
  if (typing || ui.sheet || !state.onboarded) return;
  const k = e.key.toLowerCase();
  if (k === "n" || k === "/") { e.preventDefault(); openFood(); }
  else if (k === "q") { e.preventDefault(); openFood({ tab: "quick" }); }
  else if (k === "w") { e.preventDefault(); openWeight(); }
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

// S4: full-screen "Server unreachable" (demo "down", or the device is offline). "View last synced data"
// hides it until the next failure and leaves a slim read-only banner.
const online = ref(navigator.onLine);
const browsing = ref(false);
const lastSync = nowHM();
const setOnline = () => { online.value = true; browsing.value = false; };
const setOffline = () => { online.value = false; browsing.value = false; };
onMounted(() => { window.addEventListener("online", setOnline); window.addEventListener("offline", setOffline); });
onBeforeUnmount(() => { window.removeEventListener("online", setOnline); window.removeEventListener("offline", setOffline); });
watch(() => ui.demo, () => (browsing.value = false));
const down = () => ui.demo === "down" || !online.value;
function retryDown() { if (ui.demo !== "down" && navigator.onLine) online.value = true; }
</script>

<template>
  <div class="app" :class="{ 'is-tablet': vp.tablet && !vp.desktop, 'is-desktop': vp.desktop, 'is-wide': vp.wide, 'can-hover': vp.hover, 'ro-browse': down() && browsing }">
    <SideNav v-if="vp.desktop" />
    <div ref="scroller" class="scroller">
      <RouterView v-slot="{ Component, route: r }">
        <component :is="Component" :key="r.path.split('/')[1]" />
      </RouterView>
    </div>
    <div v-if="!vp.desktop" class="status-bg" aria-hidden="true">
      <div class="fake-status">
        <span class="t-bodys">9:41</span>
        <svg width="66" height="12" viewBox="0 0 66 12"><rect x="0" y="7" width="3" height="5" rx="1" fill="#fff"/><rect x="5" y="5" width="3" height="7" rx="1" fill="#fff"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#fff"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#fff"/><path d="M30 4.5a9 9 0 0 1 12 0M32.5 7.3a5 5 0 0 1 7 0" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="36" cy="10" r="1.3" fill="#fff"/><rect x="45.5" y="0.5" width="18" height="11" rx="3" stroke="#fff" stroke-opacity=".4" fill="none"/><rect x="47.5" y="2.5" width="14" height="7" rx="1.5" fill="#fff"/><rect x="64.5" y="4" width="1.5" height="4" rx=".75" fill="#fff" fill-opacity=".4"/></svg>
      </div>
    </div>
    <TabBar v-if="!vp.desktop" />
    <AddChooser />
    <FoodSheet />
    <WeightSheet />
    <AccuracySheet />
    <SelectBar />
    <CopySheet />
    <GroupSheet />
    <Onboarding v-if="!state.onboarded" />
    <div v-if="ui.demo !== 'normal' && state.onboarded" class="demo-pill t-capn" :class="{ top: down() && !browsing }" role="status">
      Demo: {{ demoLabel() }} <button type="button" class="t-capn" @click="applyDemo('normal')">Exit</button>
    </div>
    <div v-if="down() && browsing" class="offbar t-capn" role="status">
      {{ online ? "Server unreachable" : "Offline" }} · showing data from {{ lastSync }} · changes can't be saved
      <button type="button" class="t-capn" @click="browsing = false">Retry</button>
    </div>
    <ServerDown v-if="down() && !browsing && state.onboarded" :offline="!online" :last-sync="lastSync" @retry="retryDown" @browse="browsing = true" />
    <Toast />
    <div v-if="!vp.desktop" class="home-ind" aria-hidden="true" />
  </div>
</template>

<style>
.app { position: relative; width: 100%; height: 100vh; height: 100dvh; overflow: hidden; background: var(--color-bg); isolation: isolate; }
.scroller { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; }
.is-desktop .scroller { left: 240px; scrollbar-color: #2e2e33 transparent; }
.status-bg { position: absolute; top: 0; left: 0; right: 0; height: var(--sat); background: var(--color-bg); z-index: 15; pointer-events: none; }
.fake-status { display: none; }
.fake-status .t-bodys { font-size: 17px; line-height: 22px; } /* iOS status bar doesn't follow Dynamic Type */
.demo-statusbar .fake-status { display: flex; height: 54px; padding: 18px 28px 0 32px; justify-content: space-between; align-items: center; }
.home-ind { display: none; }
.demo-pill { position: absolute; z-index: 21; bottom: calc(var(--tabbar-h) + 10px); left: 50%; transform: translateX(-50%); white-space: nowrap; display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 10px; border-radius: 14px; background: #2a2a2f; color: var(--text-secondary); border: 1px dashed var(--text-tertiary); }
.demo-pill button { padding: 3px 8px; border-radius: 10px; background: var(--color-action); color: var(--color-on-action); position: relative; }
.demo-pill button::after { content: ""; position: absolute; inset: -12px -8px; }
.demo-pill.top { z-index: 95; position: fixed; }
.offbar { position: absolute; z-index: 22; top: calc(var(--sat) + 4px); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; white-space: nowrap; padding: 5px 6px 5px 12px; border-radius: 14px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--text-primary); }
.offbar button { padding: 3px 10px; border-radius: 10px; background: var(--color-action); color: var(--color-on-action); position: relative; }
.offbar button::after { content: ""; position: absolute; inset: -12px -8px; }
/* read-only browse: full-width banner; content is pushed below it (main.css) */
.offbar { left: 12px; right: 12px; transform: none; white-space: normal; justify-content: space-between; }
.is-desktop .offbar { left: 252px; right: 24px; }
.is-desktop .demo-pill { bottom: 16px; left: 256px; transform: none; }
.demo-statusbar .home-ind { display: block; position: absolute; z-index: 70; bottom: 8px; left: 50%; width: 134px; height: 5px; margin-left: -67px; border-radius: 3px; background: #fff; pointer-events: none; }
</style>
