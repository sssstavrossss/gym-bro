<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Bar from "./Bar.vue";
import BottomSheet from "./BottomSheet.vue";
import Segmented from "./Segmented.vue";
import Icon from "./Icon.vue";
import { ApiError, getExport, putSettings } from "../api";
import { signOut } from "../auth/session";
import { buildLabel } from "../lib/buildInfo";
import { saveBlob } from "../lib/download";
import { accents, applyAccent, applyTheme, readAccent, readTheme, themes, type AccentId, type ThemeId } from "../lib/theme";
import { allZones, searchZones, suggestedZones, zoneLabel, zoneOffset, zoneTime } from "../lib/timeZones";
import { forgetAnswers } from "../offline/cache";
import { boot } from "../state/boot";
import type { FoodUnit } from "../lib/foodUnits";
import type { HeightUnit, WeightUnit } from "../lib/units";
import { applySettings, clearAllDrafts, deviceTimeZone, profile, setFoodUnit, setUnits } from "../state/profile";
import { foodUnit } from "../state/units";
import { closeSheet, ui } from "../ui";

const open = computed(() => ui.sheet === "settings");
const view = ref<"main" | "zone">("main");
const theme = ref<ThemeId>(readTheme());
const accent = ref<AccentId>(readAccent());
const themeLabel = computed(() => themes.find((item) => item.id === theme.value)?.label ?? "");
const accentLabel = computed(() => accents.find((item) => item.id === accent.value)?.label ?? "");
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
  unitsError.value = "";
  exportError.value = "";
  theme.value = readTheme();
  accent.value = readAccent();
});

function chooseTheme(id: ThemeId) {
  theme.value = id;
  applyTheme(id);
}

