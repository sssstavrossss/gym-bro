<script setup lang="ts">
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";
import { openAdd } from "../ui";

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
      <button v-if="t.label === '+'" type="button" class="plus" aria-label="Add" @click="openAdd">
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
.tab { min-width: 64px; min-height: 44px; padding-top: 4px; display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text-secondary); text-decoration: none; }
/* Tab captions stay at the default size. Dynamic Type must not enlarge them into each other. */
.tab .t-capn { font-size: 11px; line-height: 14px; white-space: nowrap; }
.tab.on { color: var(--text-primary); }
.plus { width: 56px; height: 56px; border-radius: 28px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; }
</style>
