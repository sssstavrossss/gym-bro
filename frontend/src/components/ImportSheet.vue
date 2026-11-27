<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import ExerciseBrowser from "./ExerciseBrowser.vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";
import { ApiError, importWorkouts, matchExercises, ServerUnreachable } from "../api";
import { batches, fileLine, importRequests, readExport, type ImportFile, type ImportUnit, type WorkoutApp } from "../lib/importCsv";
import { todayInZone } from "../lib/dates";
import { exercises, loadExercises } from "../state/exercises";
import { deviceTimeZone } from "../state/profile";
import { weightUnit } from "../state/units";
import { loadHistory } from "../state/workout";
import { closeImport, toast, ui } from "../ui";

// Train → Trained before? → Import: read a Strong or Hevy export on the phone, match its exercises to the library
// (the server suggests, the person picks the rest), then send the workouts a hundred at a time.
const open = computed(() => ui.sheet === "import" || (ui.importOver && ui.sheet !== null));
watch(() => ui.sheet, () => { ui.importOver = false; });
const app = ref<WorkoutApp>("strong");
const fileName = ref("");
const file = ref<ImportFile | null>(null);
const fileError = ref("");
const matches = ref<Record<string, string | null>>({});
/** The names the server couldn't match, in file order; they stay in place once picked. */
const toMatch = ref<string[]>([]);
const matchState = ref<"idle" | "loading" | "ready" | "failed">("idle");
const unit = ref<ImportUnit>("kg");
const picking = ref<string | null>(null);
const sending = ref<{ done: number; total: number } | null>(null);
const sendError = ref("");
const input = ref<HTMLInputElement | null>(null);

const APPS = [{ value: "strong", label: "Strong" }, { value: "hevy", label: "Hevy" }];
const UNITS = [{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }];
const HOW: Record<WorkoutApp, string> = {
  strong: "In Strong, open Settings and Export data, then pick the CSV file here.",
  hevy: "In Hevy, open Settings and Export workouts, then pick the CSV file here.",
};
const MAX_BYTES = 20 * 1024 * 1024;

watch(open, (shown) => {
  if (!shown) return;
  reset();
  unit.value = weightUnit();
  void loadExercises();
});

function reset() {
  fileName.value = "";
  file.value = null;
  fileError.value = "";
  matches.value = {};
  toMatch.value = [];
  matchState.value = "idle";
  picking.value = null;
  sending.value = null;
  sendError.value = "";
}

function choose() {
  input.value?.click();
}

async function picked(event: Event) {
  const chosen = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!chosen) return;
  reset();
  fileName.value = chosen.name;
  if (chosen.size > MAX_BYTES) {
    fileError.value = "This file is too big to be a workout export.";
    return;
  }
  const read = readExport(await chosen.text());
  if ("error" in read) {
    fileError.value = read.error;
    return;
  }
  file.value = read;
  app.value = read.source;
  await match();
}

async function match() {
  if (!file.value) return;
  matchState.value = "loading";
  try {
    const names = file.value.exercises;
    const found: Record<string, string | null> = {};
    for (const batch of batches(names, 300)) Object.assign(found, await matchExercises(batch));
    matches.value = found;
    toMatch.value = names.filter((name) => !found[name]);
    matchState.value = "ready";
  } catch {
    matchState.value = "failed";
  }
}

const nameOf = (id: string) => exercises.items.find((item) => item.id === id)?.name ?? id;
const matched = computed(() => (file.value?.exercises ?? []).filter((name) => !toMatch.value.includes(name)));
const unmatched = computed(() => toMatch.value.filter((name) => !matches.value[name]).length);
const today = () => todayInZone(deviceTimeZone());
const requests = computed(() => (file.value && matchState.value === "ready" ? importRequests(file.value, matches.value, unit.value, today()) : []));
const count = (n: number) => (n === 1 ? "1 workout" : `${n} workouts`);

// The library opens at its top, and coming back finds the list where it was.
const root = ref<HTMLElement | null>(null);
let keptScroll = 0;
watch(picking, async (name, before) => {
  const body = () => root.value?.closest<HTMLElement>(".sheet-body") ?? null;
  if (name && !before) keptScroll = body()?.scrollTop ?? 0;
  await nextTick();
  const element = body();
  if (element) element.scrollTop = name ? 0 : keptScroll;
});

