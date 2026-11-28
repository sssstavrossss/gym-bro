<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import Icon from "./Icon.vue";
import SetRow from "./SetRow.vue";
import TimedBlock from "./TimedBlock.vue";
import { photoUrl } from "../lib/exercises";
import {
  clock,
  clockTime,
  exerciseGroups,
  exerciseSummary,
  groupName,
  groupOf,
  restLeft,
  samePart,
  shortDay,
  type DraftExercise,
} from "../lib/workout";
import { setLabels } from "../lib/setEntry";
import { hasNode, nextSet, timelineEdges, timelineRows, type Lane, type TimelineRow } from "../lib/timeline";
import { targetLine } from "../lib/plan";
import { FIRST_TIME_LINE, suggestionLine } from "../lib/progression";
import { maxText } from "../lib/records";
import { formatLabel } from "../lib/timed";
import { dialSpec, REST_HINTS, restDial } from "../lib/dial";
import { exercises as library } from "../state/exercises";
import { describe } from "../state/describe";
import {
  addSet,
  addWarmups,
  exerciseItem,
  exerciseLoadTarget,
  exerciseNewBest,
  exerciseRest,
  exerciseSuggestion,
  removeExercise,
  removeSet,
  restoreExercise,
  setExerciseRest,
  setRunningRest,
  shiftRest,
  toggleSuperset,
  workout,
} from "../state/workout";
import { openDial, openExercise, toast } from "../ui";

// The workout as one timeline, drawn like a git graph (README, *Logging a workout*; docs/training.md, decision 12).
// lib/timeline.ts lays out the rows; this draws them and the rail beside them: solid up to the set to do, dotted
// ahead, a superset of two on a second lane. The set to do is a scoreboard, and the rest runs on the rail into it.
// `live` is the workout in progress; a past one (logged or edited afterwards) has every exercise open and no rest.
const props = defineProps<{ exercises: DraftExercise[]; live: boolean; now: number; startedAt: string | null; day?: string }>();
const emit = defineEmits<{ add: []; describe: []; swap: [DraftExercise] }>();

const list = ref<HTMLOListElement | null>(null);
const byKey = computed(() => new Map(props.exercises.map((exercise) => [exercise.key, exercise])));
const runs = computed(() => exerciseGroups(props.exercises));
const runOf = (head: string) => runs.value.find((run) => run[0].key === head) ?? [];

// ---- Which runs are open ----
// The run with the set to do is open, the others folded; a tap opens or folds one by hand until it is done.
const overrides = reactive(new Map<string, boolean>());
const isOpen = (head: string, current: boolean) => overrides.get(head) ?? (props.live ? current : true);
function toggle(head: string, open: boolean) {
  overrides.set(head, !open);
}
const doneHeads = computed(() => runs.value.filter((run) => run.every((exercise) => exercise.sets.length && exercise.sets.every((set) => set.doneAt))).map((run) => run[0].key));
watch(doneHeads, (done, before) => {
  for (const head of done) if (!before?.includes(head)) overrides.delete(head);
});

const left = computed(() => (props.live && workout.active ? restLeft(workout.active, props.now) : null));
const restFor = computed(() => workout.active?.restFor ?? 0);
const rows = computed(() => timelineRows({ exercises: props.exercises, isOpen, live: props.live, started: !!props.startedAt || !props.live, resting: left.value != null }));
const nowSet = computed(() => (props.live ? nextSet(props.exercises) : null));

/** Opens the run an exercise is in and brings it into view: after adding or swapping one. */
async function openRun(key: string) {
  const run = groupOf(props.exercises, key);
  if (!run.length) return;
  overrides.set(run[0].key, true);
  await nextTick();
  list.value?.querySelector(`[data-workout-exercise="${byKey.value.get(key)?.exerciseId}"]`)?.scrollIntoView?.({ block: "nearest" });
}
defineExpose({ openRun });

// The set to do comes into view as the workout moves on.
watch(() => (nowSet.value ? `${nowSet.value.key}:${nowSet.value.index}` : ""), async (at, before) => {
  if (!at || at === before) return;
  await nextTick();
  list.value?.querySelector('[data-set-state="now"]')?.scrollIntoView?.({ block: "nearest" });
});

