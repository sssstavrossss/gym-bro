<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ConfirmWeighInBody } from "../api";
import BottomSheet from "./BottomSheet.vue";
import AccuracyDot from "./AccuracyDot.vue";
import Icon from "./Icon.vue";
import WeightChart from "./WeightChart.vue";
import { dayMonth, diffDays, shortDate, todayIso } from "../lib/dates";
import { kg, signed, typoGuardDetail } from "../lib/format";
import { parseDecimal } from "../lib/numbers";
import { earliestNewWeighInDate, gapLabel, isFreshStart, isLowAccuracy, newWeighInDates, trendChange } from "../lib/weightDisplay";
import { profile, removeWeighIn, saveWeighIn } from "../state/profile";
import { closeSheet, toast, ui } from "../ui";
import { vp } from "../lib/viewport";

const open = computed(() => ui.sheet === "weight");
const value = ref("");
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
    return { value: date, title, kgText: own ? kg(own.kg) : "" };
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

function prefill() {
  const own = ownKg.value;
  const latest = profile.weight?.latestKg;
  value.value = own != null ? kg(own) : latest != null ? kg(latest) : "";
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
  prefill();
  await nextTick();
  watchDayFit();
  input.value?.focus({ preventScroll: true });
});
watch(() => ui.weightDate, () => {
  if (!open.value) return;
  confirm.value = null;
  prefill();
});

const parsed = computed(() => {
  const number = parseDecimal(value.value);
  return number != null && number >= 30 && number <= 300 ? Math.round(number * 10) / 10 : null;
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
  if (ownKg.value != null) return `${ui.weightDate === today.value ? "Today's" : "This day's"} weigh-in is ${kg(ownKg.value)} kg · saving replaces it`;
  const earlier = profile.weighIns.filter((row) => row.localDate < ui.weightDate);
  const prev = earlier[0];
  if (!prev) return "First weigh-in";
  const ago = diffDays(ui.weightDate, prev.localDate);
  return `Last weigh-in ${kg(prev.kg)} kg ${ago === 1 ? "yesterday" : `${ago} days before`}`;
});

