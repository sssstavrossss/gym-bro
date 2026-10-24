<script setup lang="ts">
// Desktop (≥1024 px) navigation: replaces the bottom tab bar.
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";
import { int, kg } from "../lib/format";
import { dayTotals, shown, today, trendVisible, trendWeight } from "../store";
import { openFood, openWeight } from "../ui";

const route = useRoute();
const items = [
  { to: "/today", label: "Today", icon: "sun" },
  { to: "/log", label: "Log", icon: "list" },
  { to: "/progress", label: "Progress", icon: "cal" },
  { to: "/profile", label: "Profile", icon: "user" },
];
const active = (to: string) => route.path === to || route.path.startsWith(to + "/");
</script>

<template>
  <aside class="side">
    <div class="brand row">
      <!-- app mark: icon B at small size (plate + G cut-out, barbell dropped like icons/icon-b-sm.svg) -->
      <span class="mark" aria-hidden="true"><svg width="30" height="30" viewBox="212 212 600 600"><circle cx="512" cy="512" r="290" fill="#FFFFFF" /><path d="M596.3 418.4 A126 126 0 1 0 611.3 589.6 L611.3 512 L536 512" fill="none" stroke="#0B0B0C" stroke-width="88" stroke-linejoin="miter" /></svg></span>
      <span class="t-head">Gym Bro</span>
    </div>

    <button type="button" class="add row" @click="openFood()">
      <Icon name="plus" :size="18" :sw="2.6" /><span class="t-bodys grow">Add food</span><kbd>N</kbd>
    </button>
    <button type="button" class="add2 row" @click="openWeight()">
      <Icon name="scale" :size="18" /><span class="t-bodys grow">Log weight</span><kbd>W</kbd>
    </button>

    <nav class="nav col" aria-label="Main">
      <RouterLink v-for="i in items" :key="i.to" :to="i.to" class="item row" :class="{ on: active(i.to) }" :aria-current="active(i.to) ? 'page' : undefined">
        <Icon :name="i.icon" :size="20" /><span class="t-bodys">{{ i.label }}</span>
      </RouterLink>
    </nav>

    <span class="grow" />
    <div class="glance col">
      <span class="t-cap c3">Today</span>
      <div class="row between"><span class="t-label c2">Eaten</span><span class="t-label">{{ int(dayTotals(today).kcal) }} / {{ int(shown.kcal) }}</span></div>
      <div class="row between"><span class="t-label c2">Trend</span><span class="t-label" :class="{ c3: !trendVisible }">{{ trendVisible ? `${kg(trendWeight)} kg` : "not ready" }}</span></div>
    </div>
    <span class="t-capn c3 fake">Demo data · fictional</span>
    <p class="keys t-capn c3"><kbd>N</kbd> or <kbd>/</kbd> add food · <kbd>Q</kbd> quick add · <kbd>W</kbd> weight · <kbd>Esc</kbd> close</p>
  </aside>
</template>

<style scoped>
.side { position: absolute; top: 0; bottom: 0; left: 0; width: 240px; z-index: 20; display: flex; flex-direction: column; gap: 8px; padding: 24px 16px 20px; background: var(--color-bg); border-right: 1px solid var(--color-border); }
.brand { gap: 10px; padding: 0 8px 16px; }
.mark { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; flex: none; }
.add, .add2 { height: 44px; border-radius: 22px; padding: 0 14px 0 16px; gap: 10px; text-align: left; transition: opacity .15s, background .15s; }
.add { background: var(--color-action); color: var(--color-on-action); }
.add:hover { opacity: .9; }
.add2 { background: var(--color-surface-2); }
.add2:hover { background: #303036; }
kbd { font: 600 0.6471rem/1 "Inter", sans-serif; padding: 3px 6px; border-radius: 5px; border: 1px solid currentColor; opacity: .75; }
.nav { gap: 2px; margin-top: 16px; }
.item { height: 44px; padding: 0 12px; gap: 12px; border-radius: 12px; color: var(--text-secondary); text-decoration: none; transition: background .15s, color .15s; }
.item:hover { background: var(--color-surface); color: var(--text-primary); }
.item.on { background: var(--color-surface); color: var(--text-primary); }
.glance { gap: 6px; padding: 12px; border-radius: 12px; background: var(--color-surface); }
.between { justify-content: space-between; }
.fake { padding: 0 4px; }
.keys { margin: 4px 4px 0; line-height: 20px; }
.keys kbd { font-size: 0.5882rem; padding: 2px 4px; }
</style>
