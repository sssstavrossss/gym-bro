<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import CircleBtn from "./CircleBtn.vue";
import Icon from "./Icon.vue";
import MealPicker from "./MealPicker.vue";
import WeightChart from "./WeightChart.vue";
import AccuracyDot from "./AccuracyDot.vue";
import { addDays, dayMonth, diffDays, shortDate } from "../lib/dates";
import { kg, signed } from "../lib/format";
import { checkTypo, deleteWeight, freshPrompt, hasWeights, latestWeighIn, lowAccuracy, saveWeight, state, today, trend, trendInfo, trendWeight } from "../store";
import { gapLabel } from "../lib/trend";
import { closeSheet, toast, ui } from "../ui";
import { vp } from "../lib/viewport";

const open = computed(() => ui.sheet === "weight");
let returning = false;
/** S8 Q5 typo guard: more than 3.0 kg from the previous day's trend → ask before saving. */
const confirm = ref<null | { kg: number; ref: number; diff: number }>(null);
const confirmEl = ref<HTMLElement | null>(null);
const value = ref("");
const input = ref<HTMLInputElement | null>(null);

const dayOptions = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, -i);
    return { value: d, label: i === 0 ? `Today, ${dayMonth(d)}` : i === 1 ? `Yesterday, ${dayMonth(d)}` : shortDate(d), hint: state.weights[d] ? kg(state.weights[d]) : "" };
  }),
);
const dayLabel = computed(() => dayOptions.value.find((o) => o.value === ui.weightDate)?.label.replace("Yesterday", "Yest.") ?? shortDate(ui.weightDate));
const date = computed({ get: () => ui.weightDate, set: (v: string) => (ui.weightDate = v) });

function prefill() {
  const own = state.weights[ui.weightDate];
  const last = latestWeighIn(ui.weightDate);
  value.value = kg(own ?? last?.kg ?? trendWeight.value);
}
watch(open, async (o) => {
  confirm.value = null;
  if (!o) return;
  if (returning) { returning = false; return; } // back from the accuracy sheet: keep what was typed
  prefill();
  if (ui.weightDraft) { value.value = ui.weightDraft; ui.weightDraft = null; await nextTick(); save(); return; }
  await nextTick();
  input.value?.focus({ preventScroll: true });
}, { immediate: true });
watch(() => ui.sheet, (s) => { if (s === "accuracy" && ui.accReturn === "weight") returning = true; });
watch(() => ui.weightDate, () => { confirm.value = null; prefill(); });
watch(value, () => { if (confirm.value && confirm.value.kg !== parsed.value) confirm.value = null; });


const hint = computed(() => {
  if (state.weights[ui.weightDate] !== undefined) return `${ui.weightDate === today ? "Today's" : "This day's"} weigh-in is ${kg(state.weights[ui.weightDate])} kg · saving replaces it`;
  const prev = latestWeighIn(addDays(ui.weightDate, -1));
  if (!prev) return "First weigh-in";
  const ago = diffDays(ui.weightDate, prev.date);
  return `Defaults to ${ui.weightDate === today ? "today" : "this day"} · last weigh-in ${kg(prev.kg)} kg ${ago === 1 ? "yesterday" : `${ago} days before`}`;
});

const parsed = computed(() => {
  const n = Number(value.value.replace(",", "."));
  return n >= 30 && n <= 300 ? n : null;
});
const invalid = computed(() => value.value.trim() !== "" && parsed.value === null);
function save() {
  if (parsed.value === null) { input.value?.focus(); return; }
  const v = Math.round(parsed.value * 10) / 10;
  if (!confirm.value || confirm.value.kg !== v) {
    const c = checkTypo(ui.weightDate, v);
    if (c.ask && c.ref != null) { confirm.value = { kg: v, ref: c.ref, diff: c.diff }; input.value?.blur(); nextTick(() => confirmEl.value?.focus({ preventScroll: true })); return; }
  }
  commit(v);
}
function commit(v: number) {
  const replaced = state.weights[ui.weightDate];
  saveWeight(ui.weightDate, v);
  confirm.value = null;
  input.value?.blur();
  closeSheet();
  const t = freshPrompt.value ? `fresh start after ${gapLabel(freshPrompt.value.gapDays)}` : `trend now ${kg(trendWeight.value)} kg${lowAccuracy.value ? " · low accuracy" : ""}`;
  toast(replaced !== undefined ? `Replaced ${kg(replaced)} with ${kg(v)} kg · ${t}` : `Saved ${kg(v)} kg · ${t}`);
}
/** Cancel saves nothing: back to the number, selected, to fix it. */
function fix() { confirm.value = null; nextTick(() => { input.value?.focus(); input.value?.select(); }); }
function del() {
  const d = ui.weightDate, old = state.weights[d];
  if (old === undefined) return;
  deleteWeight(d);
  closeSheet();
  toast(`Deleted weigh-in ${kg(old)} kg · ${shortDate(d)}`, { label: "Undo", run: () => saveWeight(d, old) });
}

