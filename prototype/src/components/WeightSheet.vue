<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import CircleBtn from "./CircleBtn.vue";
import Icon from "./Icon.vue";
import MealPicker from "./MealPicker.vue";
import WeightChart from "./WeightChart.vue";
import { addDays, dayMonth, diffDays, shortDate } from "../lib/dates";
import { kg, signed } from "../lib/format";
import { deleteWeight, hasWeights, latestWeighIn, saveWeight, state, today, trend, trendShown, trendWeight, weighInsLast7 } from "../store";
import { closeSheet, toast, ui } from "../ui";
import { vp } from "../lib/viewport";

const open = computed(() => ui.sheet === "weight");
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
  if (!o) return;
  prefill();
  await nextTick();
  input.value?.focus({ preventScroll: true });
});
watch(() => ui.weightDate, prefill);

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
  const replaced = state.weights[ui.weightDate];
  saveWeight(ui.weightDate, parsed.value);
  input.value?.blur();
  closeSheet();
  const t = trendShown(today) ? `trend now ${kg(trendWeight.value)} kg` : `${weighInsLast7(today)} of 3 weigh-ins for a trend`;
  toast(replaced !== undefined ? `Replaced ${kg(replaced)} with ${kg(parsed.value)} kg · ${t}` : `Saved ${kg(parsed.value)} kg · ${t}`);
}
function del() {
  const d = ui.weightDate, old = state.weights[d];
  if (old === undefined) return;
  deleteWeight(d);
  closeSheet();
  toast(`Deleted weigh-in ${kg(old)} kg · ${shortDate(d)}`, { label: "Undo", run: () => saveWeight(d, old) });
}

const stats = computed(() => {
  const t = trend(today) ?? trendWeight.value;
  const wk = trend(addDays(today, -7));
  const m = trend(addDays(today, -29));
  return { avg: t, week: wk != null ? t - wk : 0, month: m != null ? t - m : 0 };
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
      <p v-if="invalid" class="t-label m0 verr" role="alert">Enter a weight between 30 and 300 kg, e.g. 83,4 or 83.4</p>
      <p v-else class="t-capn c3 m0">{{ hint }}<template v-if="state.weights[ui.weightDate] !== undefined"> · <button type="button" class="t-capn dlink" @click="del">Delete</button></template></p>
      <div v-if="!hasWeights" class="wempty col"><span class="t-label c2">Your chart starts with this weigh-in</span><span class="t-capn c3">The trend appears after 3 weigh-ins within 7 days.</span></div>
      <div v-else class="card chart-card">
        <div class="row legend">
          <span class="t-cap c3">Last 30 days</span><span class="grow" />
          <span class="row lg"><i class="dot" /> <span class="t-capn c2">weigh-in</span></span>
          <span class="row lg"><i class="dash" /> <span class="t-capn c2">trend</span></span>
        </div>
        <WeightChart :end="today" :fluid="vp.tablet" />
      </div>
      <div v-if="hasWeights && !trendShown(today)" class="notready col">
        <span class="t-bodys">Trend not ready</span>
        <span class="t-label c2">{{ weighInsLast7(today) }} of 3 weigh-ins in the last 7 days. The trend smooths out day-to-day swings, so it needs a few points first.</span>
      </div>
      <div v-else-if="hasWeights" class="row stats">
        <div class="col grow"><span class="t-capm c2">Trend</span><span class="base"><span class="t-ns">{{ kg(stats.avg) }}</span><span class="t-label c2">kg</span></span></div>
        <div class="col grow"><span class="t-capm c2">This week</span><span class="base"><span class="t-ns">{{ signed(stats.week) }}</span><span class="t-label c2">kg</span></span></div>
        <div class="col grow"><span class="t-capm c2">30 days</span><span class="base"><span class="t-ns">{{ signed(stats.month) }}</span><span class="t-label c2">kg</span></span></div>
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
.notready { gap: 4px; padding: 12px 14px; border-radius: 12px; border: 1px dashed var(--text-tertiary); }
.hrow { min-height: 44px; border-top: 1px solid var(--color-border); width: 100%; text-align: left; }
.thint { gap: 6px; align-items: flex-start; }
.thint svg { margin-top: 1px; }
.dlink { position: relative; }
.dlink::after { content: ""; position: absolute; inset: -14px -8px; }
</style>