function pick(id: string) {
  if (picking.value) matches.value = { ...matches.value, [picking.value]: id };
  picking.value = null;
}

function leaveOut(name: string) {
  matches.value = { ...matches.value, [name]: null };
  picking.value = null;
}

async function send() {
  if (!file.value || !requests.value.length || sending.value) return;
  const all = requests.value;
  const source = file.value.source;
  sendError.value = "";
  sending.value = { done: 0, total: all.length };
  let added = 0;
  let skipped = 0;
  try {
    for (const batch of batches(all)) {
      const result = await importWorkouts(source, deviceTimeZone(), batch);
      added += result.added;
      skipped += result.skipped;
      sending.value = { done: sending.value.done + batch.length, total: all.length };
    }
  } catch (error) {
    const done = sending.value?.done ?? 0;
    sending.value = null;
    const kept = done ? ` ${count(done)} went in; import the file again for the rest.` : "";
    if (error instanceof ServerUnreachable) sendError.value = `Server unreachable, so the import stopped.${kept}`;
    else sendError.value = `${error instanceof ApiError ? error.message : "Couldn't import the workouts."}${kept}`;
    if (done) void loadHistory();
    return;
  }
  sending.value = null;
  void loadHistory();
  closeImport();
  toast(skipped && !added ? "Those workouts are already here" : `Imported ${count(added)}${skipped ? ` · ${skipped} already here` : ""}`);
}
</script>

