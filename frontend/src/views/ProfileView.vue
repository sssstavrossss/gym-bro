<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import Icon from "../components/Icon.vue";
import Segmented from "../components/Segmented.vue";
import SelectMark from "../components/SelectMark.vue";
import TargetHistory from "../components/TargetHistory.vue";
import { ACTIVITY, FAT_PRESETS, PROTEIN_PRESETS, RATES, type ActivityKey, type Goal, type MacroSetting, type Sex } from "../lib/nutrition";
import { int } from "../lib/format";
import { parseDecimal } from "../lib/numbers";
import { boot } from "../state/boot";
import { clearAllDrafts, commitProfile, profile, shownTargets, weightCaption } from "../state/profile";
import { signOut } from "../auth/session";
import { enableReminders, getNotifications, notificationHint } from "../lib/notifications";
import { getInbox, markAllNotificationsRead, putNotificationType, type InboxItem, type NotificationSettings } from "../api";
import { unreadCount } from "../lib/recalculate";
import { inbox } from "../state/inbox";
import { openRecalculate, openWeight } from "../ui";
import { vp } from "../lib/viewport";
import { applyTheme, readTheme, themes, type ThemeId } from "../lib/theme";

const theme = ref<ThemeId>(readTheme());
function chooseTheme(id: ThemeId) {
  theme.value = id;
  applyTheme(id);
}

const notes = ref<NotificationSettings | null>(null);
const noteError = ref("");
const noteBusy = ref(false);
const items = ref<InboxItem[]>([]);
const hint = notificationHint();
const sectionUnread = computed(() => unreadCount(items.value) > 0 || inbox.unread > 0);
onMounted(() => {
  void getNotifications().then((value) => { notes.value = value; }).catch(() => { noteError.value = "Couldn't load notification settings."; });
  void loadInbox();
});
async function loadInbox() {
  try {
    const body = await getInbox();
    items.value = body.items;
    inbox.unread = body.unread;
  } catch {
    noteError.value = "Couldn't load notifications.";
  }
}
async function onReadAll() {
  noteBusy.value = true;
  try {
    await markAllNotificationsRead();
    items.value = items.value.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }));
    inbox.unread = 0;
  } catch (error) {
    noteError.value = error instanceof Error ? error.message : "Couldn't mark them read.";
  } finally {
    noteBusy.value = false;
  }
}
const typeOn = computed(() => {
  const settings = notes.value;
  if (!settings?.configured) return false;
  return settings.types?.find((item) => item.id === "recalculate")?.enabled ?? false;
});
async function onType() {
  if (!notes.value || noteBusy.value) return;
  noteBusy.value = true;
  noteError.value = "";
  const next = !typeOn.value;
  try {
    if (next && notes.value.configured && !notes.value.enabled) {
      notes.value = await enableReminders(notes.value);
    }
    notes.value = await putNotificationType("recalculate", next);
  } catch (error) {
    noteError.value = error instanceof Error ? error.message : "Couldn't update reminders.";
  } finally {
    noteBusy.value = false;
  }
}
const actOpen = ref(false);
const customOpen = ref(false);
const year = new Date().getFullYear();
const age = computed(() => {
  if (!/^\d{4}$/.test(profile.form.birthYear.trim())) return null;
  return year - Number(profile.form.birthYear);
});
const shown = computed(() => shownTargets());
const caption = computed(() => weightCaption(profile.weight));