// ---- Words ----
const nameOf = (exercise: DraftExercise | undefined) => (exercise ? exerciseItem(exercise.exerciseId)?.name ?? exercise.exerciseId : "");
const ex = (key: string) => byKey.value.get(key)!;
function folded(exercise: DraftExercise) {
  const summary = exerciseSummary(exercise.sets, exerciseItem(exercise.exerciseId)?.measure ?? "weight_reps", exercise.exerciseId);
  const n = exercise.sets.length;
  const ticked = exercise.sets.filter((set) => set.doneAt).length;
  if (summary) return ticked === n ? summary : `${ticked} of ${n} · ${summary}`;
  return `${n} ${n === 1 ? "set" : "sets"}`;
}
/** Under an open exercise: what to aim for, what to lift, last time, and a best beaten today. */
function info(exercise: DraftExercise) {
  const item = exerciseItem(exercise.exerciseId);
  const target = exercise.target ? targetLine(exercise.target, exercise.part === "warmup") : "";
  if (!props.live) return { target, advice: "", kind: "", last: "", best: "" };
  const last = workout.previous[exercise.exerciseId] ?? null;
  const suggestion = exerciseSuggestion(exercise);
  const load = exerciseLoadTarget(exercise);
  const known = exercise.exerciseId in workout.previous;
  const advice = !load || !item ? "" : suggestion ? suggestionLine(suggestion, load) : known && !last && item.equipment !== "body only" ? FIRST_TIME_LINE : "";
  let lastLine = "";
  if (last) {
    const line = exerciseSummary(last.sets.map((set) => ({ ...set, doneAt: last.date })), item?.measure ?? "weight_reps", exercise.exerciseId);
    lastLine = `Last time, ${shortDay(last.date)}${line ? `: ${line}` : ""}`;
  } else if (known && advice !== FIRST_TIME_LINE) lastLine = "First time";
  const best = exerciseNewBest(exercise);
  return { target, advice, kind: suggestion?.kind ?? "first", last: lastLine, best: best ? `New best: est. max ${maxText(best.estimatedMax)}` : "" };
}
const hasInfo = (exercise: DraftExercise) => Object.entries(info(exercise)).some(([field, text]) => field !== "kind" && text);
function letterOf(exercise: DraftExercise) {
  const run = groupOf(props.exercises, exercise.key);
  return run.length > 1 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[run.indexOf(exercise)] ?? "" : "";
}
const nodeLabel = (exercise: DraftExercise, index: number) => `${letterOf(exercise)}${setLabels(exercise.sets)[index]}`;
const boardTitle = (exercise: DraftExercise) => (letterOf(exercise) ? `${letterOf(exercise)} · ${nameOf(exercise)}` : "");
function runLabel(run: readonly DraftExercise[]) {
  const kind = run[0]?.timed ? formatLabel(run[0].timed) : groupName(run.length);
  return `${kind}: ${run.map((exercise) => nameOf(exercise)).join(", ")}`;
}
const startLine = computed(() => (!props.live ? (props.day ? shortDay(props.day) : "") : props.startedAt ? `Started ${clockTime(props.startedAt)}` : "Starts with the first set"));
function photo(exercise: DraftExercise) {
  const item = exerciseItem(exercise.exerciseId);
  return item?.images && library.photos && !broken.has(exercise.exerciseId) ? photoUrl(library.photos, exercise.exerciseId, 0) : "";
}
const broken = reactive(new Set<string>());

// ---- Doing ----
/** The one before, for the superset button; none across the warm-up, the workout and the cool-down. */
function prevName(exercise: DraftExercise) {
  const before = props.exercises[props.exercises.indexOf(exercise) - 1];
  return before && samePart(before, exercise) ? nameOf(before) : "";
}
async function join(exercise: DraftExercise) {
  const before = props.exercises[props.exercises.indexOf(exercise) - 1];
  if (!before) return;
  const joined = !!exercise.superset;
  toggleSuperset(exercise.key);
  if (joined) {
    toast(`Split ${nameOf(before)} and ${nameOf(exercise)}`);
    return;
  }
  // The joined run stays open where the button was tapped; the new exercises reach the props on the next render.
  await nextTick();
  const run = groupOf(props.exercises, exercise.key);
  if (run.length) overrides.set(run[0].key, true);
  toast(`${groupName(run.length)}: ${run.map((each) => nameOf(each)).join(" + ")}`);
}
function remove(exercise: DraftExercise) {
  const removed = removeExercise(exercise.key);
  if (removed) toast(`${nameOf(exercise)} removed`, { label: "Undo", run: () => restoreExercise(removed) });
}
function warmUp(exercise: DraftExercise) {
  const added = addWarmups(exercise.key);
  if (added) toast(`${added.count} warm-up ${added.count === 1 ? "set" : "sets"}, building to ${added.workKg} kg`);
}
const canRemoveSet = (exercise: DraftExercise) => exercise.sets.length > 1 && !exercise.sets[exercise.sets.length - 1].doneAt;

