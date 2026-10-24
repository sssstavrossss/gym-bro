<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";
import { profile, weightCaption } from "../state/profile";
import { openAdd, openWeight } from "../ui";

const route = useRoute();
const items = [
  { to: "/today", label: "Today", icon: "sun" },
  { to: "/log", label: "Log", icon: "list" },
  { to: "/progress", label: "Progress", icon: "cal" },
  { to: "/profile", label: "Profile", icon: "user" },
];
const active = (to: string) => route.path === to || route.path.startsWith(to + "/");
const weight = computed(() => weightCaption(profile.weight));
</script>

<template>
  <aside class="side">
    <div class="brand row">
      <span class="mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M9 16h14M6 12v8M26 12v8M11 9v14M21 9v14" /></svg></span>
      <span class="t-head">Gym Bro</span>
    </div>

    <button type="button" class="add row" @click="openAdd">
      <Icon name="plus" :size="18" :sw="2.6" /><span class="t-bodys grow">Add food</span><kbd>N</kbd>
    </button>
    <button type="button" class="add2 row" @click="openWeight">
      <Icon name="scale" :size="18" /><span class="t-bodys grow">Log weight</span><kbd>W</kbd>
    </button>

    <nav class="nav col" aria-label="Main">
      <RouterLink v-for="i in items" :key="i.to" :to="i.to" class="item row" :class="{ on: active(i.to) }" :aria-current="active(i.to) ? 'page' : undefined">
        <Icon :name="i.icon" :size="20" /><span class="t-bodys">{{ i.label }}</span>
      </RouterLink>
    </nav>

    <span class="grow" />
    <div class="glance col">
      <span class="t-label c2">{{ weight.label }}</span>
      <span class="t-head">{{ weight.value }}</span>
      <span v-if="weight.note" class="t-label c2">{{ weight.note }}</span>
      <span class="t-label c2">Food logging comes later.</span>
    </div>
    <p class="keys t-label c2"><kbd>N</kbd> or <kbd>/</kbd> add food · <kbd>Q</kbd> quick add · <kbd>W</kbd> weight · <kbd>Esc</kbd> close</p>
  </aside>
</template>

<style scoped>
.side { position: absolute; top: 0; bottom: 0; left: 0; width: 240px; z-index: 20; display: flex; flex-direction: column; gap: 8px; padding: 24px 16px 20px; background: var(--color-bg); border-right: 1px solid var(--color-border); }
.brand { gap: 10px; padding: 0 8px 16px; }
.mark { width: 30px; height: 30px; border-radius: 9px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; }
.add, .add2 { height: 44px; border-radius: 22px; padding: 0 14px 0 16px; gap: 10px; text-align: left; }
.add { background: var(--color-action); color: var(--color-on-action); }
.add2 { background: var(--color-surface-2); }
kbd { font: 600 11px/1 Inter, sans-serif; padding: 3px 6px; border-radius: 5px; border: 1px solid currentColor; color: inherit; }
.nav { gap: 2px; margin-top: 16px; }
.item { height: 44px; padding: 0 12px; gap: 12px; border-radius: 12px; color: var(--text-secondary); text-decoration: none; }
.item.on { background: var(--color-surface); color: var(--text-primary); }
.glance { gap: 6px; padding: 12px; border-radius: 12px; background: var(--color-surface); }
.keys { margin: 4px 4px 0; line-height: 20px; }
</style>