function setSex(value: string) {
  profile.form.sex = value as Sex;
  void commitProfile();
}
function setGoal(value: string) {
  profile.form.goal = value as Goal;
  if (value === "maintain") profile.form.rate = "";
  void commitProfile();
}
function setActivity(key: ActivityKey) {
  profile.form.activity = key;
  actOpen.value = false;
  void commitProfile();
}
function setRate(rate: number) {
  profile.form.rate = rate === 1 ? "1.0" : String(rate);
  void commitProfile();
}
function setProtein(key: MacroSetting, value: number) {
  profile.form.proteinSetting = key;
  profile.form.proteinGramsPerKg = value.toFixed(1);
  void commitProfile();
}
function setFat(key: MacroSetting, value: number) {
  profile.form.fatSetting = key;
  profile.form.fatPercent = Number.isInteger(value) ? String(value) : value.toFixed(1);
  void commitProfile();
}
function onExactProtein() {
  const parsed = parseDecimal(profile.form.proteinGramsPerKg);
  if (parsed == null) return;
  profile.form.proteinSetting = "exact";
  profile.form.proteinGramsPerKg = parsed.toFixed(1);
  void commitProfile();
}
function onExactFat() {
  const parsed = parseDecimal(profile.form.fatPercent);
  if (parsed == null) return;
  profile.form.fatSetting = "exact";
  profile.form.fatPercent = String(parsed);
  void commitProfile();
}
function resetMacros() {
  profile.form.proteinSetting = "normal";
  profile.form.proteinGramsPerKg = "2.0";
  profile.form.fatSetting = "normal";
  profile.form.fatPercent = "25";
  void commitProfile();
}
function onTextCommit() {
  void commitProfile();
}
async function onSignOut() {
  if (!boot.config) return;
  clearAllDrafts();
  await signOut(boot.config);
}
</script>