function restWheel(exercise: DraftExercise, value: number) {
  const id = restDial(exerciseItem(exercise.exerciseId));
  return dialSpec(id, { label: `Rest · ${nameOf(exercise)}`, hint: REST_HINTS[id], value });
}
/** An exercise's rest, from its buttons: the rest after each of its sets. */
function editRest(exercise: DraftExercise, event: MouseEvent) {
  openDial(restWheel(exercise, exerciseRest(exercise)), event.currentTarget as Element, (seconds) => setExerciseRest(exercise.key, seconds));
}
/** The exercise whose set started the rest running: the last ticked off. */
const restedAfter = computed(() => {
  let best: { exercise: DraftExercise; at: number } | null = null;
  for (const exercise of props.exercises) for (const set of exercise.sets) {
    const at = set.doneAt ? Date.parse(set.doneAt) : NaN;
    if (!Number.isNaN(at) && (!best || at >= best.at)) best = { exercise, at };
  }
  return best?.exercise ?? null;
});
/** The rest running, from its "of 2:00": this rest changes, and the exercise's rest with it. */
function editRunning(event: MouseEvent) {
  const exercise = restedAfter.value;
  const save = (seconds: number) => {
    setRunningRest(seconds);
    if (exercise) setExerciseRest(exercise.key, seconds);
  };
  const spec = exercise ? restWheel(exercise, restFor.value) : dialSpec("rest.compound", { label: "Rest", value: restFor.value });
  openDial(spec, event.currentTarget as Element, save);
}

// ---- The rail ----
// Drawn from where the nodes landed, so it follows the rows whatever they hold and at any text size.
const LANE_X: Record<Lane, number> = { 0: 14, 1: 40 };
interface Stretch { d: string; kind: "done" | "next" | "rest"; lane: Lane; x0: number; y0: number; y1: number }
const stretches = ref<Stretch[]>([]);
const railH = ref(0);
function draw() {
  const el = list.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  const ys = new Map<string, number>();
  el.querySelectorAll<HTMLElement>("[data-node]").forEach((node) => {
    const box = node.getBoundingClientRect();
    ys.set(node.dataset.node!, box.top + box.height / 2 - top);
  });
  railH.value = el.scrollHeight;
  const out: Stretch[] = [];
  for (const edge of timelineEdges(rows.value)) {
    const y0 = ys.get(edge.from);
    const y1 = ys.get(edge.to);
    if (y0 == null || y1 == null) continue;
    const x0 = LANE_X[edge.fromLane];
    const x1 = LANE_X[edge.toLane];
    // A branch leaves at once and runs down its own lane; a merge runs down and joins at the last moment.
    const bend = Math.min(26, (y1 - y0) / 2);
    const d = x0 === x1 ? `M${x0} ${y0} V${y1}`
      : edge.toLane === 1 ? `M${x0} ${y0} C${x0} ${y0 + bend / 2} ${x1} ${y0 + bend / 2} ${x1} ${y0 + bend} V${y1}`
      : `M${x0} ${y0} V${y1 - bend} C${x0} ${y1 - bend / 2} ${x1} ${y1 - bend / 2} ${x1} ${y1}`;
    out.push({ d, kind: edge.kind, lane: edge.toLane === 1 || edge.fromLane === 1 ? 1 : 0, x0, y0, y1 });
  }
  stretches.value = out;
}
/** The rest fills its stretch of the rail as it runs, like a progress bar. */
const restShare = computed(() => (left.value == null || !restFor.value ? 1 : Math.min(1, Math.max(0, 1 - left.value / restFor.value))));
const paths = computed(() => stretches.value.flatMap((stretch, n) => {
  if (stretch.kind !== "rest") return [{ key: `${n}`, d: stretch.d, cls: [stretch.kind, `lane${stretch.lane}`] }];
  const y = stretch.y0 + (stretch.y1 - stretch.y0) * restShare.value;
  return [
    { key: `${n}`, d: stretch.d, cls: ["next"] },
    { key: `${n}f`, d: `M${stretch.x0} ${stretch.y0} V${y}`, cls: ["fill"] },
  ];
}));

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (typeof ResizeObserver !== "undefined" && list.value) {
    observer = new ResizeObserver(() => draw());
    observer.observe(list.value);
  }
  void nextTick(draw);
});
onBeforeUnmount(() => observer?.disconnect());
watch(rows, () => void nextTick(draw), { deep: true });

