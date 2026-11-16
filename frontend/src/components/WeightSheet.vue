<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ConfirmWeighInBody } from "../api";
import BottomSheet from "./BottomSheet.vue";
import AccuracyDot from "./AccuracyDot.vue";
import Icon from "./Icon.vue";
import WeightChart from "./WeightChart.vue";
import { dayMonth, diffDays, shortDate, todayIso } from "../lib/dates";
import { toKg, typoGuardDetail, weightRange } from "../lib/units";
import { parseDecimal } from "../lib/numbers";
import { earliestNewWeighInDate, gapLabel, isFreshStart, isLowAccuracy, newWeighInDates, trendChange } from "../lib/weightDisplay";
import { profile, removeWeighIn, saveWeighIn } from "../state/profile";
import { weightUnit, wt, wtSigned, wtUnit } from "../state/units";
import { closeSheet, toast, ui } from "../ui";
import { vp } from "../lib/viewport";
import { armReplace } from "../lib/focusField";
import { afterInsertion, markWholeSelection, nextQuickInput, tookWholeSelection } from "../lib/quickEntry";

const open = computed(() => ui.sheet === "weight");
const value = ref("");
const replaceFirst = ref(true);
const input = ref<HTMLInputElement | null>(null);
const confirm = ref<ConfirmWeighInBody | null>(null);
const confirmEl = ref<HTMLElement | null>(null);
const localError = ref("");
const dayOpen = ref(false);
const dayTight = ref(false);
const dayBelow = ref(false);
const dayRoot = ref<HTMLElement | null>(null);
let dayObserver: ResizeObserver | undefined;

const today = computed(() => profile.weight?.asOf || todayIso());
const selected = computed(() => profile.weighIns.find((row) => row.localDate === ui.weightDate) ?? null);
const ownKg = computed(() => selected.value?.kg);
const dayOptions = computed(() => {
  const dates = newWeighInDates(today.value);
  const oldest = earliestNewWeighInDate(today.value);
  if (selected.value && ui.weightDate < oldest && !dates.includes(ui.weightDate)) {
    dates.push(ui.weightDate);
  }
  return dates.map((date) => {
    const own = profile.weighIns.find((row) => row.localDate === date);
    const index = diffDays(today.value, date);
    const title = index === 0 ? `Today, ${dayMonth(date)}` : index === 1 ? `Yesterday, ${dayMonth(date)}` : shortDate(date);
    return { value: date, title, kgText: own ? wt(own.kg) : "" };
  });
});
const longDayLabel = computed(() => {
  const match = dayOptions.value.find((option) => option.value === ui.weightDate);
  return (match?.title ?? shortDate(ui.weightDate)).replace("Yesterday", "Yest.");
});
const closedDayLabel = computed(() => {
  if (!dayTight.value) return longDayLabel.value;
  return diffDays(today.value, ui.weightDate) === 0 ? "Today" : dayMonth(ui.weightDate);
});