<template>
  <main class="screen">
    <header class="screen-head">
      <h1 class="t-title">Profile</h1>
    </header>

    <div class="pgrid" :class="{ two: vp.tablet, desk: vp.desktop }">
      <div class="pcol">
        <section class="card" aria-labelledby="theme-h">
          <h2 id="theme-h" class="t-label c2">Theme</h2>
          <div class="themes" role="radiogroup" aria-label="Theme">
            <button v-for="item in themes" :key="item.id" type="button" role="radio" class="theme" :aria-checked="theme === item.id" @click="chooseTheme(item.id)">
              <span class="swatch" :style="{ background: item.background }" aria-hidden="true"></span>
              <span class="t-label">{{ item.label }}</span>
            </button>
          </div>
        </section>
        <section class="card about">
          <span class="t-label c2 about-kicker">About you</span>
          <div class="frow sexrow compact-seg">
            <span class="t-body c2">Sex</span>
            <span class="grow" />
            <Segmented class="sexseg" label="Sex" :model-value="profile.form.sex" :options="[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]" @update:model-value="setSex" />
          </div>
          <label class="frow">
            <span class="t-body c2">Birth year</span>
            <span class="fval">
              <input v-model="profile.form.birthYear" class="ninput" type="text" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Birth year" @blur="onTextCommit" />
              <span v-if="age !== null" class="t-label c2">{{ age }} y</span>
            </span>
          </label>
          <label class="frow">
            <span class="t-body c2">Height</span>
            <span class="fval">
              <input v-model="profile.form.heightCm" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Height in centimetres" @blur="onTextCommit" />
              <span class="t-label c2">cm</span>
            </span>
          </label>
          <button type="button" class="frow" @click="openWeight()">
            <span class="t-body c2">Weight</span>
            <span class="grow" />
            <span class="row lowrow t-label c2">
              <AccuracyDot v-if="caption.low" :interactive="false" />
              {{ caption.label }}
            </span>
            <span class="fval t-ns">{{ caption.value }}</span>
            <Icon name="right" :size="16" class="fchev" />
          </button>
          <button type="button" class="frow" :aria-expanded="actOpen" @click="actOpen = !actOpen">
            <span class="t-body c2">Activity</span>
            <span class="grow" />
            <span class="t-body">{{ profile.form.activity ? ACTIVITY[profile.form.activity].label : "Choose" }}</span>
            <Icon :name="actOpen ? 'down' : 'right'" :size="16" class="fchev" />
          </button>
          <div v-if="actOpen" class="acts">
            <button v-for="(item, key) in ACTIVITY" :key="key" type="button" class="act" :class="{ on: key === profile.form.activity }" @click="setActivity(key)">
              <span class="t-body grow">{{ item.label }}</span>
              <span class="t-label c2">{{ item.hint }}</span>
            </button>
          </div>
          <label class="frow last">
            <span class="t-body c2">Time zone</span>
            <input v-model="profile.form.timeZone" class="tz" type="text" autocomplete="off" aria-label="Time zone" @blur="onTextCommit" />
          </label>
        </section>

        <section class="card">
          <span class="t-label c2">Goal</span>
          <div class="compact-seg">
            <Segmented label="Goal" :model-value="profile.form.goal" :options="[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]" @update:model-value="setGoal" />
          </div>
          <div v-if="profile.form.goal !== 'maintain'" class="rate" role="group" aria-label="Rate">
            <span class="t-body c2">Rate</span>
            <button v-for="rate in RATES" :key="rate" type="button" class="chip t-label" :class="{ on: Number(profile.form.rate) === rate }" @click="setRate(rate)">{{ rate === 1 ? "1.0" : rate }}</button>
            <span class="t-label c2">kg/wk</span>
          </div>
          <label class="frow last">
            <span class="t-body c2">Goal weight</span>
            <span class="fval">
              <input v-model="profile.form.goalWeightKg" class="ninput" type="text" inputmode="decimal" autocomplete="off" aria-label="Goal weight in kilograms" @blur="onTextCommit" />
              <span class="t-label c2">kg</span>
            </span>
          </label>
        </section>
      </div>

      <div class="pcol">
        <section v-if="shown" class="card">
          <h2 class="t-label c2">Your targets</h2>
          <div class="stats">
            <div><span class="t-label c2">BMR</span><span class="figure"><span class="t-ns" data-field="bmr">{{ int(shown.bmr) }}</span><span class="t-label c2">kcal</span></span></div>
            <div><span class="t-label c2">Daily burn</span><span class="figure"><span class="t-ns" data-field="tdee">{{ int(shown.tdee) }}</span><span class="t-label c2">kcal</span></span></div>
            <div><span class="t-label c2">Eat</span><span class="figure"><span class="t-nm" data-field="kcal">{{ int(shown.kcal) }}</span><span class="t-label c2">kcal</span></span></div>
          </div>
          <div class="divider" />
          <div class="stats">
            <div><span class="t-label c2">Protein</span><span class="figure"><span class="t-ns" data-field="protein">{{ int(shown.protein) }}</span><span class="t-label c2">g</span></span></div>
            <div><span class="t-label c2">Fat</span><span class="figure"><span class="t-ns" data-field="fat">{{ int(shown.fat) }}</span><span class="t-label c2">g</span></span></div>
            <div><span class="t-label c2">Carbs</span><span class="figure"><span class="t-ns" data-field="carbs">{{ int(shown.carbs) }}</span><span class="t-label c2">g</span></span></div>
          </div>
          <p v-if="shown.floorApplied" class="t-body" data-floor="true">Raised to your BMR so the target does not go below it.</p>
          <button type="button" class="chip t-label recalc" @click="openRecalculate">Recalculate</button>
        </section>

        <TargetHistory />

        <section class="card notes" aria-labelledby="remind-heading">
          <div class="row head">
            <h2 id="remind-heading" class="t-label c2 grow">Notifications<span v-if="sectionUnread" class="sr-only"> Unread</span></h2>
            <span v-if="sectionUnread" class="bullet" aria-hidden="true" />
            <button v-if="sectionUnread" type="button" class="t-label markall" :disabled="noteBusy" @click="onReadAll">Mark all read</button>
          </div>
          <button type="button" class="nrow" :aria-pressed="typeOn" :disabled="noteBusy" @click="onType">
            <span class="col grow">
              <span class="t-body">Weekly recalculate</span>
              <span class="t-capn c2">Monday morning</span>
            </span>
            <span class="mark" :class="{ on: typeOn }"><SelectMark :on="typeOn" /></span>
          </button>
          <p v-if="notes && !notes.configured" class="t-capn c2 status">Notifications are not set up.</p>
          <p v-else-if="notes" class="t-capn c2 status">{{ notes.enabled ? "Push is on." : "Push is off." }}</p>
          <p v-if="hint" class="t-capn c2 status">{{ hint }}</p>
          <p v-if="noteError" class="t-body" role="alert">{{ noteError }}</p>
        </section>

        <section class="card">
          <button type="button" class="frow last" :aria-expanded="customOpen" @click="customOpen = !customOpen">
            <span class="t-body">Customise</span>
            <span class="grow" />
            <span class="t-label c2">{{ customOpen ? "Hide" : "Normal balance" }}</span>
            <Icon :name="customOpen ? 'down' : 'right'" :size="16" class="fchev" />
          </button>
          <div v-if="customOpen" class="custom">
            <div role="group" aria-label="Protein">
              <span class="t-label c2">Protein</span>
              <div class="rate">
                <button v-for="item in PROTEIN_PRESETS" :key="item.key" type="button" class="chip t-label" :class="{ on: profile.form.proteinSetting === item.key }" @click="setProtein(item.key, item.value)">{{ item.label }}</button>
              </div>
              <label class="frow last">
                <span class="t-body c2">Exact</span>
                <span class="fval">
                  <input v-model="profile.form.proteinGramsPerKg" class="ninput" type="text" inputmode="decimal" aria-label="Exact protein, grams per kilogram" @blur="onExactProtein" />
                  <span class="t-label c2">g/kg</span>
                </span>
              </label>
            </div>
            <div role="group" aria-label="Fat">
              <span class="t-label c2">Fat</span>
              <div class="rate">
                <button v-for="item in FAT_PRESETS" :key="item.key" type="button" class="chip t-label" :class="{ on: profile.form.fatSetting === item.key }" @click="setFat(item.key, item.value)">{{ item.label }}</button>
              </div>
              <label class="frow last">
                <span class="t-body c2">Exact</span>
                <span class="fval">
                  <input v-model="profile.form.fatPercent" class="ninput" type="text" inputmode="decimal" aria-label="Exact fat, percent" @blur="onExactFat" />
                  <span class="t-label c2">%</span>
                </span>
              </label>
            </div>
            <button type="button" class="chip t-label" @click="resetMacros">Reset to default</button>
            <p class="t-body c2">More carbs means less protein or fat.</p>
          </div>
        </section>

        <button type="button" class="chip t-label signout" @click="onSignOut">Sign out</button>
      </div>
    </div>
    <p v-if="profile.error" class="alert" role="alert">{{ profile.error }}</p>
  </main>
