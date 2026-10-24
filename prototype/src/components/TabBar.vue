<script setup lang="ts">
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";
import { openChooser, ui } from "../ui";
const route = useRoute();
const tabs = [
  { to: "/today", label: "Today", icon: "sun" },
  { to: "/log", label: "Log", icon: "list" },
  { to: "", label: "+", icon: "plus" },
  { to: "/progress", label: "Progress", icon: "cal" },
  { to: "/profile", label: "Profile", icon: "user" },
];
const active = (to: string) => route.path === to || route.path.startsWith(to + "/");
</script>

<template>
  <nav class="tabbar" aria-label="Main">
    <template v-for="t in tabs" :key="t.label">
      <button v-if="t.label === '+'" type="button" class="plus" :class="{ hidden: ui.sheet === 'chooser' }" aria-label="Add" @click="openChooser">
        <Icon name="plus" :size="26" :sw="2.4" />
      </button>
      <RouterLink v-else :to="t.to" class="tab" :class="{ on: active(t.to) }" :aria-current="active(t.to) ? 'page' : undefined">
        <Icon :name="t.icon" :size="24" />
        <span class="t-capn">{{ t.label }}</span>
      </RouterLink>
    </template>
  </nav>
</template>

<style scoped>
.tabbar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 20;
  height: var(--tabbar-h); padding: 8px max(12px, calc(50% - 260px)) 0;
  display: flex; justify-content: space-between; align-items: flex-start;
  background: var(--color-bg); border-top: 1px solid var(--color-border);
}
.tab .t-capn { font-size: min(0.6471rem, 14px); line-height: 1.2; }
.tab { width: 64px; padding-top: 4px; display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text-tertiary); text-decoration: none; transition: color .15s; }
.tab.on { color: var(--text-primary); }
.plus { width: 56px; height: 56px; border-radius: 28px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,.5); transition: transform .15s; }
.plus:active { transform: scale(.94); }
.plus.hidden { visibility: hidden; }
</style>
