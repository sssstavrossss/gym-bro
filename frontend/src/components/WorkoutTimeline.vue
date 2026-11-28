<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import Icon from "./Icon.vue";
import SetRow from "./SetRow.vue";
import TimedBlock from "./TimedBlock.vue";
import PopMenu, { type MenuItem, type MenuSection } from "./PopMenu.vue";
import { photoUrl } from "../lib/exercises";
import {
  clock,
  clockTime,
  exerciseGroups,
  exerciseSummary,
  groupName,
  groupOf,
  restLeft,
  canJoin,
  samePart,
  shortDay,
  type DraftExercise,
} from "../lib/workout";
import { setLabels, setName } from "../lib/setEntry";
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
  duplicateSet,
  removeSet,
  restoreExercise,
  restoreSet,
  setSetType,
  toggleDone,
  setExerciseRest,
  setRunningRest,
  shiftRest,
  toggleSuperset,
  workout,
} from "../state/workout";
import { openDial, openExercise, toast } from "../ui";

// The workout as one timeline, drawn like a git graph (README, *Logging a workout*; docs/training.md, decisions 12
// and 14). lib/timeline.ts lays out the rows; this draws them and the rail beside them: solid up to the set to do,
// dotted ahead, a superset of two on a second lane. Rows carry only numbers; what can be done lives on the nodes.
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
/** In an exercise's menu: what to aim for, what to lift, last time, and a best beaten today. */
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
/** The one before, for "Superset with"; none across the warm-up, the workout and the cool-down. */
function prevName(exercise: DraftExercise) {
  const before = props.exercises[props.exercises.indexOf(exercise) - 1];
  return before && samePart(before, exercise) && (exercise.superset || canJoin(before, exercise)) ? nameOf(before) : "";
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
  // The joined run stays open; the new exercises reach the props on the next render.
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
function deleteSet(exercise: DraftExercise, index: number) {
  const label = setName(exercise.sets, index);
  const removed = removeSet(exercise.key, index);
  if (removed) toast(`${label} deleted`, { label: "Undo", run: () => restoreSet(exercise.key, index, removed) });
}
/** A set ticked or unticked from its node; the set to do has its own ✓ beside its numbers too. */
const setDone = (exercise: DraftExercise, index: number) => !!exercise.sets[index]?.doneAt;

function restWheel(exercise: DraftExercise, value: number) {
  const id = restDial(exerciseItem(exercise.exerciseId));
  return dialSpec(id, { label: `Rest · ${nameOf(exercise)}`, hint: REST_HINTS[id], value });
}
/** An exercise's rest, from its menu or a rest still to come: the rest after each of its sets. */
function editRest(exercise: DraftExercise, from: Element) {
  openDial(restWheel(exercise, exerciseRest(exercise)), from, (seconds) => setExerciseRest(exercise.key, seconds));
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
/** The rest running, from its "of 2:00" or its node: this rest changes, and the exercise's rest with it. */
function editRunning(event: MouseEvent) {
  const exercise = restedAfter.value;
  const save = (seconds: number) => {
    setRunningRest(seconds);
    if (exercise) setExerciseRest(exercise.key, seconds);
  };
  const spec = exercise ? restWheel(exercise, restFor.value) : dialSpec("rest.compound", { label: "Rest", value: restFor.value });
  openDial(spec, event.currentTarget as Element, save);
}

// ---- The menus ----
// Every node on the rail does something (docs/training.md, decision 14): the +, an exercise's photo and a held set
// open a small menu (PopMenu) of what can happen there; a set's node ticks it; a rest to come changes its length.
interface Menu { key: string; anchor: Element; label: string; sections: MenuSection[]; head?: DraftExercise[] }
const menu = ref<Menu | null>(null);
const isWeights = (exercise: DraftExercise) => (exerciseItem(exercise.exerciseId)?.measure ?? "weight_reps") === "weight_reps";

/** What the + adds to: the exercise with the set to do, else the last one. */
const current = computed<DraftExercise[]>(() => {
  const at = nowSet.value ? props.exercises.find((exercise) => exercise.key === nowSet.value!.key) : props.exercises[props.exercises.length - 1];
  return at ? groupOf(props.exercises, at.key) : [];
});
function addMenu(anchor: Element) {
  const run = current.value;
  const one = run.length === 1 ? run[0] : null;
  const sections: MenuSection[] = [];
  if (run.length) {
    const items: MenuItem[] = [{
      id: "add-set", icon: "plus", label: one ? "Set" : "Round",
      run: () => run.forEach((exercise) => addSet(exercise.key)),
    }];
    if (one && isWeights(one) && !one.part && !one.timed) items.push({ id: "add-warmup", icon: "flame", label: "Warm-up sets", run: () => warmUp(one) });
    if (one && isWeights(one) && !one.timed) items.push({ id: "add-drop", icon: "stairs", label: "Drop set", run: () => addSet(one.key, "drop") });
    sections.push({ items });
  }
  const next: MenuItem[] = [{ id: "add-exercise", icon: "dumbbell", label: "Exercise", run: () => emit("add") }];
  if (describe.available) next.push({ id: "describe-workout", icon: "sparkle", label: "Describe it", run: () => emit("describe") });
  sections.push({ title: run.length ? "Next" : undefined, items: next });
  menu.value = { key: "add", anchor, label: "Add", sections, head: run.length ? run : undefined };
}
function exerciseMenu(exercise: DraftExercise, anchor: Element) {
  const items: MenuItem[] = [
    { id: "how-to", icon: "info", label: "How to do it", run: () => openExercise(exercise.exerciseId) },
    { id: "swap", icon: "swap", label: "Swap", run: () => emit("swap", exercise) },
  ];
  if (props.live && !exercise.timed) {
    const rounds = groupOf(props.exercises, exercise.key).length > 1;
    items.push({ id: "rest", icon: "timer", label: rounds ? "Rest between rounds" : "Rest between sets", value: clock(exerciseRest(exercise)), run: (from) => editRest(exercise, from) });
  }
  const before = prevName(exercise);
  if (before) items.push({ id: "superset", icon: "link", label: exercise.superset ? `Split from ${before}` : `Superset with ${before}`, run: () => void join(exercise) });
  items.push({ id: "remove", icon: "trash", label: "Remove", apart: true, run: () => remove(exercise) });
  menu.value = { key: `ex:${exercise.key}`, anchor, label: nameOf(exercise), sections: [{ items }], head: [exercise] };
}
function setMenu(exercise: DraftExercise, index: number, anchor: Element) {
  const set = exercise.sets[index];
  if (!set) return;
  const items: MenuItem[] = [];
  if (isWeights(exercise) && !exercise.timed) {
    items.push(set.type === "warmup"
      ? { id: "working", icon: "dumbbell", label: "Make it a working set", run: () => setSetType(exercise.key, index, "working") }
      : { id: "warmup", icon: "flame", label: "Make it a warm-up", run: () => setSetType(exercise.key, index, "warmup") });
    if (set.type !== "warmup") items.push(set.type === "drop"
      ? { id: "working", icon: "dumbbell", label: "Make it a working set", run: () => setSetType(exercise.key, index, "working") }
      : { id: "drop", icon: "stairs", label: "Make it a drop set", run: () => setSetType(exercise.key, index, "drop") });
  }
  items.push({ id: "duplicate", icon: "copy", label: "Duplicate", run: () => duplicateSet(exercise.key, index) });
  items.push({ id: "delete", icon: "trash", label: "Delete", apart: true, disabled: exercise.sets.length < 2, run: () => deleteSet(exercise, index) });
  menu.value = { key: `set:${exercise.key}:${index}`, anchor, label: `${nameOf(exercise)} · ${setName(exercise.sets, index)}`, sections: [{ items }] };
}
const menuOpen = (key: string) => menu.value?.key === key;
/** The menu's heading: the exercise (or superset) it's about, and what to know about it. */
const headName = computed(() => (menu.value?.head ?? []).map((exercise) => nameOf(exercise)).join(" + "));
const headSub = computed(() => {
  const head = menu.value?.head ?? [];
  if (menu.value?.key === "add") return head.length > 1 ? `Add to the ${groupName(head.length).toLowerCase()}` : "Add to it";
  const muscles = head.length === 1 ? exerciseItem(head[0].exerciseId)?.primaryMuscles ?? [] : [];
  return muscles.map((muscle) => muscle.replace(/-/g, " ")).join(", ");
});

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
const laneAt = (lane: Lane) => ({ left: `${LANE_X[lane]}px` });
const infoLines = (exercise: DraftExercise) => Object.entries(info(exercise)).some(([field, text]) => field !== "kind" && text);
</script>

<template>
  <ol ref="list" class="tl" aria-label="The workout, in order" data-timeline @selectstart.prevent>
    <svg class="rail" :height="railH" width="56" aria-hidden="true">
      <path v-for="path in paths" :key="path.key" :d="path.d" :class="path.cls" fill="none" />
    </svg>

    <li
      v-for="row in rows" :key="row.key" :class="rowClass(row)"
      :role="row.type === 'run' ? 'group' : undefined" :aria-label="row.type === 'run' ? runLabel(runOf(row.head)) : undefined"
      :data-superset="row.type === 'run' ? row.size : undefined"
    >
      <!-- Its node on the rail: a button wherever it does something, in its own 44px -->
      <template v-if="hasNode(row)">
        <button
          v-if="row.type === 'exercise'" type="button" class="nodehit" :style="laneAt(row.lane)" aria-haspopup="menu"
          :aria-expanded="menuOpen(row.key)" :aria-label="`${nameOf(ex(row.exercise))}: more`" :data-exercise-menu="ex(row.exercise).exerciseId"
          @click="exerciseMenu(ex(row.exercise), $event.currentTarget as Element)"
        >
          <span class="node" :data-node="row.key">
            <span class="ph"><img v-if="photo(ex(row.exercise))" :src="photo(ex(row.exercise))" alt="" @error="broken.add(ex(row.exercise).exerciseId)" /></span>
            <span class="badge"><Icon name="more" :size="10" :sw="3" /></span>
          </span>
        </button>
        <button
          v-else-if="row.type === 'set'" type="button" class="nodehit" :style="laneAt(row.lane)"
          :aria-label="`${setName(ex(row.exercise).sets, row.index)} done`" :aria-pressed="setDone(ex(row.exercise), row.index)"
          :aria-hidden="row.state === 'now' ? 'true' : undefined" :tabindex="row.state === 'now' ? -1 : undefined" :disabled="workout.saving"
          :data-set-node="`${ex(row.exercise).exerciseId}-${row.index}`" @click="toggleDone(row.exercise, row.index)"
        >
          <span class="node" :data-node="row.key">
            <Icon v-if="row.state === 'done'" name="check" :size="9" :sw="3.6" />
            <Icon v-else-if="ex(row.exercise).sets[row.index]?.type === 'warmup'" name="flame" :size="10" />
            <Icon v-else-if="ex(row.exercise).sets[row.index]?.type === 'drop'" name="stairs" :size="10" />
            <span v-else class="nn tnum">{{ nodeLabel(ex(row.exercise), row.index) }}</span>
          </span>
        </button>
        <button
          v-else-if="row.type === 'pause' && row.state === 'next' && live" type="button" class="nodehit" :style="laneAt(row.lane)"
          aria-hidden="true" tabindex="-1" @click="editRest(ex(row.exercise), $event.currentTarget as Element)"
        >
          <span class="node" :data-node="row.key"><Icon name="timer" :size="10" /></span>
        </button>
        <button
          v-else-if="row.type === 'rest'" type="button" class="nodehit" :style="laneAt(row.lane)" aria-hidden="true" tabindex="-1" @click="editRunning"
        >
          <span class="node" :data-node="row.key" :style="{ '--p': restShare }"><Icon name="timer" :size="12" /></span>
        </button>
        <button
          v-else-if="row.type === 'add'" type="button" class="nodehit" :style="laneAt(row.lane)" aria-haspopup="menu" :aria-expanded="menuOpen('add')"
          aria-label="Add" data-timeline-add @click="addMenu($event.currentTarget as Element)"
        >
          <span class="node" :data-node="row.key"><Icon name="plus" :size="13" /></span>
        </button>
        <span v-else class="nodehit" :style="laneAt(row.lane)" aria-hidden="true">
          <span class="node" :data-node="row.key"><Icon v-if="row.type === 'pause'" name="timer" :size="10" /></span>
        </span>
      </template>

      <span v-if="row.type === 'start'" class="t-capn c2 tnum" data-timeline-start>{{ startLine }}</span>

      <h3 v-else-if="row.type === 'part'" class="t-cap c2 m0 part" :data-part="row.part">{{ row.label }}</h3>

      <TimedBlock v-else-if="row.type === 'run'" :run="runOf(row.head)" :live="live" :now="now" />

      <!-- An exercise: its name folds and unfolds it -->
      <div v-else-if="row.type === 'exercise'" class="row exh" :data-workout-exercise="ex(row.exercise).exerciseId" :data-open="row.open ? '' : undefined">
        <button type="button" class="col exbtn" :aria-expanded="row.open" @click="toggle(row.head, row.open)">
          <span class="exname" :class="row.state === 'now' ? 't-bodys' : 't-body'"><span v-if="row.letter" class="t-capn c3 letter">{{ row.letter }}</span>{{ nameOf(ex(row.exercise)) }}</span>
          <span class="row g2 t-capn c2 tnum" data-exercise-line>
            <span v-if="live && exerciseNewBest(ex(row.exercise))" class="trophy" role="img" aria-label="New best" data-best-mark><Icon name="trophy" :size="12" /></span>
            <span class="ell">{{ folded(ex(row.exercise)) }}</span>
          </span>
        </button>
      </div>

      <SetRow
        v-else-if="row.type === 'set'" :exercise="ex(row.exercise)" :index="row.index" :state="row.state" :past="!live"
        :title="boardTitle(ex(row.exercise))" :class="{ held: menuOpen(row.key) }"
        @menu="(anchor) => setMenu(ex(row.exercise), row.index, anchor)"
      />

      <!-- A rest between sets: how long it was, or will be -->
      <button
        v-else-if="row.type === 'pause' && row.state === 'next' && live" type="button" class="len t-capn c3 tnum" data-pause="next"
        :aria-label="`Rest ${clock(exerciseRest(ex(row.exercise)))}, change`" data-rest-setting @click="editRest(ex(row.exercise), $event.currentTarget as Element)"
      >{{ clock(exerciseRest(ex(row.exercise))) }}</button>
      <span v-else-if="row.type === 'pause'" class="t-capn c3 tnum" :data-pause="row.state">{{ row.seconds != null ? clock(row.seconds) : "" }}</span>

      <!-- The rest running: its countdown, its length to change, and a ✓ to end it -->
      <div v-else-if="row.type === 'rest'" class="row restnow" data-rest>
        <span class="row grow cd">
          <span class="t-head tnum" role="timer" aria-live="off">{{ clock(left ?? 0) }}</span>
          <button type="button" class="len t-capn c3 tnum" :aria-label="`Rest of ${clock(restFor)}, change`" data-rest-length @click="editRunning">of {{ clock(restFor) }}</button>
        </span>
        <button
          type="button" class="cbtn tick" :aria-label="left ? 'Skip the rest' : 'Rest over'" data-rest-skip @click="shiftRest(null)"
        ><Icon name="check" :size="14" :sw="3" /></button>
      </div>

      <span v-else-if="row.type === 'merge'" class="t-capn c3">{{ row.state === "done" ? `${groupName(runOf(row.head).length)} done` : "" }}</span>

      <!-- The one + : what can come next -->
      <button v-else-if="row.type === 'add'" type="button" class="addword t-label c2" tabindex="-1" aria-hidden="true" @click="addMenu($event.currentTarget as Element)">
        {{ exercises.length ? "Add" : "Add the first exercise" }}
      </button>
    </li>
  </ol>

  <PopMenu :anchor="menu?.anchor ?? null" :label="menu?.label ?? ''" :sections="menu?.sections ?? []" @close="menu = null">
    <template v-if="menu?.head" #head>
      <div class="row mhead">
        <span class="mph"><img v-if="photo(menu.head[0])" :src="photo(menu.head[0])" alt="" /></span>
        <span class="col g2 grow">
          <span class="t-bodys">{{ headName }}</span>
          <span v-if="headSub" class="t-capn c2 cap">{{ headSub }}</span>
        </span>
      </div>
      <div v-if="menu.key !== 'add' && infoLines(menu.head[0])" class="col infos" :data-info="menu.head[0].exerciseId">
        <span v-if="info(menu.head[0]).target" class="t-capn c2">{{ info(menu.head[0]).target }}</span>
        <span v-if="info(menu.head[0]).advice" class="t-capn" :data-load-suggestion="info(menu.head[0]).kind">{{ info(menu.head[0]).advice }}</span>
        <span v-if="info(menu.head[0]).last" class="t-capn c2" data-last-time>{{ info(menu.head[0]).last }}</span>
        <span v-if="info(menu.head[0]).best" class="t-capn best" data-new-best><Icon name="trophy" :size="12" /><span>{{ info(menu.head[0]).best }}</span></span>
      </div>
    </template>
  </PopMenu>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
.tnum { font-variant-numeric: tabular-nums; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

/* The rail's gutter holds both lanes; the rows sit to its right. No text selection or iOS callout on it: a long
   press is the set's menu. iOS ignores user-select on a long hold, so the list also cancels selectstart. */
.tl {
  --gutter: 56px; position: relative; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
}
.rail { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.rail path { stroke-width: var(--line-rail); stroke-linecap: round; }
.rail .done { stroke: var(--text-primary); }
.rail .done.lane1 { stroke: var(--text-secondary); }
.rail .next { stroke: var(--color-border-strong); stroke-dasharray: 2 5; }
.rail .fill { stroke: var(--color-action); stroke-width: 3; }

.ev { position: relative; display: flex; align-items: center; min-height: var(--control-hit); padding-left: var(--gutter); min-width: 0; }
.ev.start, .ev.merge { min-height: 28px; }
.ev.pause { min-height: 28px; }
.ev.part { min-height: 0; padding-top: var(--space-m); }
.ev.run { flex-direction: column; align-items: stretch; margin-top: var(--space-s); }
.ev.run > :deep(*) { min-width: 0; }

/* Every node sits in its own 44px, centred on its lane */
.nodehit {
  position: absolute; top: 50%; transform: translate(-50%, -50%); z-index: 1; width: var(--control-hit); height: var(--control-hit);
  padding: 0; border: 0; background: none; color: inherit; display: flex; align-items: center; justify-content: center;
}
button.nodehit:active .node { transform: scale(.88); }
button.nodehit:disabled { opacity: 1; }
/* The heading's node sits beside its first line, not halfway down the format panel. */
.ev.run .nodehit { top: 22px; }
.node {
  position: relative; box-sizing: border-box; flex: none; transition: transform .12s;
  width: 10px; height: 10px; border-radius: 50%; background: var(--color-bg); box-shadow: inset 0 0 0 2px var(--color-border-strong);
  display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
}
.ev.start.done .node, .ev.run.done .node, .ev.merge.done .node { background: var(--text-primary); box-shadow: none; }

/* The exercise: its photo on the rail, ⋯ on its corner */
.ev.exercise .node { width: 28px; height: 28px; background: none; box-shadow: none; }
.ph {
  width: 100%; height: 100%; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: var(--color-surface-2); box-shadow: 0 0 0 1.5px var(--color-border-strong);
}
.ph img { width: 100%; height: 100%; object-fit: cover; }
.ev.exercise.done .ph { box-shadow: 0 0 0 1.5px var(--text-primary); }
.ev.exercise.now .ph { box-shadow: 0 0 0 2px var(--color-action); }
.ev.exercise.next .ph { opacity: .8; }
.badge {
  position: absolute; right: -5px; bottom: -5px; width: 15px; height: 15px; border-radius: 50%;
  background: var(--color-surface-2); color: var(--text-primary); box-shadow: 0 0 0 2px var(--color-bg);
  display: flex; align-items: center; justify-content: center;
}
.nodehit[aria-expanded="true"] .badge { background: var(--text-primary); color: var(--color-bg); }

/* Sets: the number, a flame for a warm-up, stairs for a drop set, ✓ once done */
.ev.set .node { width: 18px; height: 18px; }
.nn { font-size: 9px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
.ev.set.done .node { width: 16px; height: 16px; background: var(--text-primary); box-shadow: none; color: var(--color-bg); }
.ev.l1.set.done .node { background: var(--text-secondary); }
.ev.set.now .node {
  width: 20px; height: 20px; color: var(--text-primary);
  box-shadow: inset 0 0 0 2px var(--color-action), 0 0 0 4px color-mix(in srgb, var(--color-action) 18%, transparent);
}

/* Rests: a small timer, filled once over; running, its ring fills with the countdown */
.ev.pause .node { width: 16px; height: 16px; box-shadow: none; background: var(--color-surface-2); color: var(--text-tertiary); }
.ev.pause.done .node { background: var(--text-primary); color: var(--color-bg); }
.ev.rest .node {
  width: 24px; height: 24px; box-shadow: none; color: var(--color-action);
  background:
    radial-gradient(closest-side, var(--color-bg) 76%, transparent 79%),
    conic-gradient(var(--color-action) calc(var(--p, 0) * 360deg), var(--color-border-strong) 0);
}
.row.restnow { flex: 1 1 auto; min-width: 0; gap: var(--space-xs); flex-wrap: nowrap; align-items: center; }
.row.cd { align-items: baseline; gap: var(--space-xs); flex-wrap: wrap; min-width: 0; }
.len { border: 0; background: none; padding: 0 var(--space-2xs); margin-left: calc(-1 * var(--space-2xs)); min-height: 28px; }
/* The ✓s: a small face in its 44px, its right edge where the times end on the rows above */
.tick { --s: var(--control-s-sm); justify-content: flex-end; }
.tick::before { right: 0; }
.tick > :deep(svg) { margin-right: 5px; }

/* The one + at the end */
.ev.add .node { width: 24px; height: 24px; color: var(--text-secondary); box-shadow: inset 0 0 0 1.5px var(--color-border-strong); }
.ev.add .node :deep(svg) { transition: transform .2s; }
.nodehit[aria-expanded="true"] .node { background: var(--text-primary); color: var(--color-bg); box-shadow: none; }
.nodehit[aria-expanded="true"] .node :deep(svg) { transform: rotate(45deg); }
.ev.exercise .nodehit[aria-expanded="true"] .node { background: none; }
.ev.exercise .nodehit[aria-expanded="true"] .node :deep(svg) { transform: none; }
.addword { border: 0; background: none; padding: 0; min-height: var(--control-hit); flex: 1 1 auto; text-align: left; }

/* An exercise's heading: its name and how it went or what's planned */
.row.exh { flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; }
.exbtn {
  flex: 1 1 auto; min-width: 0; gap: var(--space-2xs); padding: var(--space-s) 0; min-height: 48px; justify-content: center;
  border: 0; background: none; color: inherit; text-align: left;
}
.exname { overflow-wrap: anywhere; }
.ev.exercise.next .exname { color: var(--text-secondary); }
.letter { margin-right: var(--space-xs); }
.row.g2 { flex-wrap: nowrap; align-items: center; }
.trophy { display: inline-flex; flex: none; color: var(--color-action); }

/* A held set, while its menu is open */
.ev.set :deep(.setr.held) { background: var(--color-surface-2); border-radius: var(--radius-m); }

/* The menu's heading */
.mhead { gap: var(--space-s); flex-wrap: nowrap; align-items: center; padding: var(--space-xs) var(--space-s) var(--space-s); }
.mph { flex: none; width: 40px; height: 40px; border-radius: var(--radius-m); overflow: hidden; background: var(--color-surface-2); }
.mph img { width: 100%; height: 100%; object-fit: cover; }
.cap::first-letter { text-transform: uppercase; }
.infos { gap: var(--space-2xs); padding: 0 var(--space-s) var(--space-s); }
.best { color: var(--color-action); display: inline-flex; align-items: center; gap: var(--space-2xs); }
.best :deep(svg) { flex: none; }
.mhead, .infos { border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-xs); }
.mhead:has(+ .infos) { border-bottom: 0; margin-bottom: 0; }
</style>
