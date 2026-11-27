<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AddChooser from "./components/AddChooser.vue";
import CopySheet from "./components/CopySheet.vue";
import GroupSheet from "./components/GroupSheet.vue";
import RecipeSheet from "./components/RecipeSheet.vue";
import FoodSheet from "./components/FoodSheet.vue";
import SelectBar from "./components/SelectBar.vue";
import SideNav from "./components/SideNav.vue";
import TabBar from "./components/TabBar.vue";
import Toast from "./components/Toast.vue";
import GoalWeightSheet from "./components/GoalWeightSheet.vue";
import SettingsSheet from "./components/SettingsSheet.vue";
import NotificationsSheet from "./components/NotificationsSheet.vue";
import NutrientSheet from "./components/NutrientSheet.vue";
import ExerciseSheet from "./components/ExerciseSheet.vue";
import ExercisesSheet from "./components/ExercisesSheet.vue";
import PlanSheet from "./components/PlanSheet.vue";
import PlansSheet from "./components/PlansSheet.vue";
import TrainingSheet from "./components/TrainingSheet.vue";
import PlanWorkoutSheet from "./components/PlanWorkoutSheet.vue";
import WorkoutSheet from "./components/WorkoutSheet.vue";
import OfflineSheet from "./components/OfflineSheet.vue";
import AccuracySheet from "./components/AccuracySheet.vue";
import CardPagesSheet from "./components/CardPagesSheet.vue";
import FanPagesSheet from "./components/FanPagesSheet.vue";
import RecalculateSheet from "./components/RecalculateSheet.vue";
import WeightSheet from "./components/WeightSheet.vue";
import { e2eSession } from "./auth/e2e";
import { isConfigured, loadPublicConfig } from "./auth/publicConfig";
import { currentAccount } from "./auth/session";
import { bindFocusProxy } from "./lib/focusField";
import { RESET_FLASH_KEY } from "./lib/reset";
import { isTypingTarget, screenLayoutFromFlags, shortcutEffect } from "./lib/layout";
import { vp } from "./lib/viewport";
import { boot } from "./state/boot";
import { followDeviceZone, loadProfile, profile, retryLoad } from "./state/profile";
import { refreshInbox } from "./state/inbox";
import { loadToday, sendQueue, viewed } from "./state/log";
import { startSync } from "./state/sync";
import { closeCardPages, closeCopy, closeExercise, closeFanPages, closeFoodLayer, closeGroupSheet, closeRecipeSheet, closeSheet, closeTraining, endSelect, openFood, openWeight, toast, ui } from "./ui";
import SignInView from "./views/SignInView.vue";

const route = useRoute();
const router = useRouter();
const kbProxy = ref<HTMLInputElement | null>(null);
watch(kbProxy, (el) => bindFocusProxy(el));
const showNav = computed(() => profile.hasSaved && route.path !== "/setup");
const layoutName = computed(() => screenLayoutFromFlags({ tablet: vp.tablet, desktop: vp.desktop, wide: vp.wide }));
const sheetOpen = computed(() => ui.sheet != null);

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  const e2e = e2eSession();
  if (e2e) {
    boot.accountId = e2e.oid;
    boot.name = "Test User";
    boot.signedIn = true;
  } else {
    try {
      const config = await loadPublicConfig();
      boot.config = config;
      if (!isConfigured(config)) {
        boot.configError = "Entra settings are empty. Copy .env.example to .env, fill it in, and restart the API.";
        boot.ready = true;
        return;
      }
      const account = await currentAccount(config);
      boot.signedIn = account !== null;
      boot.accountId = account?.localAccountId ?? "";
      boot.name = account?.name ?? account?.username ?? "";
    } catch (error) {
      boot.configError = error instanceof Error ? error.message : "Could not load sign-in settings.";
      boot.ready = true;
      return;
    }
  }

  if (boot.signedIn) {
    startSync(boot.accountId);
    await loadProfile();
    if (profile.hasSaved) {
      void followDeviceZone();
      await loadToday();
      // Anything logged offline last time goes now.
      void sendQueue();
      await refreshInbox();
    }
  }
  boot.ready = true;
  showResetFlash();
});

/** Settings → Reset data reloads the app; its toast waits in sessionStorage until it's back. */
function showResetFlash(): void {
  try {
    const text = sessionStorage.getItem(RESET_FLASH_KEY);
    sessionStorage.removeItem(RESET_FLASH_KEY);
    if (text) toast(text);
  } catch {
    // Storage blocked: the reset happened, just without the toast.
  }
}

watch(() => route.fullPath, () => {
  if (ui.sheet !== "copy") endSelect();
});

watch(() => viewed.date, () => {
  if (ui.sheet !== "copy") endSelect();
});

