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
import AccuracySheet from "./components/AccuracySheet.vue";
import RecalculateSheet from "./components/RecalculateSheet.vue";
import WeightSheet from "./components/WeightSheet.vue";
import { e2eSession } from "./auth/e2e";
import { isConfigured, loadPublicConfig } from "./auth/publicConfig";
import { currentAccount } from "./auth/session";
import { bindFocusProxy } from "./lib/focusField";
import { isTypingTarget, screenLayoutFromFlags, shortcutEffect } from "./lib/layout";
import { vp } from "./lib/viewport";
import { boot } from "./state/boot";
import { loadProfile, profile, retryLoad } from "./state/profile";
import { loadToday, log, viewed } from "./state/log";
import { closeCopy, closeFoodLayer, closeGroupSheet, closeRecipeSheet, closeSheet, endSelect, openFood, openWeight, ui } from "./ui";
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
    await loadProfile();
    if (profile.hasSaved) await loadToday();
  }
  boot.ready = true;
});

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
    <div class="scroller" :inert="sheetOpen">
      <RouterView />
    </div>
    <TabBar v-if="showNav && !vp.desktop && !ui.selecting" :inert="sheetOpen" />
    <SelectBar v-if="showNav && ui.selecting" :inert="sheetOpen" />
    <CopySheet />
    <GroupSheet />
    <RecipeSheet />
    <WeightSheet />
    <RecalculateSheet />
    <AccuracySheet />
    <AddChooser />
    <FoodSheet />
    <Toast />
    <!--
      iOS Safari raises the keyboard only when focus() runs in the same turn as the tap.
      Sheet fields mount after that turn, so the opener focuses this proxy first
      (primeKeyboard) and the real field takes focus when it mounts. Not display:none
      and not type=hidden, or iOS will not treat it as a text field. 16px so it
      does not zoom. See frontend/src/lib/focusField.ts.
    -->
    <input ref="kbProxy" class="kb-proxy" type="text" tabindex="-1" aria-hidden="true" autocomplete="off" />
    <div v-if="log.unreachable" class="offline" role="status">
      <span class="t-body grow">server unreachable, try again</span>
    </div>
    <div v-if="profile.offline" class="offline" role="status">
      <span class="t-body grow">Server unreachable, try again.</span>
      <button type="button" class="t-bodys" @click="retryLoad">Try again</button>
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
.app:has(.sheet-root) .scroller { overflow: hidden; }
.is-desktop.has-nav .scroller { left: 240px; }
.no-nav { --tabbar-h: 0px; }
.app.selecting { --tabbar-h: calc(128px + max(var(--sab), 12px)); }
.app.selecting.is-desktop .screen { padding-bottom: 160px; }
</style>
