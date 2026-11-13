<script setup lang="ts">
import { ref } from "vue";
import Icon from "./Icon.vue";
import { bindPick, clickPick } from "../lib/cleanTap";
import { int } from "../lib/format";
import { groupItemLine } from "../lib/groups";
import { keyboardEntry } from "../lib/viewport";
import type { SavedGroup } from "../api";

defineProps<{
  groups: SavedGroup[];
  note: string;
  saving: boolean;
  needTime: boolean;
  addedId: string | null;
}>();
const emit = defineEmits<{ add: [group: SavedGroup]; remove: [group: SavedGroup] }>();
const openId = ref<string | null>(null);

function toggle(id: string) {
  openId.value = openId.value === id ? null : id;
}
function pressToggle(event: PointerEvent, id: string) {
  bindPick(event, () => toggle(id));
}
function onToggle(event: MouseEvent, id: string) {
  clickPick(event, () => toggle(id));
}
function pressAdd(event: PointerEvent, group: SavedGroup) {
  bindPick(event, () => emit("add", group));
}
function onAdd(event: MouseEvent, group: SavedGroup) {
  clickPick(event, () => emit("add", group));
}
</script>

<template>
  <div v-if="groups.length" class="groups col">
    <div class="row lhead">
      <span class="t-cap c3">Saved groups</span>
      <span class="grow" />
      <span class="t-capn c3">+ adds every item {{ note }}</span>
    </div>
    <div v-for="group in groups" :key="group.id" class="grow-row col">
      <div class="rrow row grp">
        <span class="gic" aria-hidden="true"><Icon name="layers" :size="16" /></span>
        <button type="button" class="col grow rtext" :aria-expanded="openId === group.id" @pointerdown="pressToggle($event, group.id)" @click="onToggle($event, group.id)">
          <span class="t-body ell">{{ group.name }}</span>
          <span class="t-label c2 gsum">
            <span class="gnum">{{ group.items.length }} items · {{ int(group.kcal) }} kcal</span>
            <span class="ell gnames"> · {{ group.items.map((item) => item.name.split(",")[0]).join(", ") }}</span>
          </span>
        </button>
        <button type="button" class="ibtn" :aria-label="`Delete group ${group.name}`" :disabled="saving" @click="emit('remove', group)">
          <Icon name="trash" :size="16" />
        </button>
        <button
          v-if="!keyboardEntry"
          type="button"
          class="ibtn"
          :aria-label="openId === group.id ? `Hide items in ${group.name}` : `Show items in ${group.name}`"
          :aria-expanded="openId === group.id"
          @pointerdown="pressToggle($event, group.id)"
          @click="onToggle($event, group.id)"
        >
          <Icon name="down" :size="16" :class="{ flip: openId === group.id }" />
        </button>
        <button
          type="button"
          class="cbtn filled"
          :aria-label="needTime ? `Pick a time to add group ${group.name}` : `Add group ${group.name}`"
          :disabled="saving || needTime"
          @pointerdown="pressAdd($event, group)"
          @click="onAdd($event, group)"
        >
          <Icon :name="addedId === group.id ? 'check' : 'plus'" :size="18" :sw="2.4" />
        </button>
      </div>
      <div v-if="openId === group.id" class="gitems col">
        <div v-for="item in group.items" :key="item.id" class="row gi">
          <span class="t-label grow ell">{{ item.name }}<template v-if="!item.available"> · won't be added</template></span>
          <span class="t-label c2">{{ groupItemLine(item) }}</span>
        </div>
        <button type="button" class="t-label gdel" :disabled="saving" @click="emit('remove', group)">
          <Icon name="trash" :size="14" /> Delete group
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.groups { gap: 0; }
.lhead { padding: 10px 0 2px; }
.grp { gap: 4px; }
.gic { width: 32px; height: 32px; border-radius: 10px; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); flex: none; }
.rtext { gap: 2px; min-width: 0; min-height: 44px; align-items: flex-start; justify-content: center; text-align: left; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.gsum { display: flex; min-width: 0; width: 100%; max-width: 100%; overflow: hidden; }
.gnum { flex: none; white-space: nowrap; }
.gnames { min-width: 0; }
.ibtn {
  position: relative; width: var(--control-hit); height: var(--control-hit);
  display: inline-flex; align-items: center; justify-content: center; color: var(--text-secondary); flex: none; background: transparent; isolation: isolate;
}
.ibtn::before {
  content: ""; position: absolute; z-index: -1; width: var(--control-s); height: var(--control-s); border-radius: 10px;
}
.ibtn > * { position: relative; }
.ibtn:hover::before { background: var(--color-surface-2); }
.ibtn:disabled { opacity: .35; }
.flip { transform: rotate(180deg); }
.gitems { padding: 4px 0 8px 42px; gap: 6px; border-bottom: 1px solid var(--color-border); }
.gi { gap: 8px; min-height: 32px; }
.gdel { align-self: flex-start; min-height: 44px; padding: 8px 0; display: inline-flex; align-items: center; gap: 6px; text-decoration: underline; text-underline-offset: 3px; }
</style>