watch(
  () => [boot.ready, boot.signedIn, profile.hasSaved, route.path] as const,
  () => {
    if (!boot.ready || !boot.signedIn) return;
    if (!profile.hasSaved && route.path !== "/setup") void router.replace("/setup");
    if (profile.hasSaved && route.path === "/setup") void router.replace("/profile");
  },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

function onKey(event: KeyboardEvent) {
  const effect = shortcutEffect({
    key: event.key,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    composing: event.isComposing,
    typing: isTypingTarget(event.target),
    sheet: ui.sheet,
    cardPagesOver: ui.cardPagesOver,
    exerciseOver: ui.exerciseOver,
    fanPagesOver: ui.fanPagesOver,
    trainingOver: ui.trainingOver,
    selecting: ui.selecting,
    nav: showNav.value,
  });
  if (effect.effect === "none") return;
  event.preventDefault();
  const onDay = route.path.startsWith("/log") || route.path.startsWith("/today");
  const day = onDay && viewed.date ? viewed.date : undefined;
  if (effect.action === "add") openFood("search", day);
  else if (effect.action === "quick") openFood("quick", day);
  else if (effect.action === "weight") openWeight();
  else if (effect.action === "close-copy") closeCopy();
  else if (effect.action === "close-group") closeGroupSheet();
  else if (effect.action === "close-recipe") closeRecipeSheet();
  else if (effect.action === "close-card-pages") closeCardPages();
  else if (effect.action === "close-exercise") closeExercise();
  else if (effect.action === "close-fan-pages") closeFanPages();
  else if (effect.action === "close-training") closeTraining();
  else if (effect.action === "end-select") endSelect();
  else if (ui.sheet === "food" && closeFoodLayer()) return;
  else closeSheet();
}
</script>

<template>
  <div v-if="!boot.ready" class="boot">
    <p class="t-body c2">Loading…</p>
  </div>
  <SignInView v-else-if="!boot.signedIn" />
  <div v-else class="app" :data-layout="layoutName" :class="{ 'is-tablet': vp.tablet && !vp.desktop, 'is-desktop': vp.desktop, 'is-wide': vp.wide, 'can-hover': vp.hover, 'has-nav': showNav, 'no-nav': !showNav, selecting: ui.selecting }">
    <SideNav v-if="showNav && vp.desktop" :inert="sheetOpen" />
    <div class="safe-top" data-safe-top aria-hidden="true"></div>
    <div class="scroller" :inert="sheetOpen">
      <RouterView />
    </div>
    <TabBar v-if="showNav && !vp.desktop && !ui.selecting" :inert="sheetOpen" />
    <SelectBar v-if="showNav && ui.selecting" :inert="sheetOpen" />
    <CopySheet />
    <GroupSheet />
    <RecipeSheet />
    <WeightSheet />
    <GoalWeightSheet />
    <RecalculateSheet />
    <AccuracySheet />
    <SettingsSheet />
    <NotificationsSheet />
    <NutrientSheet />
    <PlanSheet />
    <PlansSheet />
    <PlanWorkoutSheet />
    <WorkoutSheet />
    <!-- After the workout: its how-to opens on top. -->
    <ExercisesSheet />
    <ExerciseSheet />
    <OfflineSheet />
    <AddChooser />
    <FoodSheet />
    <!-- After every sheet: a cog inside one opens it on top. -->
    <CardPagesSheet />
    <FanPagesSheet />
    <TrainingSheet />
    <Toast />
    <!--
      iOS Safari raises the keyboard only when focus() runs in the same turn as the tap.
      Sheet fields mount after that turn, so the opener focuses this proxy first
      (primeKeyboard) and the real field takes focus when it mounts. Not display:none
      and not type=hidden, or iOS will not treat it as a text field. 16px so it
      does not zoom. See frontend/src/lib/focusField.ts.
    -->
    <input ref="kbProxy" class="kb-proxy" type="text" tabindex="-1" aria-hidden="true" autocomplete="off" />
    <div v-if="profile.offline" class="offline" role="status">
      <span class="t-body grow">Server unreachable, try again.</span>
      <button type="button" class="btn sm primary t-label" @click="retryLoad">Try again</button>
    </div>
  </div>
</template>

<style>
.app { position: relative; width: 100%; height: 100vh; height: 100dvh; overflow: hidden; background: var(--color-bg); }
.kb-proxy {
  position: absolute; left: 0; top: 0; width: 16px; height: 16px; opacity: 0;
  font-size: 16px; border: 0; padding: 0; margin: 0; pointer-events: none; caret-color: transparent;
}
.scroller { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
.safe-top {
  position: fixed; top: 0; left: 0; right: 0; z-index: 15; pointer-events: none;
  height: var(--sat);
  background-color: var(--color-bg);
  opacity: 1;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.is-desktop .safe-top { display: none; }
.app:has(.sheet-root) .scroller { overflow: hidden; }
.is-desktop.has-nav .scroller { left: 240px; }
.no-nav { --tabbar-h: 0px; }
</style>