</template>

<style scoped>
.frow { min-height: 44px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--color-border); width: 100%; text-align: left; }
.sexrow { flex-wrap: wrap; }
.compact-seg :deep(.seg) { min-height: 30px; padding: 3px; border-radius: 10px; }
.sexrow :deep(.seg) { width: auto; flex: 0 0 auto; min-width: 150px; margin-left: auto; }
html:not(.dt-xl) .compact-seg :deep(.seg-btn) {
  min-width: 44px; min-height: 24px; padding: 2px 8px; border-radius: 8px;
}
html:not(.dt-xl) .sexrow :deep(.seg-btn) { padding: 2px var(--space-gap); }
html:not(.dt-xl) .compact-seg :deep(.seg-btn)::after {
  content: ""; position: absolute; inset: min(0px, calc((100% - 44px) / 2)) 0;
}
.lowrow { gap: 6px; }
.frow.last { border-bottom: 0; }
.fval { display: inline-flex; align-items: baseline; gap: 8px; margin-left: auto; white-space: nowrap; flex-wrap: nowrap; flex: none; }
.fval .ninput { margin-left: 0; }
.ninput { width: 88px; margin-left: auto; text-align: right; background: transparent; border: 0; min-height: 44px; }
.tz { margin-left: auto; width: 180px; text-align: right; background: transparent; border: 0; min-height: 44px; }
.recalc { align-self: flex-start; }
.nrow {
  min-height: 44px; width: 100%; display: flex; align-items: center; gap: var(--space-gap);
  text-align: left; padding: 0;
}
.nrow .mark { position: relative; width: 44px; height: 44px; flex: none; }
.status { margin: 0; }
.notes { gap: var(--space-gap); }
.notes .head { min-height: 0; align-items: flex-start; }
.notes p { margin: 0; overflow-wrap: anywhere; }
.head { gap: var(--space-gap); align-items: center; min-height: var(--control-hit); }
.feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); }
.note { width: 100%; min-height: var(--control-hit); gap: var(--space-gap); text-align: left; align-items: flex-start; }
.wrap { overflow-wrap: anywhere; }
.markall { min-height: var(--control-hit); padding: 0 var(--space-gap); }
.bullet { width: 8px; height: 8px; border-radius: 50%; background: var(--text-primary); flex: none; }
.acts, .custom { display: flex; flex-direction: column; gap: var(--space-gap); }
.act { min-height: 44px; display: flex; align-items: center; gap: 10px; text-align: left; border-radius: 10px; padding: 0 8px; }
.act.on { background: var(--color-surface-2); }
.rate { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.stats { display: flex; gap: 12px; }
.stats > div { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.figure { display: inline-flex; align-items: baseline; gap: 4px; flex-wrap: nowrap; white-space: nowrap; min-width: 0; }
.pgrid, .pcol { display: flex; flex-direction: column; gap: var(--space-gap); min-width: 0; }
.two.pgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.desk.pgrid { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; }
.two .frow, .desk .frow { min-width: 0; }
.two .tz, .desk .tz { width: min(180px, 100%); max-width: 100%; }
.signout { align-self: flex-start; }
.themes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-gap); }
.theme {
  min-height: var(--control-hit); min-width: 0; width: 100%;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 var(--space-gap); border-radius: 12px; background: var(--color-surface-2); color: var(--text-primary);
}
.dt-xl .themes { grid-template-columns: 1fr; }
.theme[aria-checked="true"] { box-shadow: inset 0 0 0 1.5px var(--text-primary); }
.swatch { width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px var(--color-border-strong); flex: none; }
h2 { margin: 0; }
/* xxxL and up: label on top, value under it, left-aligned. A value never splits from its unit. */
.dt-l .about-kicker { font-size: 0.6471rem; line-height: 0.8235rem; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
.dt-l .frow { position: relative; flex-direction: column; flex-wrap: nowrap; align-items: flex-start; gap: 2px; padding: 8px 0; height: auto; }
.dt-l .frow > .grow { display: none; }
.dt-l .frow > * { max-width: 100%; }
.dt-l .frow:has(.fchev) { padding-right: 28px; }
.dt-l .fchev { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
.dt-l .fval { margin-left: 0; }
.dt-l .fval .ninput { width: 6.5ch; min-width: 2ch; text-align: left; }
@supports (field-sizing: content) {
  .dt-l .fval .ninput { field-sizing: content; width: auto; min-width: 2ch; }
}
.dt-l .sexrow :deep(.seg) { flex: 1 1 auto; width: 100%; max-width: 100%; min-width: 0; align-self: stretch; }
.dt-l .lowrow { white-space: normal; max-width: 100%; }
.dt-l .tz { width: 100%; max-width: 100%; margin-left: 0; text-align: left; min-width: 0; }
.dt-xl .stats { flex-direction: column; align-items: stretch; }
.dt-xl .stats > div { width: 100%; max-width: 100%; }
.dt-xl .pcol > p { max-width: 100%; overflow-wrap: anywhere; }
</style>