async function save(force = false) {
  if (parsed.value == null) {
    localError.value = "Enter a weight between 30 and 300 kg, e.g. 83,4 or 83.4";
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
    : `trend now ${trend.trendKg != null ? kg(trend.trendKg) : "—"} kg${isLowAccuracy(trend) ? " · low accuracy" : ""}`;
  toast(replaced ? `Replaced the weigh-in with ${kg(result.saved.kg)} kg · ${note}` : `Saved ${kg(result.saved.kg)} kg · ${note}`);
  closeSheet();
}

function fix() {
  confirm.value = null;
  void nextTick(() => {
    input.value?.focus();
    input.value?.select();
  });
}

function editOnly() {
  void nextTick(() => {
    input.value?.focus();
    input.value?.select();
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
  toast(`Deleted weigh-in ${kg(kilograms)} kg · ${shortDate(date)}`, {
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
  confirm.value ? typoGuardDetail(confirm.value.kg, confirm.value.previousTrendKg) : ""
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
        <button type="button" class="cbtn hclose" aria-label="Close" @click="closeSheet">×</button>
      </div>
    </template>
    <form class="row wfield" @submit.prevent="save(false)">
      <label class="base grow">
        <span class="sr-only">Weight in kilograms</span>
        <span class="autosize t-dxl">
          <span class="mirror" aria-hidden="true">{{ value || "0" }}</span>
          <input ref="input" v-model="value" class="t-dxl winput" size="1" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="Weight in kilograms" @focus="($event.target as HTMLInputElement).select()" />
        </span>
        <span class="t-head c2">kg</span>
      </label>
      <button type="button" class="cbtn filled" aria-label="Save weight" :disabled="parsed === null" @click="save(false)">✓</button>
    </form>
    <div v-if="confirm" ref="confirmEl" class="tguard col" role="alertdialog" aria-labelledby="tg-h" aria-describedby="tg-d" tabindex="-1">
      <h3 id="tg-h" class="t-head m0">Is {{ kg(confirm.kg) }} kg right?</h3>
      <p id="tg-d" class="t-label c2 m0">{{ diffText }}</p>
      <div class="row tgb">
        <button type="button" class="chip on t-label big" @click="fix">Fix it</button>
        <button type="button" class="chip t-label big" @click="save(true)">Yes, save {{ kg(confirm.kg) }} kg</button>
      </div>
    </div>
    <p v-if="invalid || localError" class="t-label m0" role="alert">{{ localError || "Enter a weight between 30 and 300 kg, e.g. 83,4 or 83.4" }}</p>
    <template v-else-if="onlyWeighIn">
      <p class="t-capn c3 m0">{{ hint }}</p>
      <div class="row only">
        <p class="t-capn c2 m0 grow">This is your only weigh-in, so it can't be deleted.</p>
        <button type="button" class="chip t-label editb" aria-label="Edit your only weigh-in" @click="editOnly">Edit</button>
      </div>
    </template>
    <p v-else class="t-capn c2 m0">{{ hint }}<template v-if="canDelete"> · <button type="button" class="dlink" @click="del">Delete</button></template></p>
    <div v-if="!profile.weighIns.length" class="wempty col">
      <span class="t-label c2">Your chart starts with this weigh-in</span>
      <span class="t-capn c2">Your trend starts with it, and gets more accurate with 2+ weigh-ins a week.</span>
    </div>
    <div v-else-if="profile.chart" class="card chart-card">
      <div class="row legend">
        <span class="t-cap c2">Last 30 days</span>
        <span class="grow" />
        <span class="row lg"><i class="dot" /> <span class="t-capn c2">weigh-in</span></span>
        <span class="row lg"><i class="dash" /> <span class="t-capn c2">trend</span></span>
      </div>
      <WeightChart :series="profile.chart.series" :fluid="vp.tablet" />
    </div>
    <div v-if="fresh && profile.weight?.freshStart" class="fresh col">
      <span class="t-bodys">Fresh start</span>
      <span class="t-label c2">It had been {{ gapLabel(profile.weight.freshStart.daysSincePrevious) }} since the weigh-in before, so the trend restarted from this one. No line is drawn across the gap.</span>
    </div>
    <div v-if="profile.weight?.trendKg != null" class="row stats">
      <div class="col grow">
        <span class="row lblrow"><span class="t-capm c2">Trend</span><AccuracyDot v-if="low" from="weight" /></span>
        <span class="base"><span class="t-ns">{{ kg(profile.weight.trendKg) }}</span><span class="t-label c2">kg</span></span>
        <span v-if="low" class="t-capn c2">low accuracy</span>
      </div>
      <div class="col grow">
        <span class="t-capm c2">This week</span>
        <span class="base">
          <template v-if="week != null"><span class="t-ns">{{ signed(week) }}</span><span class="t-label c2">kg</span></template>
          <span v-else class="t-ns c2"><span aria-hidden="true">—</span><span class="sr-only">{{ fresh ? "not available after a fresh start" : "not available yet" }}</span></span>
        </span>
      </div>
      <div class="col grow">
        <span class="t-capm c2">30 days</span>
        <span class="base">
          <template v-if="month != null"><span class="t-ns">{{ signed(month) }}</span><span class="t-label c2">kg</span></template>
          <span v-else class="t-ns c2"><span aria-hidden="true">—</span><span class="sr-only">{{ fresh ? "not available after a fresh start" : "not available yet" }}</span></span>
        </span>
      </div>
    </div>
    <p v-if="profile.weight?.trendKg != null" class="t-capn c2 m0">The trend smooths out day-to-day swings (water, salt, food), so one high or low weigh-in barely moves it.</p>
    <div class="col">
      <button v-for="row in history" :key="row.localDate" type="button" class="row hrow" @click="ui.weightDate = row.localDate">
        <span class="t-body c2 grow">{{ shortDate(row.localDate) }}</span>
        <span class="hval"><span class="t-bodys">{{ kg(row.kg) }}</span><span class="t-label c2"> kg</span></span>
      </button>
    </div>
  </BottomSheet>
</template>

<style scoped>
/* Title and × share one row at every text size. The day stays on that row when it fits, and wraps under them when it does not. */
.hdr { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; }
.hdr.below { align-items: flex-start; }
.lead { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.htitle { flex: 1 1 auto; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.hclose { flex: none; }
.hdr.below .htitle { padding-top: max(0px, calc((44px - 1.2941rem) / 2)); }
.hdr.below .hclose { margin-top: max(0px, calc((1.2941rem - 44px) / 2)); }
.m0 { margin: 0; }
.daypick { position: relative; flex: 0 0 auto; min-width: 0; max-width: 100%; }
.daymeasure { position: absolute; visibility: hidden; white-space: nowrap; height: 0; overflow: hidden; pointer-events: none; }
.daybtn { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; max-width: 100%; padding: 0 10px 0 12px; border-radius: 16px; background: var(--color-surface-2); color: var(--text-primary); }
.dayface { white-space: nowrap; overflow: hidden; min-width: 0; }
.daychev { flex: none; width: 8px; height: 8px; margin-right: 2px; border-right: 1.5px solid var(--text-secondary); border-bottom: 1.5px solid var(--text-secondary); transform: translateY(-2px) rotate(45deg); }
.daymenu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 41; min-width: 220px; max-width: calc(100vw - 32px); max-height: min(70vh, 560px); overflow: auto; background: #2f2f34; border-radius: 14px; padding: 6px; box-shadow: 0 12px 32px rgba(0, 0, 0, .6); display: flex; flex-direction: column; }
.dayopt { flex: none; display: flex; align-items: center; gap: 10px; min-height: 44px; width: 100%; padding: 0 10px; border-radius: 10px; text-align: left; color: var(--text-primary); }
.dayopt[aria-selected="true"] { background: transparent; }
.dayopt:active { background: #3a3a40; }
.hdr.below .daymenu { left: 0; right: auto; }
.dt-l .dayopt { padding: 6px 10px; }
.dt-l .dayopt .grow { min-width: 0; overflow-wrap: anywhere; }
.dt-xl .dayopt { flex-wrap: wrap; align-items: flex-start; row-gap: 0; padding: 8px 10px; }
.dt-xl .dayopt .grow { flex: 1 1 100%; overflow-wrap: break-word; }
.wfield { gap: 12px; align-items: center; }
.wfield label { gap: 6px; min-width: 0; }
.autosize { display: inline-grid; min-height: 44px; }
.autosize > * { grid-area: 1 / 1; }
.mirror { visibility: hidden; white-space: pre; padding-right: 4px; }
.winput { width: 0; min-width: 100%; min-height: 44px; background: transparent; border: 0; padding: 0; caret-color: #fff; }
.cbtn { width: 44px; height: 44px; font-size: 1.25rem; }
.cbtn.filled { width: 56px; height: 56px; background: var(--color-action); color: var(--color-on-action); border-radius: 50%; }
.cbtn.filled:disabled { opacity: .35; }
.chart-card { background: var(--color-surface-2); gap: 10px; }
.legend, .lg, .lblrow, .tgb { gap: 8px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(125, 177, 255, .75); display: inline-block; }
.dash { width: 14px; height: 3px; border-radius: 2px; background: var(--chart-line); display: inline-block; }
.stats { gap: 8px; align-items: flex-start; flex-wrap: wrap; }
.stats .col { gap: 2px; min-width: 5.5rem; }
.wempty, .fresh, .tguard { gap: 8px; padding: 14px; border-radius: 14px; border: 1px solid var(--color-border); }
.fresh { border-style: dashed; border-color: var(--text-tertiary); }
.tguard { border-color: var(--color-border-strong); }
.tgb { flex-wrap: wrap; }
.tguard:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.chip.big { min-height: 44px; padding: 0 16px; border-radius: 22px; color: var(--text-primary); }
.chip.big.on { color: var(--color-on-action); }
.hrow { min-height: 44px; border-top: 1px solid var(--color-border); width: 100%; text-align: left; }
.dt-xl .hrow { flex-wrap: wrap; align-items: flex-start; }
.dt-xl .hrow > .grow { flex: 1 0 100%; }
.hval { display: inline-flex; align-items: baseline; white-space: nowrap; flex: none; }
.dlink { color: var(--text-secondary); text-decoration: underline; text-underline-offset: 2px; min-height: 44px; min-width: 44px; }
.only { gap: 12px; align-items: center; margin-top: -6px; }
.only p { min-width: 0; text-wrap: pretty; }
.editb { height: 44px; min-height: 44px; min-width: 44px; padding: 0 18px; border-radius: 22px; color: var(--text-primary); flex: none; }
.dt-xl .only { flex-wrap: wrap; }
</style>
