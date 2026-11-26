<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Bar from "./Bar.vue";
import BottomSheet from "./BottomSheet.vue";
import Segmented from "./Segmented.vue";
import Icon from "./Icon.vue";
import SwitchRow from "./SwitchRow.vue";
import { ApiError, getExport, getResetSummary, putSettings, resetNutrition, resetTraining, type SettingsBody } from "../api";
import { signOut } from "../auth/session";
import { buildLabel } from "../lib/buildInfo";
import { allCountries, countryName, countryTables, searchCountries } from "../lib/foodCountries";
import { saveBlob } from "../lib/download";
import { accents, applyAccent, applyTheme, readAccent, readTheme, themes, type AccentId, type ThemeId } from "../lib/theme";
import { sectionRows, sectionsSummary, WEEK_ROW } from "../lib/homeSections";
import { screenLayoutFromFlags } from "../lib/layout";
import { vp } from "../lib/viewport";
import { allZones, searchZones, suggestedZones, zoneLabel, zoneOffset, zoneTime } from "../lib/timeZones";
import { confirmLine, doneLine, hasNutrition, hasTraining, logLine, ownLine, RESET_FLASH_KEY, trainingLine, type ResetKind, type ResetSummary } from "../lib/reset";
import { forgetAnswers } from "../offline/cache";
import { boot } from "../state/boot";
import { connection } from "../state/connection";
import { homeSections, sectionShown, setSectionShown } from "../state/homeSections";
import type { FoodUnit } from "../lib/foodUnits";
import type { HeightUnit, WeightUnit } from "../lib/units";
import { applySettings, clearAllDrafts, deviceTimeZone, foodCountry, profile, setFoodUnit, setUnits } from "../state/profile";
import { foodUnit } from "../state/units";
import { usingLine } from "../lib/training";
import { training } from "../state/training";
import { closeSheet, openFanPages, openTraining, ui } from "../ui";
import { fanSummary as summarizeFan } from "../lib/fanPages";
import { fanLayout } from "../state/fanPages";
import { setOps } from "../state/outbox";
import { forgetWorkouts } from "../state/workout";

const open = computed(() => ui.sheet === "settings");
const view = ref<"main" | "zone" | "home" | "country" | "reset">("main");
const titles = { main: "Settings", zone: "Time zone", home: "Home sections", country: "Food country", reset: "Reset data" } as const;
const theme = ref<ThemeId>(readTheme());
const accent = ref<AccentId>(readAccent());
const themeLabel = computed(() => themes.find((item) => item.id === theme.value)?.label ?? "");
const accentLabel = computed(() => accents.find((item) => item.id === accent.value)?.label ?? "");
const query = ref("");
const busy = ref(false);
const error = ref("");
const now = ref(new Date());
const search = ref<HTMLInputElement | null>(null);
const followRow = ref<HTMLButtonElement | null>(null);
const build = buildLabel(__BUILD_SHA__, __BUILD_TIME__);

const zone = computed(() => profile.saved?.timeZone || profile.form.timeZone || deviceTimeZone());
const follows = computed(() => profile.saved?.timeZoneFollowsDevice !== false);
const device = deviceTimeZone();
const zones = allZones();
const results = computed(() => (query.value.trim() ? searchZones(zones, query.value) : suggestedZones(zones, zone.value)));
const country = computed(() => foodCountry());
const countryFollows = computed(() => profile.saved?.foodCountryFollowsZone !== false);
const countries = allCountries();
const countryResults = computed(() => searchCountries(countries, query.value));
const summary = computed(() => sectionsSummary(homeSections.hidden));
const fanSummary = computed(() => summarizeFan(fanLayout.value));
const sections = computed(() => sectionRows(screenLayoutFromFlags({ tablet: vp.tablet, desktop: vp.desktop, wide: vp.wide })));