const rowClass = (row: TimelineRow) => ["ev", row.type, row.state, `l${row.lane}`];
</script>

<template>
  <ol ref="list" class="tl" aria-label="The workout, in order" data-timeline>
    <svg class="rail" :height="railH" width="56" aria-hidden="true">
      <path v-for="path in paths" :key="path.key" :d="path.d" :class="path.cls" fill="none" />
    </svg>

    <li
      v-for="row in rows" :key="row.key" :class="rowClass(row)"
      :role="row.type === 'run' ? 'group' : undefined" :aria-label="row.type === 'run' ? runLabel(runOf(row.head)) : undefined"
      :data-superset="row.type === 'run' ? row.size : undefined"
    >
      <!-- Its node on the rail -->
      <span v-if="hasNode(row)" class="node" :data-node="row.key" :style="{ left: `${LANE_X[row.lane]}px` }" aria-hidden="true">
        <img v-if="row.type === 'exercise' && photo(ex(row.exercise))" :src="photo(ex(row.exercise))" alt="" @error="broken.add(ex(row.exercise).exerciseId)" />
        <Icon v-else-if="row.type === 'add'" name="plus" :size="14" />
        <Icon v-else-if="row.type === 'set' && row.state === 'done'" name="check" :size="11" :sw="3.4" />
        <span v-else-if="row.type === 'set'" class="nn tnum">{{ nodeLabel(ex(row.exercise), row.index) }}</span>
      </span>

      <span v-if="row.type === 'start'" class="t-capn c2 tnum" data-timeline-start>{{ startLine }}</span>

      <h3 v-else-if="row.type === 'part'" class="t-cap c2 m0 part" :data-part="row.part">{{ row.label }}</h3>

      <TimedBlock v-else-if="row.type === 'run'" :run="runOf(row.head)" :live="live" :now="now" />

      <div v-else-if="row.type === 'exercise'" class="row exh" :data-workout-exercise="ex(row.exercise).exerciseId" :data-open="row.open ? '' : undefined">
        <button type="button" class="row exbtn" :aria-expanded="row.open" @click="toggle(row.head, row.open)">
          <span class="col grow g2">
            <span class="t-body exname"><span v-if="row.letter" class="t-capn c3 letter">{{ row.letter }}</span>{{ nameOf(ex(row.exercise)) }}</span>
            <span class="t-capn c2 tnum" data-exercise-line>{{ folded(ex(row.exercise)) }}</span>
          </span>
          <span class="chev" :class="{ up: row.open }" aria-hidden="true"><Icon name="down" :size="16" /></span>
        </button>
        <button
          v-if="row.open" type="button" class="cbtn" :aria-label="`How to do ${nameOf(ex(row.exercise))}`"
          @click="openExercise(ex(row.exercise).exerciseId)"
        ><Icon name="info" :size="18" /></button>
      </div>

      <div v-else-if="row.type === 'info'" class="col infos" :data-info="ex(row.exercise).exerciseId">
        <template v-if="hasInfo(ex(row.exercise))">
          <span v-if="info(ex(row.exercise)).target" class="t-capn c2">{{ info(ex(row.exercise)).target }}</span>
          <span v-if="info(ex(row.exercise)).advice" class="t-capn" :data-load-suggestion="info(ex(row.exercise)).kind">{{ info(ex(row.exercise)).advice }}</span>
          <span v-if="info(ex(row.exercise)).last" class="t-capn c2" data-last-time>{{ info(ex(row.exercise)).last }}</span>
          <span v-if="info(ex(row.exercise)).best" class="t-capn best" data-new-best><Icon name="check" :size="12" :sw="3" /><span>{{ info(ex(row.exercise)).best }}</span></span>
        </template>
      </div>

      <SetRow
        v-else-if="row.type === 'set'" :exercise="ex(row.exercise)" :index="row.index" :state="row.state" :past="!live"
        :title="boardTitle(ex(row.exercise))"
      />

      <div v-else-if="row.type === 'rest'" class="row restnow" data-rest>
        <span class="col grow g2">
          <span class="t-capn c2">{{ left ? "Rest" : "Rest over" }}</span>
          <span class="t-ns tnum" role="timer" aria-live="off">{{ clock(left ?? 0) }}</span>
        </span>
        <button
          type="button" class="btn sm secondary t-label tnum" :aria-label="`Rest of ${clock(restFor)}, change`" data-rest-length
          @click="editRunning"
        >of {{ clock(restFor) }}</button>
        <button type="button" class="btn sm primary t-label" data-rest-skip @click="shiftRest(null)">{{ left ? "Skip" : "OK" }}</button>
      </div>

      <div v-else-if="row.type === 'tools'" class="row tools">
        <button type="button" class="btn sm secondary t-label" @click="addSet(row.exercise)"><Icon name="plus" :size="14" /> Set</button>
        <button v-if="!ex(row.exercise).part" type="button" class="btn sm secondary t-label" data-add-warmup @click="warmUp(ex(row.exercise))"><Icon name="plus" :size="14" /> Warm-up</button>
        <button
          v-if="live" type="button" class="btn sm secondary t-label tnum" :aria-label="`Rest ${clock(exerciseRest(ex(row.exercise)))}, change`"
          data-rest-setting @click="editRest(ex(row.exercise), $event)"
        ><Icon name="clock" :size="14" /> {{ clock(exerciseRest(ex(row.exercise))) }}</button>
        <span class="row ends">
          <button
            v-if="prevName(ex(row.exercise))" type="button" class="cbtn" :class="{ filled: ex(row.exercise).superset }" :aria-pressed="!!ex(row.exercise).superset"
            :aria-label="`Superset with ${prevName(ex(row.exercise))}`" data-superset-prev @click="join(ex(row.exercise))"
          ><Icon name="link" :size="18" /></button>
          <button type="button" class="cbtn" :aria-label="`Swap ${nameOf(ex(row.exercise))}`" data-swap @click="emit('swap', ex(row.exercise))"><Icon name="swap" :size="18" /></button>
          <button
            type="button" class="cbtn" aria-label="Remove the last set" :disabled="!canRemoveSet(ex(row.exercise))"
            @click="removeSet(row.exercise, ex(row.exercise).sets.length - 1)"
          ><Icon name="minus" :size="18" /></button>
          <button type="button" class="cbtn" :aria-label="`Remove ${nameOf(ex(row.exercise))}`" @click="remove(ex(row.exercise))"><Icon name="trash" :size="18" /></button>
        </span>
      </div>

      <span v-else-if="row.type === 'merge'" class="t-capn c3">{{ row.state === "done" ? `${groupName(runOf(row.head).length)} done` : "" }}</span>

      <div v-else-if="row.type === 'add'" class="row addh">
        <button type="button" class="btn sm secondary t-label" data-add-exercise @click="emit('add')"><Icon name="plus" :size="14" /> Exercise</button>
        <button v-if="describe.available" type="button" class="btn sm secondary t-label" data-describe-workout @click="emit('describe')"><Icon name="sparkle" :size="14" /> Describe</button>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