function chooseAccent(id: AccentId) {
  accent.value = id;
  applyAccent(id);
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

const unitsError = ref("");
async function chooseWeight(unit: WeightUnit) {
  unitsError.value = await setUnits(unit, profile.form.heightUnit);
}
async function chooseHeight(unit: HeightUnit) {
  unitsError.value = await setUnits(profile.form.weightUnit, unit);
}
async function chooseFood(unit: FoodUnit) {
  unitsError.value = await setFoodUnit(unit);
}

const exporting = ref(false);
const exportError = ref("");
async function onExport() {
  if (exporting.value) return;
  exporting.value = true;
  exportError.value = "";
  try {
    const file = await getExport();
    saveBlob(file.blob, file.name);
  } catch (failure) {
    exportError.value = failure instanceof ApiError ? failure.message : "Couldn't export. Check your connection and try again.";
  } finally {
    exporting.value = false;
  }
}

async function onSignOut() {
  if (!boot.config) return;
  clearAllDrafts();
  // What was kept for offline goes. Anything still waiting to send stays for the next sign-in.
  await forgetAnswers(boot.accountId);
  await signOut(boot.config);
}
</script>

<template>
  <BottomSheet :open="open" :label="view === 'zone' ? 'Time zone' : 'Settings'" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <button v-if="view === 'zone'" type="button" class="cbtn back" aria-label="Back to settings" @click="view = 'main'"><Icon name="left" :size="18" /></button>
        <h2 class="t-head grow">{{ view === "zone" ? "Time zone" : "Settings" }}</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>

    <div v-if="view === 'main'" class="col body" data-settings-sheet>
      <section class="col group" aria-labelledby="set-theme">
        <h3 id="set-theme" class="t-bodys gtitle"><Icon name="sun" :size="16" /> Appearance</h3>
        <!-- Each circle carries its palette's data-theme or data-accent, so main.css paints it. -->
        <div class="frow look">
          <span class="col grow"><span class="t-body">Theme</span><span class="t-capn c2" data-theme-name>{{ themeLabel }}</span></span>
          <div class="dots" role="radiogroup" aria-label="Theme">
            <button v-for="item in themes" :key="item.id" type="button" role="radio" class="dot" :aria-label="item.label" :aria-checked="theme === item.id" @click="chooseTheme(item.id)">
              <span class="ring" aria-hidden="true"><span class="face theme" :data-theme="item.id"></span></span>
            </button>
          </div>
        </div>
        <div class="frow look">
          <span class="col grow"><span class="t-body">Accent</span><span class="t-capn c2" data-accent-name>{{ accentLabel }}</span></span>
          <div class="dots" role="radiogroup" aria-label="Accent">
            <button v-for="item in accents" :key="item.id" type="button" role="radio" class="dot" :aria-label="item.label" :aria-checked="accent === item.id" @click="chooseAccent(item.id)">
              <span class="ring" aria-hidden="true"><span class="face accent" :data-accent="item.id"></span></span>
            </button>
          </div>
        </div>
        <!-- What the accent paints, since the sheet covers the app: filling, on target, over, a button. -->
        <div class="frow preview" aria-hidden="true" data-accent-preview>
          <span class="t-capn c2 plabel">Preview</span>
          <span class="col grow pbars"><Bar :pct="0.62" /><Bar :pct="1" hit /><Bar :pct="1" over /></span>
          <span class="btn primary sm padd">Add</span>
        </div>
      </section>

      <section class="col group" aria-labelledby="set-units" data-units>
        <h3 id="set-units" class="t-bodys gtitle"><Icon name="scale" :size="16" /> Units</h3>
        <div class="frow">
          <span class="t-body grow">Weight</span>
          <Segmented size="compact" label="Weight unit" :model-value="profile.form.weightUnit" :options="[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]" @update:model-value="chooseWeight" />
        </div>
        <div class="frow">
          <span class="t-body grow">Height</span>
          <Segmented size="compact" label="Height unit" :model-value="profile.form.heightUnit" :options="[{ value: 'cm', label: 'cm' }, { value: 'ftin', label: 'ft·in', ariaLabel: 'feet and inches' }]" @update:model-value="chooseHeight" />
        </div>
        <div class="frow">
          <span class="t-body grow">Food</span>
          <Segmented size="compact" label="Food unit" :model-value="foodUnit()" :options="[{ value: 'g', label: 'g' }, { value: 'oz', label: 'oz', ariaLabel: 'ounces' }]" @update:model-value="chooseFood" />
        </div>
        <span class="t-capn c2 gnote" data-food-note>Protein, fat, carbs and nutrients stay in grams.</span>
        <p v-if="unitsError" class="t-body m0" role="alert">{{ unitsError }}</p>
      </section>

      <section class="col group" aria-labelledby="set-region">
        <h3 id="set-region" class="t-bodys gtitle"><Icon name="clock" :size="16" /> Region</h3>
        <button type="button" class="frow" data-zone-row @click="openZones">
          <span class="col grow">
            <span class="t-body">Time zone</span>
            <span class="t-capn c2">{{ follows ? "Follows this device" : "Set by hand" }}</span>
          </span>
          <span class="t-body c2 zval">{{ zoneLabel(zone) }}</span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
      </section>

      <section class="col group" aria-labelledby="set-data" data-export>
        <h3 id="set-data" class="t-bodys gtitle"><Icon name="download" :size="16" /> Your data</h3>
        <div class="frow">
          <span class="col grow">
            <span class="t-body">Export your data</span>
            <span class="t-capn c2">Log, weigh-ins, targets, foods and recipes</span>
          </span>
          <button type="button" class="btn sm secondary t-label" :disabled="exporting" @click="onExport">
            <Icon name="download" :size="14" /> {{ exporting ? "Exporting…" : "Export" }}
          </button>
        </div>
        <p v-if="exportError" class="t-body m0" role="alert">{{ exportError }}</p>
      </section>

      <section class="col group" aria-labelledby="set-account">
        <h3 id="set-account" class="t-bodys gtitle"><Icon name="user" :size="16" /> Account</h3>
        <div class="frow">
          <span class="col grow">
            <span class="t-body who">{{ boot.name || "Signed in" }}</span>
            <span v-if="boot.name" class="t-capn c2">Signed in</span>
          </span>
          <button type="button" class="btn sm secondary t-label signout" @click="onSignOut"><Icon name="logout" :size="14" /> Sign out</button>
        </div>
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
        class="field zsearch t-body"
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
.hdr { gap: var(--space-s); align-items: center; }
.back { margin-left: -10px; }
.m0 { margin: 0; overflow-wrap: anywhere; }
.body { gap: var(--space-m); }
/* Each group is a card: an icon title, then rows split by a line. Controls in it sit on the
   sheet colour (--btn-bg) so they still stand out from the card. */
.group { min-width: 0; gap: 0; padding: 14px var(--space-l) var(--space-2xs); border-radius: var(--radius-l); background: var(--color-surface-2); --btn-bg: var(--color-surface); }
.gtitle { margin: 0; padding-bottom: 6px; display: flex; align-items: center; gap: var(--space-s); }
.gtitle svg { color: var(--text-secondary); flex: none; }
.group > :not(.gtitle) + :not(.gtitle) { border-top: 1px solid var(--color-border); }
.gnote { padding: var(--space-s) 0 var(--space-m); }
.group > p[role="alert"] { padding: var(--space-s) 0 var(--space-m); }
/* Theme and accent: a name on the left, six 28px circles in 44px hit boxes on the right. A long
   name wraps onto two lines; with large text the circles move under the name. */
.look { min-height: 56px; padding: var(--space-xs) 0; column-gap: 0; }
:global(html.dt-l) .look { flex-wrap: wrap; }
.look .grow { gap: var(--space-2xs); }
.dots { display: flex; margin: 0 calc(var(--space-s) * -1) 0 auto; }
.dot { width: var(--control-hit); height: var(--control-hit); display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 50%; }
.ring { width: 28px; height: 28px; border-radius: 50%; display: block; }
.dot[aria-checked="true"] .ring { box-shadow: 0 0 0 2px var(--color-surface-2), 0 0 0 4px var(--text-primary); }
.face { width: 100%; height: 100%; border-radius: 50%; display: block; box-shadow: inset 0 0 0 1px var(--color-border-strong); }
.face.theme { background: linear-gradient(135deg, var(--color-surface-2) 0 50%, var(--color-bg) 50% 100%); }
.face.accent { background: conic-gradient(var(--accent-main) 0 50%, var(--accent-fill) 50% 75%, var(--accent-over) 75% 100%); }
.preview { gap: var(--space-m); padding: var(--space-s) 0 var(--space-m); }
.plabel { width: 52px; flex: none; }
.pbars { gap: var(--space-s); }
.padd { pointer-events: none; }
.frow { min-height: 52px; width: 100%; display: flex; align-items: center; gap: var(--space-s); text-align: left; padding: 0; min-width: 0; }
.frow .grow { min-width: 0; gap: var(--space-2xs); }
.zval { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
.fchev { color: var(--text-tertiary); flex: none; }
.who { overflow-wrap: anywhere; }
.signout { flex: none; }
.build { text-align: center; }
.body[data-zone-picker] { gap: var(--space-m); }
.zsearch { width: 100%; font-size: 16px; }
.zlist { gap: 0; }
.zrow { width: 100%; min-height: var(--control-hit); display: flex; align-items: center; gap: var(--space-s); text-align: left; padding: var(--space-s) 0; border-bottom: 1px solid var(--color-border); min-width: 0; }
.zlist .zrow:last-of-type { border-bottom: 0; }
.zrow .grow { min-width: 0; gap: var(--space-2xs); }
.tick { width: 18px; flex: none; display: grid; place-items: center; color: var(--text-primary); }
.zname { overflow-wrap: anywhere; }
.zoff { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
:global(html.dt-l) .frow { flex-wrap: wrap; }
:global(html.dt-l) .zval { max-width: 100%; }
</style>
