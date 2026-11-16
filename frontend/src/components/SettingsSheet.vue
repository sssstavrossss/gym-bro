<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { putSettings } from "../api";
import { signOut } from "../auth/session";
import { buildLabel } from "../lib/buildInfo";
import { applyTheme, readTheme, themes, type ThemeId } from "../lib/theme";
import { allZones, searchZones, suggestedZones, zoneLabel, zoneOffset, zoneTime } from "../lib/timeZones";
import { boot } from "../state/boot";
import { applySettings, clearAllDrafts, deviceTimeZone, profile } from "../state/profile";
import { closeSheet, ui } from "../ui";

const open = computed(() => ui.sheet === "settings");
const view = ref<"main" | "zone">("main");
const theme = ref<ThemeId>(readTheme());
const query = ref("");
const busy = ref(false);
const error = ref("");
const now = ref(new Date());
const search = ref<HTMLInputElement | null>(null);
const build = buildLabel(__BUILD_SHA__, __BUILD_TIME__);

const zone = computed(() => profile.saved?.timeZone || profile.form.timeZone || deviceTimeZone());
const follows = computed(() => profile.saved?.timeZoneFollowsDevice !== false);
const device = deviceTimeZone();
const zones = allZones();
const results = computed(() => (query.value.trim() ? searchZones(zones, query.value) : suggestedZones(zones, zone.value)));

watch(open, (value) => {
  if (!value) return;
  view.value = "main";
  query.value = "";
  error.value = "";
  theme.value = readTheme();
});

function chooseTheme(id: ThemeId) {
  theme.value = id;
  applyTheme(id);
}

function openZones() {
  now.value = new Date();
  query.value = "";
  error.value = "";
  view.value = "zone";
  void nextTick(() => search.value?.scrollIntoView({ block: "nearest" }));
}

async function save(body: { timeZone: string; timeZoneFollowsDevice: boolean }) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    applySettings(await putSettings(body));
    view.value = "main";
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "Couldn't save the time zone.";
  } finally {
    busy.value = false;
  }
}

async function onSignOut() {
  if (!boot.config) return;
  clearAllDrafts();
  await signOut(boot.config);
}
</script>

<template>
  <BottomSheet :open="open" :label="view === 'zone' ? 'Time zone' : 'Settings'" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <button v-if="view === 'zone'" type="button" class="cbtn back" aria-label="Back to settings" @click="view = 'main'"><Icon name="left" :size="18" /></button>
        <h2 class="t-head grow">{{ view === "zone" ? "Time zone" : "Settings" }}</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet">×</button>
      </div>
    </template>

    <div v-if="view === 'main'" class="col body" data-settings-sheet>
      <section class="col group" aria-labelledby="set-theme">
        <h3 id="set-theme" class="t-cap c3 m0">Appearance</h3>
        <div class="themes" role="radiogroup" aria-label="Theme">
          <button v-for="item in themes" :key="item.id" type="button" role="radio" class="theme" :aria-checked="theme === item.id" @click="chooseTheme(item.id)">
            <span class="swatch" :style="{ background: item.background }" aria-hidden="true"></span>
            <span class="t-label">{{ item.label }}</span>
          </button>
        </div>
      </section>

      <section class="col group" aria-labelledby="set-region">
        <h3 id="set-region" class="t-cap c3 m0">Region</h3>
        <button type="button" class="frow" data-zone-row @click="openZones">
          <span class="col grow">
            <span class="t-body">Time zone</span>
            <span class="t-capn c2">{{ follows ? "Follows this device" : "Set by hand" }}</span>
          </span>
          <span class="t-body c2 zval">{{ zoneLabel(zone) }}</span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
      </section>

      <section class="col group" aria-labelledby="set-account">
        <h3 id="set-account" class="t-cap c3 m0">Account</h3>
        <span v-if="boot.name" class="t-label c2 who">Signed in as {{ boot.name }}</span>
        <button type="button" class="chip t-label signout" @click="onSignOut">Sign out</button>
      </section>

      <p v-if="build" class="t-capn c3 m0 build" data-build>{{ build }}</p>
    </div>

    <div v-else class="col body" data-zone-picker>
      <button type="button" class="zrow" role="radio" :aria-checked="follows" :disabled="busy" @click="save({ timeZone: device, timeZoneFollowsDevice: true })">
        <span class="tick" aria-hidden="true"><Icon v-if="follows" name="check" :size="16" /></span>
        <span class="col grow">
          <span class="t-body">Use this device</span>
          <span class="t-capn c2">{{ zoneLabel(device) }} · now {{ zoneTime(device, now) }}</span>
        </span>
      </button>
      <input
        ref="search"
        v-model="query"
        class="zsearch t-body"
        type="search"
        inputmode="search"
        autocomplete="off"
        placeholder="Search city or zone"
        aria-label="Search time zones"
        data-no-autofocus
      />
      <div class="col zlist" role="radiogroup" aria-label="Time zones">
        <button
          v-for="item in results"
          :key="item"
          type="button"
          class="zrow"
          role="radio"
          :aria-checked="!follows && item === zone"
          :disabled="busy"
          @click="save({ timeZone: item, timeZoneFollowsDevice: false })"
        >
          <span class="tick" aria-hidden="true"><Icon v-if="!follows && item === zone" name="check" :size="16" /></span>
          <span class="t-body grow zname">{{ zoneLabel(item) }}</span>
          <span class="t-capn c2 zoff">{{ zoneOffset(item, now) }}</span>
        </button>
        <p v-if="!results.length" class="t-body c2 m0">No zone matches “{{ query }}”.</p>
      </div>
      <p v-if="error" class="t-body m0" role="alert">{{ error }}</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; align-items: center; }
.back { margin-left: -10px; }
.m0 { margin: 0; overflow-wrap: anywhere; }
.body { gap: 20px; }
.group { gap: 8px; min-width: 0; }
.themes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-gap); }
.theme {
  min-height: var(--control-hit); min-width: 0; width: 100%;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 var(--space-gap); border-radius: 12px; background: var(--color-surface-2); color: var(--text-primary); text-align: left;
}
.theme[aria-checked="true"] { box-shadow: inset 0 0 0 1.5px var(--text-primary); }
.swatch { width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px var(--color-border-strong); flex: none; }
:global(html.dt-xl) .themes { grid-template-columns: 1fr; }
.frow { min-height: 52px; width: 100%; display: flex; align-items: center; gap: 8px; text-align: left; padding: 0; min-width: 0; }
.frow .grow { min-width: 0; gap: 2px; }
.zval { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
.fchev { color: var(--text-tertiary); flex: none; }
.who { overflow-wrap: anywhere; }
.signout { align-self: flex-start; }
.build { text-align: center; }
.body[data-zone-picker] { gap: var(--space-gap); }
.zsearch {
  width: 100%; min-height: var(--control-hit); padding: 0 var(--space-gap);
  border-radius: 12px; border: 0; background: var(--color-surface-2); color: var(--text-primary);
  font-size: 16px;
}
.zlist { gap: 0; }
.zrow { width: 100%; min-height: var(--control-hit); display: flex; align-items: center; gap: 8px; text-align: left; padding: 6px 0; border-bottom: 1px solid var(--color-border); min-width: 0; }
.zlist .zrow:last-of-type { border-bottom: 0; }
.zrow .grow { min-width: 0; gap: 2px; }
.tick { width: 18px; flex: none; display: grid; place-items: center; color: var(--text-primary); }
.zname { overflow-wrap: anywhere; }
.zoff { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
:global(html.dt-l) .frow { flex-wrap: wrap; }
:global(html.dt-l) .zval { max-width: 100%; }
</style>
