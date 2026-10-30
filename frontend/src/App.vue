<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AddChooser from "./components/AddChooser.vue";
import FoodSheet from "./components/FoodSheet.vue";
import SideNav from "./components/SideNav.vue";
import TabBar from "./components/TabBar.vue";
import Toast from "./components/Toast.vue";
import AccuracySheet from "./components/AccuracySheet.vue";
import WeightSheet from "./components/WeightSheet.vue";
import { e2eSession } from "./auth/e2e";
import { isConfigured, loadPublicConfig } from "./auth/publicConfig";
import { currentAccount } from "./auth/session";
import { vp } from "./lib/viewport";
import { boot } from "./state/boot";
import { loadProfile, profile, retryLoad } from "./state/profile";
import { loadToday, log } from "./state/log";
import { closeSheet, openAdd, openFood, openWeight, ui } from "./ui";
import SignInView from "./views/SignInView.vue";

const route = useRoute();
const router = useRouter();
const showNav = computed(() => profile.hasSaved && route.path !== "/setup");

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
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  const typing = target?.closest("input, textarea, select, [contenteditable='true']") != null;
  if (event.key === "Escape") {
    if (!ui.sheet) return;
    event.preventDefault();
    closeSheet();
    return;
  }
  if (typing || ui.sheet || !showNav.value) return;
  const key = event.key.toLowerCase();
  if (key === "n" || key === "/") {
    event.preventDefault();
    openFood();
  } else if (key === "q") {
    event.preventDefault();
    openFood("quick");
  } else if (key === "w") {
    event.preventDefault();
    openWeight();
  }
}
</script>

<template>
  <div v-if="!boot.ready" class="boot">
    <p class="t-body c2">Loading…</p>
  </div>
  <SignInView v-else-if="!boot.signedIn" />
  <div v-else class="app" :class="{ 'is-tablet': vp.tablet && !vp.desktop, 'is-desktop': vp.desktop, 'is-wide': vp.wide, 'can-hover': vp.hover, 'has-nav': showNav, 'no-nav': !showNav }">
    <SideNav v-if="showNav && vp.desktop" />
    <div class="scroller">
      <RouterView />
    </div>
    <TabBar v-if="showNav && !vp.desktop" />
    <WeightSheet />
    <AccuracySheet />
    <AddChooser />
    <FoodSheet />
    <Toast />
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
.scroller { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; }
.is-desktop.has-nav .scroller { left: 240px; }
.no-nav { --tabbar-h: 0px; }
</style>