<template>
  <BottomSheet :open="open" :label="picking ? `Match ${picking}` : 'Import workouts'" full @close="closeImport">
    <template #header>
      <div class="row hdr">
        <button v-if="picking" type="button" class="cbtn" aria-label="Back to Import" @click="picking = null"><Icon name="left" :size="18" /></button>
        <span class="col grow g2">
          <h2 class="t-head m0">{{ picking ? "Pick a match" : "Import workouts" }}</h2>
          <span v-if="picking" class="t-capn c2" data-import-picking>{{ picking }}</span>
        </span>
        <button v-if="!picking" type="button" class="cbtn" aria-label="Close" @click="closeImport"><Icon name="x" :size="18" /></button>
      </div>
    </template>

    <div v-if="picking" ref="root" class="col body" data-import-pick>
      <button v-if="matches[picking]" type="button" class="btn sm secondary t-label self" data-import-leave-out @click="leaveOut(picking)">Leave it out</button>
      <ExerciseBrowser title="Exercises" title-id="import-pick-title" action="match" bare @pick="pick" />
    </div>

    <div v-else ref="root" class="col body" data-import>
      <Segmented v-model="app" size="compact" class="full" label="From" :options="APPS" />
      <p class="t-label c2 m0">{{ HOW[app] }}</p>
      <input ref="input" type="file" accept=".csv,text/csv,text/comma-separated-values" class="hidden" data-import-file @change="picked" />

      <section class="well" aria-label="The file">
        <div class="row frow">
          <span class="tdisc" :class="{ done: file }"><Icon :name="file ? 'check' : 'download'" :size="18" :sw="file ? 2.6 : undefined" /></span>
          <span class="col grow g2 text">
            <span class="t-bodys name">{{ fileName || "No file yet" }}</span>
            <span v-if="file" class="t-capn c2" data-import-summary>{{ fileLine(file) }}</span>
            <span v-else-if="fileError" class="t-capn" role="alert" data-import-error>{{ fileError }}</span>
            <span v-else class="t-capn c2">A CSV file from Strong or Hevy</span>
          </span>
          <button type="button" class="btn sm secondary t-label" data-import-choose @click="choose">{{ fileName ? "Change" : "Pick file" }}</button>
        </div>
      </section>

      <template v-if="file">
        <dl class="gstats">
          <div><dt class="t-capn c2">Workouts</dt><dd class="t-bodys">{{ file.workouts.length }}</dd></div>
          <div><dt class="t-capn c2">Exercises</dt><dd class="t-bodys">{{ file.exercises.length }}</dd></div>
          <div><dt class="t-capn c2">To match</dt><dd class="t-bodys" data-import-to-match>{{ matchState === "ready" ? unmatched : "–" }}</dd></div>
        </dl>

        <div v-if="!file.unitKnown" class="col g8">
          <span class="t-label c2">The file doesn't say kg or lb. Its weights are in</span>
          <Segmented v-model="unit" size="compact" class="full" label="Weights in" :options="UNITS" data-import-unit />
        </div>

        <p v-if="matchState === 'loading'" class="t-label c2 m0" role="status">Matching the exercises…</p>
        <div v-else-if="matchState === 'failed'" class="row fail">
          <span class="t-label c2 grow">Matching the exercises needs a connection.</span>
          <button type="button" class="btn sm secondary t-label" @click="match">Try again</button>
        </div>

        <template v-else-if="matchState === 'ready'">
          <section v-if="toMatch.length" class="col g8" aria-labelledby="import-match-title">
            <h3 id="import-match-title" class="section-title c2 m0">Pick a match for these</h3>
            <ul class="list col">
              <li v-for="name in toMatch" :key="name" class="row frow mrow" :data-import-name="name">
                <span class="col grow g2 text">
                  <span class="t-body name">{{ name }}</span>
                  <span v-if="matches[name]" class="t-capn c2">→ {{ nameOf(matches[name]!) }}</span>
                  <span v-else class="t-capn">No match yet, so it's left out</span>
                </span>
                <button type="button" class="btn sm secondary t-label" :aria-label="`${matches[name] ? 'Change' : 'Pick'} the match for ${name}`" @click="picking = name">
                  <Icon name="swap" :size="14" /> {{ matches[name] ? "Change" : "Pick" }}
                </button>
              </li>
            </ul>
          </section>

          <section v-if="matched.length" class="col g8" aria-labelledby="import-matched-title">
            <h3 id="import-matched-title" class="section-title c2 m0">Matched</h3>
            <ul class="list col">
              <li v-for="name in matched" :key="name" class="row frow mrow" :data-import-name="name">
                <span class="col grow g2 text">
                  <span class="t-body name">{{ name }}</span>
                  <span v-if="matches[name]" class="t-capn c2">→ {{ nameOf(matches[name]!) }}</span>
                  <span v-else class="t-capn">Left out</span>
                </span>
                <button type="button" class="btn sm secondary t-label" :aria-label="`Change the match for ${name}`" @click="picking = name">
                  <Icon name="swap" :size="14" /> Change
                </button>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </div>

    <template v-if="!picking && file" #footer>
      <div class="col g8">
        <p v-if="sendError" class="t-capn act m0" role="alert" data-import-send-error>{{ sendError }}</p>
        <p v-else class="t-capn c2 m0">Past sets count toward load suggestions and new bests.</p>
        <button
          type="button" class="btn primary block t-bodys" :disabled="matchState !== 'ready' || !requests.length || !!sending" data-import-send @click="send"
        >
          <template v-if="sending">Importing… {{ sending.done }} of {{ sending.total }}</template>
          <template v-else-if="matchState === 'ready' && !requests.length">Nothing to import yet</template>
          <template v-else>Import {{ count(requests.length) }}</template>
        </button>
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: 2px; }
.g8 { gap: var(--space-s); }
.hdr { gap: var(--space-s); flex-wrap: nowrap; }
.body { gap: var(--space-l); }
.hidden { display: none; }
.self { align-self: flex-start; }
.list { list-style: none; margin: 0; padding: 0; }
.list > li + li { border-top: 1px solid var(--color-border); }
.frow { gap: var(--space-m); flex-wrap: nowrap; }
.mrow { min-height: 52px; padding: var(--space-xs) 0; }
.text { min-width: 0; }
.name { overflow-wrap: anywhere; }
.fail { gap: var(--space-m); flex-wrap: nowrap; }

/* At XL the button moves under the words rather than squeezing them. */
.dt-xl .frow, .dt-xl .fail { flex-wrap: wrap; }
</style>