watch(open, (value) => {
  if (!value) return;
  view.value = ui.settingsView;
  query.value = "";
  error.value = "";
  unitsError.value = "";
  exportError.value = "";
  resetConfirm.value = null;
  alsoFoods.value = false;
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

function openPicker(next: "zone" | "country") {
  now.value = new Date();
  query.value = "";
  error.value = "";
  view.value = next;
  // The zone list opens at its search. The country list opens at its top, where "Use the time zone" is.
  void nextTick(() => (next === "zone" ? search.value : followRow.value)?.scrollIntoView({ block: "nearest" }));
}

/** Saves a time zone or food country pick and goes back to the list. */
async function save(body: SettingsBody) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    applySettings(await putSettings(body));
    view.value = "main";
  } catch (failure) {
    const what = view.value === "country" ? "food country" : "time zone";
    error.value = failure instanceof Error ? failure.message : `Couldn't save the ${what}.`;
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

// Settings → Reset data (README → Reset data). The counts load each time the view opens.
const resetSummary = ref<ResetSummary | null>(null);
const resetState = ref<"idle" | "loading" | "failed">("idle");
const resetConfirm = ref<ResetKind | null>(null);
const alsoFoods = ref(false);
const resetting = ref(false);
const resetError = ref("");

watch([open, view], ([isOpen, current]) => {
  if (isOpen && current === "reset") void loadReset();
}, { immediate: true });

async function loadReset() {
  resetConfirm.value = null;
  resetError.value = "";
  if (!resetSummary.value) resetState.value = "loading";
  try {
    resetSummary.value = await getResetSummary();
    resetState.value = "idle";
  } catch {
    if (!resetSummary.value) resetState.value = "failed";
  }
}

const canResetTraining = computed(() => !!resetSummary.value && hasTraining(resetSummary.value.training) && !connection.offline);
const canResetNutrition = computed(() => !!resetSummary.value && hasNutrition(resetSummary.value.nutrition, alsoFoods.value) && !connection.offline);

/** Deletes on the server, forgets what this phone holds of it, and starts the app again with a toast. */
async function onReset(kind: ResetKind) {
  if (resetting.value) return;
  resetting.value = true;
  resetError.value = "";
  try {
    let done: string;
    if (kind === "training") {
      done = doneLine(kind, await resetTraining());
      forgetWorkouts();
    } else {
      done = doneLine(kind, await resetNutrition(alsoFoods.value));
      setOps([]);
    }
    await forgetAnswers(boot.accountId);
    try {
      sessionStorage.setItem(RESET_FLASH_KEY, done);
    } catch {
      // No toast after the reload, that's all.
    }
    location.reload();
  } catch (failure) {
    resetError.value = failure instanceof ApiError ? failure.message : "Couldn't reset. Check your connection and try again.";
    resetting.value = false;
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
  <BottomSheet :open="open" :label="titles[view]" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <button v-if="view !== 'main'" type="button" class="cbtn back" aria-label="Back to settings" @click="view = 'main'"><Icon name="left" :size="18" /></button>
        <h2 class="t-head grow">{{ titles[view] }}</h2>
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

      <section class="col group" aria-labelledby="set-home">
        <h3 id="set-home" class="t-bodys gtitle"><Icon name="layers" :size="16" /> Home</h3>
        <button type="button" class="frow" data-home-row @click="view = 'home'">
          <span class="col grow">
            <span class="t-body">Home sections</span>
            <span class="t-capn c2 hnames">{{ summary.names }}</span>
          </span>
          <span class="t-body c2 hcount">{{ summary.count }}</span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
        <button type="button" class="frow" data-fan-settings @click="openFanPages">
          <span class="col grow">
            <span class="t-body">+ button</span>
            <span class="t-capn c2 hnames">{{ fanSummary }}</span>
          </span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
      </section>

      <section class="col group" aria-labelledby="set-training">
        <h3 id="set-training" class="t-bodys gtitle"><Icon name="dumbbell" :size="16" /> Training</h3>
        <button type="button" class="frow" data-training-row @click="openTraining">
          <span class="col grow">
            <span class="t-body">Your training</span>
            <span class="t-capn c2 hnames" data-training-line>{{ usingLine(training) }}</span>
          </span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
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
        <button type="button" class="frow" data-zone-row @click="openPicker('zone')">
          <span class="col grow">
            <span class="t-body">Time zone</span>
            <span class="t-capn c2">{{ follows ? "Follows this device" : "Set by hand" }}</span>
          </span>
          <span class="t-body c2 zval">{{ zoneLabel(zone) }}</span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
        <button type="button" class="frow" data-country-row @click="openPicker('country')">
          <span class="col grow">
            <span class="t-body">Food country</span>
            <span class="t-capn c2">{{ countryFollows ? "Follows the time zone" : "Set by hand" }}</span>
          </span>
          <span class="t-body c2 zval">{{ countryName(country) }}</span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
        <span class="t-capn c2 gnote" data-country-note>Foods from your country come first in search and Describe.</span>
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
        <button type="button" class="frow" data-reset-row @click="view = 'reset'">
          <span class="col grow">
            <span class="t-body">Reset data</span>
            <span class="t-capn c2">Start training or nutrition over</span>
          </span>
          <Icon name="right" :size="16" class="fchev" />
        </button>
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

    <div v-else-if="view === 'reset'" class="col body" data-reset>
      <p v-if="resetState === 'loading'" class="t-body c2 m0">Loading…</p>
      <p v-else-if="resetState === 'failed'" class="t-body c2 m0" role="alert">Couldn't load your data. Check your connection and try again.</p>
      <template v-else-if="resetSummary">
        <p v-if="connection.offline" class="t-body c2 m0" data-reset-offline>Resetting needs a connection.</p>
        <p v-if="resetError" class="t-body m0" role="alert">{{ resetError }}</p>

        <section class="col group" aria-labelledby="reset-training" data-reset-training>
          <h3 id="reset-training" class="t-bodys gtitle"><Icon name="dumbbell" :size="16" /> Training</h3>
          <div class="frow">
            <span class="col grow">
              <span class="t-body">Workouts and plan</span>
              <span class="t-capn c2" data-reset-count>{{ trainingLine(resetSummary.training) }}</span>
            </span>
            <button type="button" class="btn sm secondary t-label rbtn" :disabled="!canResetTraining || resetting" :aria-expanded="resetConfirm === 'training'" data-reset-open @click="resetConfirm = 'training'">
              <Icon name="trash" :size="14" /> Reset
            </button>
          </div>
          <div v-if="resetConfirm === 'training'" class="rconfirm" role="alertdialog" aria-labelledby="rt-h" aria-describedby="rt-d">
            <h4 id="rt-h" class="t-bodys m0">Reset training?</h4>
            <p id="rt-d" class="t-label c2 m0">{{ confirmLine("training", resetSummary) }}</p>
            <div class="row cbtns">
              <button type="button" class="btn sm secondary t-label" :disabled="!canResetTraining || resetting" data-reset-go @click="onReset('training')">
                {{ resetting ? "Resetting…" : "Reset training" }}
              </button>
              <button type="button" class="btn sm primary t-label" :disabled="resetting" @click="resetConfirm = null">Keep</button>
            </div>
          </div>
          <span class="t-capn c2 gnote">Strength, new bests and This week start from nothing.</span>
        </section>

        <section class="col group" aria-labelledby="reset-nutrition" data-reset-nutrition>
          <h3 id="reset-nutrition" class="t-bodys gtitle"><Icon name="food" :size="16" /> Nutrition</h3>
          <div class="frow">
            <span class="col grow">
              <span class="t-body">Food log</span>
              <span class="t-capn c2" data-reset-count>{{ logLine(resetSummary.nutrition) }}</span>
            </span>
            <button type="button" class="btn sm secondary t-label rbtn" :disabled="!canResetNutrition || resetting" :aria-expanded="resetConfirm === 'nutrition'" data-reset-open @click="resetConfirm = 'nutrition'">
              <Icon name="trash" :size="14" /> Reset
            </button>
          </div>
          <SwitchRow title="Also my foods, recipes and groups" :caption="ownLine(resetSummary.nutrition)" :on="alsoFoods" data-reset-foods @toggle="alsoFoods = !alsoFoods" />
          <div v-if="resetConfirm === 'nutrition'" class="rconfirm" role="alertdialog" aria-labelledby="rn-h" aria-describedby="rn-d">
            <h4 id="rn-h" class="t-bodys m0">Reset nutrition?</h4>
            <p id="rn-d" class="t-label c2 m0">{{ confirmLine("nutrition", resetSummary, alsoFoods) }}</p>
            <div class="row cbtns">
              <button type="button" class="btn sm secondary t-label" :disabled="!canResetNutrition || resetting" data-reset-go @click="onReset('nutrition')">
                {{ resetting ? "Resetting…" : "Reset nutrition" }}
              </button>
              <button type="button" class="btn sm primary t-label" :disabled="resetting" @click="resetConfirm = null">Keep</button>
            </div>
          </div>
          <span class="t-capn c2 gnote">Settings, units and the Home layout stay. Export first to keep a copy.</span>
        </section>
      </template>
    </div>

    <div v-else-if="view === 'home'" class="col body" data-home-sections>
      <p class="t-capn c2 m0">Pick what Home shows under the week. New cards join this list.</p>
      <div class="col">
        <SwitchRow :title="WEEK_ROW.title" :caption="WEEK_ROW.caption" on locked data-home-switch="week" />
        <SwitchRow
          v-for="row in sections"
          :key="row.id"
          :title="row.title"
          :caption="row.caption"
          :on="sectionShown(row.id)"
          :data-home-switch="row.id"
          @toggle="setSectionShown(row.id, !sectionShown(row.id))"
        />
      </div>
      <p class="t-capn c3 m0">Kept on this device, like the theme.</p>
    </div>

    <div v-else-if="view === 'country'" class="col body" data-country-picker>
      <button ref="followRow" type="button" class="zrow" role="radio" :aria-checked="countryFollows" :disabled="busy" @click="save({ foodCountryFollowsZone: true })">
        <span class="tick" aria-hidden="true"><Icon v-if="countryFollows" name="check" :size="16" /></span>
        <span class="col grow">
          <span class="t-body">Use the time zone</span>
          <span class="t-capn c2">{{ countryFollows ? `${countryName(country)} · from ${zoneLabel(zone)}` : `The country of ${zoneLabel(zone)}` }}</span>
        </span>
      </button>
      <input
        ref="search"
        v-model="query"
        class="field zsearch t-body"
        type="search"
        inputmode="search"
        autocomplete="off"
        placeholder="Search country"
        aria-label="Search countries"
        data-no-autofocus
      />
      <div class="col zlist" role="radiogroup" aria-label="Countries">
        <button
          v-for="item in countryResults"
          :key="item.code"
          type="button"
          class="zrow"
          role="radio"
          :aria-checked="!countryFollows && item.code === country"
          :disabled="busy"
          :data-country="item.code"
          @click="save({ foodCountry: item.code, foodCountryFollowsZone: false })"
        >
          <span class="tick" aria-hidden="true"><Icon v-if="!countryFollows && item.code === country" name="check" :size="16" /></span>
          <span class="t-body grow zname">{{ item.name }}</span>
          <span class="t-capn c2 ztables">{{ countryTables(item.code) }}</span>
        </button>
        <p v-if="!countryResults.length" class="t-body c2 m0">No country matches “{{ query }}”.</p>
      </div>
      <p v-if="error" class="t-body m0" role="alert">{{ error }}</p>
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
.group { min-width: 0; gap: 0; padding: 14px var(--space-l) var(--space-2xs); border-radius: var(--radius-l); background: var(--color-surface-2); --btn-bg: var(--color-surface); box-shadow: var(--d-edge); }
.gtitle { margin: 0; padding-bottom: 6px; display: flex; align-items: center; gap: var(--space-s); }
.gtitle svg { color: var(--text-secondary); flex: none; }
.group > :not(.gtitle) + :not(.gtitle) { border-top: 1px solid var(--color-border); }
.gnote { padding: var(--space-s) 0 var(--space-m); }
.group > p[role="alert"] { padding: var(--space-s) 0 var(--space-m); }
/* Theme and accent: a name on the left, six 28px circles in 44px hit boxes on the right. A long
   name wraps onto two lines; with large text the circles move under the name. */
.look { min-height: 56px; padding: var(--space-xs) 0; column-gap: 0; }
html.dt-l .look { flex-wrap: wrap; }
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
.hnames { overflow-wrap: anywhere; }
.hcount { flex: none; white-space: nowrap; }
[data-home-row] { padding-block: var(--space-xs); }
.body[data-home-sections] { gap: var(--space-s); }
.signout { flex: none; }
.rbtn { flex: none; }
.rconfirm { display: flex; flex-direction: column; gap: var(--space-s); padding: var(--space-m) 0; }
.cbtns { gap: var(--space-s); flex-wrap: wrap; }
.build { text-align: center; }
.body[data-zone-picker], .body[data-country-picker] { gap: var(--space-m); }
.zsearch { width: 100%; font-size: 16px; }
.zlist { gap: 0; }
.zrow { width: 100%; min-height: var(--control-hit); display: flex; align-items: center; gap: var(--space-s); text-align: left; padding: var(--space-s) 0; border-bottom: 1px solid var(--color-border); min-width: 0; }
.zlist .zrow:last-of-type { border-bottom: 0; }
.zrow .grow { min-width: 0; gap: var(--space-2xs); }
.tick { width: 18px; flex: none; display: grid; place-items: center; color: var(--text-primary); }
.zname { overflow-wrap: anywhere; }
.zoff { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* The tables a country's foods come from. Long ones ("Matvaretabellen · Kassalapp") wrap rather than squeeze the name. */
.ztables { flex: 0 1 auto; text-align: right; max-width: 55%; }
html.dt-l .frow { flex-wrap: wrap; }
html.dt-l .zval { max-width: 100%; }
</style>