const stats = computed(() => {
  const t = trend(today) ?? trendWeight.value;
  // across a fresh start the old trend isn't comparable: no change shown
  const fresh = trendInfo.value.state === "fresh_start";
  const wk = fresh ? null : trend(addDays(today, -7));
  const m = fresh ? null : trend(addDays(today, -29));
  return { avg: t, week: wk != null ? t - wk : null, month: m != null ? t - m : null };
});
const history = computed(() =>
  Object.keys(state.weights).filter((d) => d !== ui.weightDate && d <= today).sort().reverse().slice(0, 4).map((d) => ({ d, w: state.weights[d] })),
);
</script>

<template>
  <BottomSheet :open="open" label="Log weight" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head">Log weight</h2>
        <span class="grow" />
        <MealPicker v-model="date" :label="dayLabel" :options="dayOptions" />
        <CircleBtn icon="x" label="Close" @click="closeSheet" />
      </div>
    </template>
    <div class="scroll">
      <form class="row wfield" @submit.prevent="save">
        <label class="base grow">
          <span class="autosize t-dxl">
            <span class="mirror" aria-hidden="true">{{ value || "0" }}</span>
            <input ref="input" v-model="value" class="t-dxl winput" size="1" inputmode="decimal" enterkeyhint="done" autocomplete="off"
              aria-label="Weight in kilograms" @focus="($event.target as HTMLInputElement).select()" />
          </span>
          <span class="t-head c2">kg</span>
        </label>
        <CircleBtn icon="check" :size="56" filled label="Save weight" :disabled="parsed === null" @click="save" />
      </form>
      <div v-if="confirm" ref="confirmEl" class="tguard col" role="alertdialog" aria-labelledby="tg-h" aria-describedby="tg-d" tabindex="-1">
        <h3 id="tg-h" class="t-head m0">Is {{ kg(confirm.kg) }} kg right?</h3>
        <p id="tg-d" class="t-label c2 m0">That's {{ kg(Math.abs(confirm.diff)) }} kg {{ confirm.diff < 0 ? "below" : "above" }} your trend ({{ kg(confirm.ref) }} kg). Nothing is saved until you choose.</p>
        <div class="row tgb">
          <button type="button" class="chip on t-label big" @click="fix">Fix it</button>
          <button type="button" class="chip t-label big" @click="commit(confirm.kg)">Yes, save {{ kg(confirm.kg) }} kg</button>
        </div>
      </div>
      <p v-if="invalid" class="t-label m0 verr" role="alert">Enter a weight between 30 and 300 kg, e.g. 83,4 or 83.4</p>
      <p v-else class="t-capn c3 m0">{{ hint }}<template v-if="state.weights[ui.weightDate] !== undefined"> · <button type="button" class="t-capn dlink" @click="del">Delete</button></template></p>
      <div v-if="!hasWeights" class="wempty col"><span class="t-label c2">Your chart starts with this weigh-in</span><span class="t-capn c3">Your trend starts with it, and gets more accurate with 2+ weigh-ins a week.</span></div>
      <div v-else class="card chart-card">
        <div class="row legend">
          <span class="t-cap c3">Last 30 days</span><span class="grow" />
          <span class="row lg"><i class="dot" /> <span class="t-capn c2">weigh-in</span></span>
          <span class="row lg"><i class="dash" /> <span class="t-capn c2">trend</span></span>
        </div>
        <WeightChart :end="today" :fluid="vp.tablet" />
      </div>
      <div v-if="trendInfo.state === 'fresh_start'" class="fresh col">
        <span class="t-bodys">Fresh start</span>
        <span class="t-label c2">It had been {{ gapLabel(trendInfo.freshGapDays ?? 29) }} since the weigh-in before, so the trend restarted from this one. No line is drawn across the gap.</span>
      </div>
      <div v-if="hasWeights" class="row stats">
        <div class="col grow"><span class="row lblrow"><span class="t-capm c2">Trend</span><AccuracyDot v-if="lowAccuracy" /></span><span class="base"><span class="t-ns">{{ kg(stats.avg) }}</span><span class="t-label c2">kg</span></span><span v-if="lowAccuracy" class="t-capn c2">low accuracy</span></div>
        <div class="col grow"><span class="t-capm c2">This week</span><span class="base"><template v-if="stats.week != null"><span class="t-ns">{{ signed(stats.week) }}</span><span class="t-label c2">kg</span></template><span v-else class="t-ns c2"><span aria-hidden="true">—</span><span class="sr-only">not available after a fresh start</span></span></span></div>
        <div class="col grow"><span class="t-capm c2">30 days</span><span class="base"><template v-if="stats.month != null"><span class="t-ns">{{ signed(stats.month) }}</span><span class="t-label c2">kg</span></template><span v-else class="t-ns c2"><span aria-hidden="true">—</span><span class="sr-only">not available after a fresh start</span></span></span></div>
      </div>
      <!-- item 0: one line on what the trend is -->
      <p v-if="hasWeights" class="t-capn c2 m0 thint row"><Icon name="info" :size="14" :sw="2" />The trend smooths out day-to-day swings (water, salt, food), so one high or low weigh-in barely moves it.</p>
      <div class="col">
        <button v-for="h in history" :key="h.d" type="button" class="row hrow" @click="date = h.d">
          <span class="t-body c2 grow">{{ shortDate(h.d) }}</span>
          <span class="t-bodys">{{ kg(h.w) }}</span><span class="t-label c3">&nbsp;kg</span>
        </button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; }