.tnum { font-variant-numeric: tabular-nums; }

/* The rail's gutter holds both lanes; the rows sit to its right. */
.tl { --gutter: 56px; position: relative; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rail { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.rail path { stroke-width: var(--line-rail); stroke-linecap: round; }
.rail .done { stroke: var(--text-primary); }
.rail .done.lane1 { stroke: var(--text-secondary); }
.rail .next { stroke: var(--color-border-strong); stroke-dasharray: 2 5; }
.rail .fill { stroke: var(--color-action); stroke-width: 3; }

.ev { position: relative; display: flex; align-items: center; min-height: var(--control-hit); padding-left: var(--gutter); min-width: 0; }
.ev.start, .ev.merge { min-height: 28px; }
.ev.info { min-height: 0; }
.ev.set { padding-block: 1px; }
.ev.set.now { padding-block: var(--space-xs); }
.ev.part { min-height: 0; padding-top: var(--space-m); }
.ev.run { flex-direction: column; align-items: stretch; margin-top: var(--space-s); }
.ev.run > :deep(*) { min-width: 0; }

/* Nodes, centred on their lane */
.node {
  position: absolute; top: 50%; transform: translate(-50%, -50%); z-index: 1; box-sizing: border-box;
  width: 10px; height: 10px; border-radius: 50%; background: var(--color-bg); box-shadow: inset 0 0 0 2px var(--color-border-strong);
  display: flex; align-items: center; justify-content: center; color: var(--color-on-action); overflow: hidden;
}
/* The heading's node sits beside its first line, not halfway down the format panel. */
.ev.run .node { top: 22px; }
.ev.start.done .node, .ev.run.done .node, .ev.merge.done .node { background: var(--text-primary); box-shadow: none; }
.ev.set .node { width: 20px; height: 20px; color: var(--text-tertiary); }
.nn { font-size: 9px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
.ev.set.done .node { background: var(--text-primary); box-shadow: none; color: var(--color-bg); }
.ev.l1.set.done .node { background: var(--text-secondary); }
.ev.set.now .node {
  width: 22px; height: 22px; color: var(--text-primary); background: var(--color-bg);
  box-shadow: inset 0 0 0 2.5px var(--color-action), 0 0 0 5px color-mix(in srgb, var(--color-action) 18%, transparent);
}
.ev.rest .node { width: 6px; height: 6px; background: var(--color-action); box-shadow: none; }
.ev.exercise .node { width: 28px; height: 28px; background: var(--color-surface-2); box-shadow: 0 0 0 1.5px var(--color-border-strong); }
.ev.exercise .node img { width: 100%; height: 100%; object-fit: cover; }
.ev.exercise.done .node { box-shadow: 0 0 0 2px var(--text-primary); }
.ev.exercise.now .node { box-shadow: 0 0 0 2px var(--color-action), 0 0 0 5px color-mix(in srgb, var(--color-action) 16%, transparent); }
.ev.exercise.next .node { opacity: .8; }
.ev.add .node { width: 26px; height: 26px; color: var(--text-secondary); box-shadow: inset 0 0 0 1.5px var(--color-border-strong); }

/* An exercise's heading: its name, how it went or what's planned, and a tap to open or fold it */
.row.exh { flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; gap: var(--space-2xs); }
.row.exbtn {
  flex: 1 1 auto; min-width: 0; gap: var(--space-s); flex-wrap: nowrap; padding: var(--space-s) 0; min-height: 52px;
  border: 0; background: none; color: inherit; text-align: left;
}
.exname { overflow-wrap: anywhere; }
.ev.exercise.next .exname { color: var(--text-secondary); }
.ev.exercise.now .exname { font-weight: 600; }
.letter { margin-right: var(--space-xs); }
.chev { display: inline-flex; flex: none; color: var(--text-secondary); transition: transform .2s; }
.chev.up { transform: rotate(180deg); }

.infos { flex: 1 1 auto; min-width: 0; gap: var(--space-2xs); padding-bottom: var(--space-xs); }
.infos:empty { padding: 0; }
.best { color: var(--color-action); display: inline-flex; align-items: baseline; gap: var(--space-2xs); }
.best :deep(svg) { flex: none; align-self: center; }

.row.restnow { flex: 1 1 auto; min-width: 0; gap: var(--space-xs); flex-wrap: nowrap; padding-block: var(--space-xs); }
/* The buttons wrap; the icon buttons keep together at the right end. */
.row.tools { flex: 1 1 auto; min-width: 0; gap: var(--space-xs); flex-wrap: wrap; padding-bottom: var(--space-s); }
.tools .ends { margin-left: auto; gap: 0; flex-wrap: nowrap; }
.row.addh { gap: var(--space-s); }
html.dt-xl .row.restnow { flex-wrap: wrap; }
</style>