function textWidth(node: HTMLElement) {
  const probe = document.createElement("span");
  const style = getComputedStyle(node);
  probe.textContent = node.textContent;
  probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font:${style.font};letter-spacing:${style.letterSpacing};`;
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function fitDayLabel() {
  const root = dayRoot.value;
  const lead = root?.parentElement;
  const probe = root?.querySelector(".daymeasure");
  const title = lead?.querySelector("h2");
  if (!root || !lead || !(probe instanceof HTMLElement) || !(title instanceof HTMLElement)) return;
  const style = getComputedStyle(lead);
  const gap = Number.parseFloat(style.columnGap || style.gap || "8") || 8;
  const below = root.offsetTop > title.offsetTop + 4;
  const room = below ? lead.clientWidth : Math.max(0, lead.clientWidth - textWidth(title) - gap);
  const tight = probe.scrollWidth + 36 > room + 1;
  if (below !== dayBelow.value) dayBelow.value = below;
  if (tight !== dayTight.value) dayTight.value = tight;
}

function watchDayFit() {
  dayObserver?.disconnect();
  const lead = dayRoot.value?.parentElement;
  const header = lead?.parentElement;
  if (!lead) return;
  dayObserver = new ResizeObserver(() => fitDayLabel());
  dayObserver.observe(lead);
  if (header) dayObserver.observe(header);
  fitDayLabel();
}

function chooseDay(date: string) {
  ui.weightDate = date;
  dayOpen.value = false;
}

function awayDay(event: Event) {
  if (dayOpen.value && dayRoot.value && !dayRoot.value.contains(event.target as Node)) dayOpen.value = false;
}

function keyDay(event: KeyboardEvent) {
  if (event.key === "Escape" && dayOpen.value) {
    dayOpen.value = false;
    event.stopPropagation();
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", awayDay, true);
  document.addEventListener("keydown", keyDay, true);
  window.addEventListener("resize", fitDayLabel);
});
onBeforeUnmount(() => {
  dayObserver?.disconnect();
  document.removeEventListener("pointerdown", awayDay, true);
  document.removeEventListener("keydown", keyDay, true);
  window.removeEventListener("resize", fitDayLabel);
});
const canDelete = computed(() => selected.value?.canDelete === true);
const onlyWeighIn = computed(() => selected.value != null && selected.value.canDelete === false);

const placeholder = computed(() => {
  const own = ownKg.value;
  const latest = profile.weight?.latestKg;
  if (own != null) return wt(own);
  if (latest != null) return wt(latest);
  return "";
});

function clearEntry() {
  value.value = "";
  replaceFirst.value = true;
}

watch(open, async (isOpen) => {
  confirm.value = null;
  localError.value = "";
  dayOpen.value = false;
  if (!isOpen) {
    dayObserver?.disconnect();
    return;
  }
  dayTight.value = false;
  dayBelow.value = false;
  if (ui.keepWeightDraft) {
    ui.keepWeightDraft = false;
    await nextTick();
    watchDayFit();
    return;
  }
  ui.weightDate = today.value;
  clearEntry();
  await nextTick();
  watchDayFit();
});
watch(() => ui.weightDate, () => {
  if (!open.value) return;
  confirm.value = null;
  clearEntry();
});

/** The typed weight in kilograms: one decimal in the shown unit, so pounds keep two kilogram decimals. */
const parsed = computed(() => {
  const number = parseDecimal(value.value);
  if (number == null) return null;
  const kgValue = toKg(Math.round(number * 10) / 10, weightUnit());
  return kgValue >= 30 && kgValue <= 300 ? kgValue : null;
});
const rangeHint = computed(() => {
  const unit = weightUnit();
  const range = weightRange(unit);
  const example = unit === "lb" ? "184,3 or 184.3" : "83,4 or 83.4";
  return `Enter a weight between ${range.min} and ${range.max} ${unit}, e.g. ${example}`;
});
const invalid = computed(() => value.value.trim() !== "" && parsed.value === null);
const low = computed(() => isLowAccuracy(profile.weight));
const fresh = computed(() => isFreshStart(profile.weight));
const week = computed(() => trendChange(profile.chart?.series, 7, fresh.value));
const month = computed(() => trendChange(profile.chart?.series, 29, fresh.value));
const history = computed(() => profile.weighIns
  .filter((row) => row.localDate !== ui.weightDate && row.localDate <= today.value)
  .slice(0, 4));

const hint = computed(() => {
  if (ownKg.value != null) return `${ui.weightDate === today.value ? "Today's" : "This day's"} weigh-in is ${wtUnit(ownKg.value)} · saving replaces it`;
  const earlier = profile.weighIns.filter((row) => row.localDate < ui.weightDate);
  const prev = earlier[0];
  if (!prev) return "First weigh-in";
  const ago = diffDays(ui.weightDate, prev.localDate);
  return `Last weigh-in ${wtUnit(prev.kg)} ${ago === 1 ? "yesterday" : `${ago} days before`}`;
});

async function save(force = false) {
  if (parsed.value == null) {
    localError.value = rangeHint.value;
    input.value?.focus();
    return;
  }
  localError.value = "";
  const result = await saveWeighIn(ui.weightDate, parsed.value, force);
  if (!result) {
    localError.value = profile.error || "Could not save that weigh-in.";
    return;
  }
  if (result.confirm) {
    confirm.value = result.confirm;
    input.value?.blur();
    await nextTick();
    confirmEl.value?.focus({ preventScroll: true });
    return;
  }
  const replaced = result.saved.replaced;
  const trend = result.saved.trend;
  const note = trend.trendState === "fresh_start" && trend.freshStart
    ? `fresh start after ${gapLabel(trend.freshStart.daysSincePrevious)}`
    : `trend now ${trend.trendKg != null ? wtUnit(trend.trendKg) : `— ${weightUnit()}`}${isLowAccuracy(trend) ? " · low accuracy" : ""}`;
  toast(replaced ? `Replaced the weigh-in with ${wtUnit(result.saved.kg)} · ${note}` : `Saved ${wtUnit(result.saved.kg)} · ${note}`);
  closeSheet();
}

function focusWeight(el: HTMLInputElement | null) {
  if (!el) return;
  replaceFirst.value = true;
  el.focus();
  armReplace(el);
}

function fix() {
  confirm.value = null;
  void nextTick(() => focusWeight(input.value));
}

function editOnly() {
  void nextTick(() => focusWeight(input.value));
}

function onWeightFocus(event: FocusEvent) {
  replaceFirst.value = true;
  if (event.target instanceof HTMLInputElement) armReplace(event.target);
}

function onWeightInput(event: Event) {
  const field = event.target as HTMLInputElement;
  const replace = replaceFirst.value;
  afterInsertion(field, (raw) => {
    const next = nextQuickInput(value.value, raw, replace && !tookWholeSelection(field), 6);
    replaceFirst.value = false;
    value.value = next;
    if (field.value !== next) field.value = next;
  });
}

async function del() {
  if (!canDelete.value) return;
  const date = ui.weightDate;
  const old = ownKg.value;
  const ok = await removeWeighIn(date);
  if (!ok) {
    localError.value = profile.error || "Could not delete that weigh-in.";
    return;
  }
  closeSheet();
  if (old == null) {
    toast("Weigh-in deleted");
    return;
  }
  const kilograms = old;
  toast(`Deleted weigh-in ${wtUnit(kilograms)} · ${shortDate(date)}`, {
    label: "Undo",
    run: () => { void restoreWeighIn(date, kilograms); },
  });
}

async function restoreWeighIn(date: string, kilograms: number) {
  const result = await saveWeighIn(date, kilograms);
  if (result?.confirm) {
    const forced = await saveWeighIn(date, kilograms, true);
    if (!forced || forced.confirm) toast("Could not restore that weigh-in.");
    return;
  }
  if (!result) toast("Could not restore that weigh-in.");
}

const diffText = computed(() => (
  confirm.value ? typoGuardDetail(confirm.value.kg, confirm.value.previousTrendKg, weightUnit()) : ""
));
</script>

<template>
  <BottomSheet :open="open" label="Log weight" @close="closeSheet">
    <template #header>
      <div class="hdr" :class="{ below: dayBelow }">
        <div class="lead">
          <h2 class="t-head htitle">Log weight</h2>
          <div ref="dayRoot" class="daypick">
            <span class="daymeasure t-label" aria-hidden="true">{{ longDayLabel }}</span>
            <button type="button" class="daybtn" :aria-label="`Weigh-in day, ${closedDayLabel}`" :aria-expanded="dayOpen" aria-haspopup="listbox" @click.stop="dayOpen = !dayOpen">
              <span class="dayface t-label" aria-hidden="true">{{ closedDayLabel }}</span>
              <span class="daychev" aria-hidden="true" />
            </button>
            <div v-if="dayOpen" class="daymenu" role="listbox" aria-label="Weigh-in day">
              <button v-for="option in dayOptions" :key="option.value" type="button" role="option" class="dayopt" :data-date="option.value" :aria-selected="option.value === ui.weightDate" @click="chooseDay(option.value)">
                <span class="grow">{{ option.title }}</span>
                <span v-if="option.kgText" class="t-label c3">{{ option.kgText }}</span>
                <Icon v-if="option.value === ui.weightDate" name="check" :size="16" :sw="2.6" />
              </button>
            </div>
          </div>
        </div>
        <button type="button" class="cbtn hclose" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <form class="row wfield" @submit.prevent="save(false)">
      <label class="base grow">
        <span class="sr-only">Weight in kilograms</span>
        <span class="autosize">
          <span class="mirror wfig" aria-hidden="true">{{ value || placeholder || "0" }}</span>
          <input ref="input" data-no-autofocus :value="value" :placeholder="placeholder" data-replace="1" class="wfig winput" size="1" inputmode="decimal" enterkeyhint="done" autocomplete="off" :aria-label="`Weight in ${weightUnit() === 'lb' ? 'pounds' : 'kilograms'}`" @beforeinput="markWholeSelection" @focus="onWeightFocus" @input="onWeightInput" />
        </span>
        <span class="t-head c2">{{ weightUnit() }}</span>
      </label>
      <button type="button" class="cbtn filled" aria-label="Save weight" :disabled="parsed === null" @click="save(false)"><Icon name="check" :size="20" :sw="2.6" /></button>
    </form>
    <div v-if="confirm" ref="confirmEl" class="card outline tguard" role="alertdialog" aria-labelledby="tg-h" aria-describedby="tg-d" tabindex="-1">
      <h3 id="tg-h" class="t-head m0">Is {{ wtUnit(confirm.kg) }} right?</h3>
      <p id="tg-d" class="t-label c2 m0">{{ diffText }}</p>
      <div class="row tgb">
        <button type="button" class="btn sm primary t-label" @click="fix">Fix it</button>
        <button type="button" class="btn sm secondary t-label" @click="save(true)">Yes, save {{ wtUnit(confirm.kg) }}</button>
      </div>
    </div>
    <p v-if="invalid || localError" class="t-label m0" role="alert">{{ localError || rangeHint }}</p>
    <template v-else-if="onlyWeighIn">
      <p class="t-capn c3 m0">{{ hint }}</p>
      <div class="row only">
        <p class="t-capn c2 m0 grow">This is your only weigh-in, so it can't be deleted.</p>
        <button type="button" class="btn sm secondary t-label" aria-label="Edit your only weigh-in" @click="editOnly"><Icon name="edit" :size="14" /> Edit</button>
      </div>
    </template>
    <div v-else class="row only">
      <p class="t-capn c2 m0 grow">{{ hint }}</p>
      <button v-if="canDelete" type="button" class="btn sm secondary t-label" @click="del"><Icon name="trash" :size="14" /> Delete</button>
    </div>
    <div v-if="!profile.weighIns.length" class="card outline wempty">
      <span class="t-label c2">Your chart starts with this weigh-in</span>
      <span class="t-capn c2">Your trend starts with it, and gets more accurate with 2+ weigh-ins a week.</span>
    </div>
    <div v-else-if="profile.chart" class="card inset chart-card">
      <div class="row legend">
        <span class="t-cap c2 section-title">Last 30 days</span>
        <span class="grow" />
        <span class="row lg"><i class="dot" /> <span class="t-capn c2">weigh-in</span></span>
        <span class="row lg"><i class="dash" /> <span class="t-capn c2">trend</span></span>
      </div>
      <WeightChart :series="profile.chart.series" :fluid="vp.tablet" />
    </div>
    <div v-if="fresh && profile.weight?.freshStart" class="card outline fresh">
      <span class="t-bodys">Fresh start</span>
      <span class="t-label c2">It had been {{ gapLabel(profile.weight.freshStart.daysSincePrevious) }} since the weigh-in before, so the trend restarted from this one. No line is drawn across the gap.</span>
    </div>
    <div v-if="profile.weight?.trendKg != null" class="row stats">
      <div class="col grow">
        <span class="row lblrow"><span class="t-capm c2">Trend</span><AccuracyDot v-if="low" from="weight" /></span>
        <span class="base"><span class="t-ns">{{ wt(profile.weight.trendKg) }}</span><span class="t-label c2">{{ weightUnit() }}</span></span>
        <span v-if="low" class="t-capn c2">low accuracy</span>
      </div>
      <div class="col grow">
        <span class="t-capm c2">This week</span>
        <span class="base">
          <template v-if="week != null"><span class="t-ns">{{ wtSigned(week) }}</span><span class="t-label c2">{{ weightUnit() }}</span></template>
          <span v-else class="t-ns c2"><span aria-hidden="true">—</span><span class="sr-only">{{ fresh ? "not available after a fresh start" : "not available yet" }}</span></span>
        </span>
      </div>
      <div class="col grow">
        <span class="t-capm c2">30 days</span>
        <span class="base">
          <template v-if="month != null"><span class="t-ns">{{ wtSigned(month) }}</span><span class="t-label c2">{{ weightUnit() }}</span></template>
          <span v-else class="t-ns c2"><span aria-hidden="true">—</span><span class="sr-only">{{ fresh ? "not available after a fresh start" : "not available yet" }}</span></span>
        </span>
      </div>
    </div>
    <p v-if="profile.weight?.trendKg != null" class="t-capn c2 m0">The trend smooths out day-to-day swings (water, salt, food), so one high or low weigh-in barely moves it.</p>
    <div class="col">
      <button v-for="row in history" :key="row.localDate" type="button" class="row hrow" @click="ui.weightDate = row.localDate">
        <span class="t-body c2 grow">{{ shortDate(row.localDate) }}</span>
        <span class="hval"><span class="t-bodys">{{ wt(row.kg) }}</span><span class="t-label c2"> {{ weightUnit() }}</span></span>
      </button>
    </div>
  </BottomSheet>
</template>

<style scoped>
/* Title and × share one row at every text size. The day stays on that row when it fits, and wraps under them when it does not. */
.hdr { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--space-s); }
.hdr.below { align-items: flex-start; }
.lead { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: center; gap: var(--space-s); min-width: 0; }
.htitle { flex: 1 1 auto; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.hclose { flex: none; }
.hdr.below .htitle { padding-top: max(0px, calc((44px - 1.2941rem) / 2)); }
.hdr.below .hclose { margin-top: max(0px, calc((1.2941rem - 44px) / 2)); }
.m0 { margin: 0; }
.daypick { position: relative; flex: 0 0 auto; min-width: 0; max-width: 100%; }
.daymeasure { position: absolute; visibility: hidden; white-space: nowrap; height: 0; overflow: hidden; pointer-events: none; }
.daybtn { display: inline-flex; align-items: center; gap: var(--space-xs); min-height: 44px; max-width: 100%; padding: 0 var(--space-s) 0 var(--space-m); border-radius: var(--radius-pill); background: var(--color-surface-2); color: var(--text-primary); }
.dayface { white-space: nowrap; overflow: hidden; min-width: 0; }
.daychev { flex: none; width: 8px; height: 8px; margin-right: var(--space-2xs); border-right: 1.5px solid var(--text-secondary); border-bottom: 1.5px solid var(--text-secondary); transform: translateY(-2px) rotate(45deg); }
.daymenu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 41; min-width: 220px; max-width: calc(100vw - 32px); max-height: min(70vh, 560px); overflow: auto; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-l); padding: var(--space-s); box-shadow: 0 12px 32px rgba(0, 0, 0, .6); display: flex; flex-direction: column; }
.dayopt { flex: none; display: flex; align-items: center; gap: var(--space-m); min-height: 44px; width: 100%; padding: 0 var(--space-m); border-radius: var(--radius-m); text-align: left; color: var(--text-primary); }
.dayopt[aria-selected="true"] { background: transparent; }
.dayopt:active { background: var(--color-hover); }
.hdr.below .daymenu { left: 0; right: auto; }
.dt-l .dayopt { padding: var(--space-s) var(--space-m); }
.dt-l .dayopt .grow { min-width: 0; overflow-wrap: anywhere; }
.dt-xl .dayopt { flex-wrap: wrap; align-items: flex-start; row-gap: 0; padding: var(--space-s) var(--space-m); }
.dt-xl .dayopt .grow { flex: 1 1 100%; overflow-wrap: break-word; }
.wfield { gap: var(--space-m); align-items: center; }
.wfield label { gap: var(--space-s); min-width: 0; }
.autosize { display: inline-grid; min-height: 44px; }
.autosize > * { grid-area: 1 / 1; }
.mirror { visibility: hidden; white-space: pre; padding-right: var(--space-xs); }
.wfig { font-size: 3rem; line-height: 1.1; font-weight: 700; letter-spacing: -0.03em; }
.winput {
  width: 0; min-width: 100%; min-height: 44px; background: transparent;
  border: 0; outline: none; box-shadow: none; padding: 0 var(--space-xs); border-radius: var(--radius-m);
  caret-color: var(--text-primary); font-size: 3rem;
}
.winput::placeholder { color: var(--text-tertiary); opacity: 1; }
.winput:focus, .winput:focus-visible {
  outline: none; border: 0; box-shadow: none;
  background: var(--color-surface-2);
}
.cbtn.filled { --s: var(--control-hit); }
.legend, .lg, .lblrow, .tgb { gap: var(--space-s); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(125, 177, 255, .75); display: inline-block; }
.dash { width: 14px; height: 3px; border-radius: 2px; background: var(--chart-line); display: inline-block; }
.stats { gap: var(--space-s); align-items: flex-start; flex-wrap: wrap; }
.stats .col { gap: var(--space-2xs); min-width: 5.5rem; }
.wempty, .fresh, .tguard { gap: var(--space-s); }
.card.fresh { border-style: dashed; border-color: var(--text-tertiary); }
.tgb { flex-wrap: wrap; }
.tguard:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.hrow { min-height: 44px; border-top: 1px solid var(--color-border); width: 100%; text-align: left; }
.dt-xl .hrow { flex-wrap: wrap; align-items: flex-start; }
.dt-xl .hrow > .grow { flex: 1 0 100%; }
.hval { display: inline-flex; align-items: baseline; white-space: nowrap; flex: none; }
.only { gap: var(--space-m); align-items: center; }
.only p { min-width: 0; text-wrap: pretty; }
.dt-xl .only { flex-wrap: wrap; }
</style>