.scroll { flex: 1 1 auto; overflow-y: auto; margin: 0 -16px; padding: 0 16px 8px; display: flex; flex-direction: column; gap: 12px; overscroll-behavior: contain; }
.m0 { margin: 0; }
.wfield { gap: 12px; padding: 8px 0 4px; }
.wfield label { gap: 6px; }
.autosize { display: inline-grid; }
.autosize > * { grid-area: 1 / 1; }
.mirror { visibility: hidden; white-space: pre; padding-right: 4px; }
.winput { width: 0; min-width: 100%; background: transparent; border: 0; outline: 0; padding: 0; margin: 0; caret-color: #fff; border-radius: 0; -webkit-appearance: none; appearance: none; }
.chart-card { background: var(--color-surface-2); gap: 10px; }
.legend { gap: 12px; }
.lg { gap: 6px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(125, 177, 255, 0.75); display: inline-block; }
.dash { width: 14px; height: 3px; border-radius: 2px; background: var(--chart-line); display: inline-block; }
.stats { gap: 8px; align-items: flex-start; }
.stats .col { gap: 2px; }
.verr { color: var(--text-primary); }
.dlink { color: var(--text-secondary); text-decoration: underline; text-underline-offset: 2px; padding: 0; }
.wempty { gap: 4px; padding: 28px 16px; border-radius: 12px; border: 1px dashed var(--color-border); align-items: center; text-align: center; }
.fresh { gap: 4px; padding: 12px 14px; border-radius: 12px; border: 1px dashed var(--text-tertiary); }
.tguard { gap: 8px; padding: 14px; border-radius: 14px; background: transparent; border: 1px solid var(--color-border-strong); outline: none; }
.tguard:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.tgb { gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.chip.big { min-height: 44px; padding: 0 16px; border-radius: 22px; color: var(--text-primary); }
.chip.big.on { color: var(--color-on-action); }
.lblrow { gap: 8px; align-items: center; }
.hrow { min-height: 44px; border-top: 1px solid var(--color-border); width: 100%; text-align: left; }
.thint { gap: 6px; align-items: flex-start; }
.thint svg { margin-top: 1px; }
.dlink { position: relative; }
.dlink::after { content: ""; position: absolute; inset: -14px -8px; }
</style>
