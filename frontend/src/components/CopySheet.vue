<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { acceptCopyDate, copyDates, copyDayLabel } from "../lib/copyDays";
import { addDays, shortDate, todayInZone } from "../lib/dates";
import { int } from "../lib/format";
import { deviceTimeZone } from "../state/profile";
import { copySelected, discardCopies, findEntry, viewed, type LogEntry } from "../state/log";
import { closeCopy, endSelect, toast, ui } from "../ui";

const router = useRouter();
const open = computed(() => ui.sheet === "copy");
const today = computed(() => viewed.today || todayInZone(deviceTimeZone()));
const setup = computed(() => viewed.setupDate);
const list = computed(() => ui.selected
  .map((id) => findEntry(id))
  .filter((entry): entry is LogEntry => entry !== null)
  .sort((a, b) => a.time.localeCompare(b.time)));
const from = computed(() => list.value[0]?.localDate ?? today.value);
const kcal = computed(() => list.value.reduce((sum, entry) => sum + entry.kcal, 0));
const days = computed(() => copyDates(today.value, setup.value));
const target = ref(today.value);
const custom = ref("");
const error = ref("");
const saving = ref(false);
const keys = ref<Record<string, string>>({});

watch(open, (isOpen) => {
  if (!isOpen) return;
  target.value = today.value;
  custom.value = "";
  error.value = "";
  const next: Record<string, string> = {};
  for (const entry of list.value) next[entry.id] = crypto.randomUUID();
  keys.value = next;
});

function named(day: string): string {
  return copyDayLabel(day, today.value) ?? shortDate(day);
}
function choose(day: string) {
  if (!acceptCopyDate(day, today.value, setup.value)) return;
  target.value = day;
  custom.value = days.value.includes(day) ? "" : day;
}
function pickCustom(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (acceptCopyDate(value, today.value, setup.value)) choose(value);
}
const times = computed(() => {
  const rows = list.value;
  if (!rows.length) return "";
  return rows[0].time === rows[rows.length - 1].time ? rows[0].time : `${rows[0].time}–${rows[rows.length - 1].time}`;
});
const buttonLabel = computed(() => {
  const name = named(target.value);
  if (name === "Today") return "today";
  if (name === "Yesterday") return "yesterday";
  return shortDate(target.value);
});

async function copy() {
  if (saving.value || !list.value.length) return;
  if (!acceptCopyDate(target.value, today.value, setup.value)) {
    error.value = "That date is in the future.";
    return;
  }
  saving.value = true;
  error.value = "";
  const rows = list.value.slice();
  const result = await copySelected(rows, target.value, keys.value);
  saving.value = false;
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  const copies = result.copies;
  const count = rows.length;
  const total = kcal.value;
  const to = target.value;
  const source = from.value;
  ui.copySingle = false;
  endSelect();
  closeCopy();
  const place = named(to).replace(/^T/, "t").replace(/^Y/, "y");
  toast(`Copied ${count} item${count > 1 ? "s" : ""} · ${int(total)} kcal to ${place}`, {
    label: "Undo",
    run: () => { void discardCopies(copies); },
  });
  if (to !== source) void router.push(to === today.value ? "/log" : `/log/${to}`);
}
</script>

<template>
  <BottomSheet :open="open" label="Copy to" @close="closeCopy">
    <template #header>
      <div class="row hdr">
        <div class="col grow">
          <h2 class="t-head">Copy {{ list.length }} item{{ list.length === 1 ? "" : "s" }} to…</h2>
          <span class="t-label c2">{{ int(kcal) }} kcal · from {{ named(from) }}</span>
        </div>
        <button type="button" class="cbtn" style="--s: 44px" aria-label="Close" @click="closeCopy">
          <Icon name="x" :size="18" />
        </button>
      </div>
    </template>
    <div class="opts col" role="radiogroup" aria-label="Day">
      <button
        v-for="day in days"
        :key="day"
        type="button"
        role="radio"
        :aria-checked="target === day"
        class="opt row"
        :class="{ on: target === day }"
        @click="choose(day)"
      >
        <span class="t-body grow">{{ named(day) }}<span v-if="day === from" class="c3"> · same day (duplicate)</span></span>
        <span class="t-label c3">{{ day === today || day === addDays(today, -1) ? shortDate(day) : "" }}</span>
        <span class="radio" :class="{ on: target === day }"><Icon v-if="target === day" name="check" :size="12" :sw="3.2" /></span>
      </button>
      <label class="opt row" :class="{ on: !!custom && target === custom }">
        <span class="t-body grow">{{ custom ? named(custom) : "Another date…" }}</span>
        <Icon name="cal" :size="16" class="c2" />
        <input
          class="dinput"
          type="date"
          :min="setup || undefined"
          :max="today"
          :value="custom"
          aria-label="Pick another date"
          @change="pickCustom"
        />
      </label>
    </div>
    <p class="t-label c2 note"><Icon name="clock" :size="13" /> Times are kept ({{ times }}). Tap an entry afterwards to change it.</p>
    <p v-if="error" class="t-label err" role="alert">{{ error }}</p>
    <button type="button" class="primary-btn t-bodys" :disabled="saving || !list.length" @click="copy">
      {{ saving ? "Copying…" : `Copy to ${buttonLabel}` }}
    </button>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; align-items: flex-start; }
.opts { gap: 0; }
.opt { position: relative; min-height: 48px; gap: 10px; border-bottom: 1px solid var(--color-border); text-align: left; width: 100%; }
.radio { width: 22px; height: 22px; border-radius: 11px; border: 1.5px solid var(--text-tertiary); display: flex; align-items: center; justify-content: center; flex: none; }
.radio.on { background: var(--color-action); border-color: var(--color-action); color: var(--color-on-action); }
.dinput { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; font-size: 16px; }
.note { margin: 0; display: flex; align-items: center; gap: 6px; }
.err { margin: 0; color: var(--text-primary); }
.can-hover .opt:hover { background: rgba(255, 255, 255, .03); }
</style>
