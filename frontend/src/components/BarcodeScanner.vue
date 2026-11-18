<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "./Icon.vue";
import { ApiError, lookupBarcode, type FoodSearchRow } from "../api";
import { cameraCopy, formatBarcode, fromTyped, missCopy, type CameraProblem, type MissStatus } from "../lib/barcode";
import { CameraError, startCameraScan, type CameraScan } from "../scanner/camera";

const emit = defineEmits<{ found: [food: FoodSearchRow]; create: [code: string] }>();

type Mode = "camera" | "typing" | "looking" | "miss";
const mode = ref<Mode>("camera");
/** Where the code came from, so "Scan again" goes back there. */
const origin = ref<"camera" | "typing">("camera");
const code = ref("");
const miss = ref<MissStatus>("not_found");
const problem = ref<CameraProblem | null>(null);
const starting = ref(false);
const typed = ref("");
const typedError = ref("");
const videoEl = ref<HTMLVideoElement | null>(null);
const typedEl = ref<HTMLInputElement | null>(null);
let scan: CameraScan | null = null;
/** Bumped on every start and stop, so a camera that opens after the person left is closed at once. */
let cameraGen = 0;
let lookupGen = 0;

async function startCamera() {
  stopCamera();
  mode.value = "camera";
  origin.value = "camera";
  problem.value = null;
  starting.value = true;
  const gen = ++cameraGen;
  await nextTick();
  const video = videoEl.value;
  if (gen !== cameraGen || !video) return;
  try {
    const started = await startCameraScan(video, (read) => {
      scan = null;
      navigator.vibrate?.(30);
      void look(read);
    });
    if (gen !== cameraGen) started.stop();
    else scan = started;
  } catch (error) {
    if (gen === cameraGen) problem.value = error instanceof CameraError ? error.problem : "failed";
  } finally {
    if (gen === cameraGen) starting.value = false;
  }
}

function stopCamera() {
  cameraGen++;
  scan?.stop();
  scan = null;
}

async function look(next: string) {
  stopCamera();
  code.value = next;
  mode.value = "looking";
  const gen = ++lookupGen;
  try {
    const body = await lookupBarcode(next);
    if (gen !== lookupGen) return;
    if (body.status === "found" && body.food) {
      emit("found", body.food);
      return;
    }
    miss.value = body.status === "found" ? "not_found" : body.status;
  } catch (error) {
    if (gen !== lookupGen) return;
    miss.value = error instanceof ApiError ? "unavailable" : "offline";
  }
  mode.value = "miss";
}

function typeNumber() {
  stopCamera();
  mode.value = "typing";
  origin.value = "typing";
  typedError.value = "";
  void nextTick(() => typedEl.value?.focus());
}

function submitTyped() {
  const next = fromTyped(typed.value);
  if (!next) {
    typedError.value = "A barcode is 8 to 14 digits.";
    return;
  }
  typedError.value = "";
  void look(next);
}

function again() {
  if (miss.value !== "not_found") void look(code.value);
  else if (origin.value === "typing") typeNumber();
  else void startCamera();
}

/** A phone stops the camera when the app goes to the background; start it again on return. */
function onVisibility() {
  if (mode.value !== "camera") return;
  if (document.hidden) stopCamera();
  else void startCamera();
}

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibility);
  void startCamera();
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility);
  lookupGen++;
  stopCamera();
});
</script>

<template>
  <div class="scan col" data-scanner>
    <template v-if="mode === 'camera'">
      <div class="view" :class="{ off: problem }">
        <video ref="videoEl" class="video" playsinline muted aria-hidden="true" />
        <div v-if="!problem" class="frame" aria-hidden="true">
          <i class="corner tl" /><i class="corner tr" /><i class="corner bl" /><i class="corner br" />
          <i class="line" />
        </div>
        <p class="hint t-label" role="status">
          <template v-if="problem">{{ cameraCopy(problem) }}</template>
          <template v-else-if="starting">Starting the camera…</template>
          <template v-else>Hold the barcode inside the frame</template>
        </p>
      </div>
      <button type="button" class="btn sm secondary block t-label" @click="typeNumber">Type the number</button>
      <p class="t-capn c2 m0">A food we know opens straight on its amount. Codes we don't have are looked up on Open Food Facts.</p>
    </template>

    <form v-else-if="mode === 'typing'" class="col typing" novalidate @submit.prevent="submitTyped">
      <label class="fl col"><span class="t-capm c2">Barcode number</span>
        <input ref="typedEl" v-model="typed" class="field t-body num" inputmode="numeric" autocomplete="off" enterkeyhint="search" placeholder="Number under the barcode" :aria-invalid="Boolean(typedError)" />
      </label>
      <p v-if="typedError" class="t-label m0" role="alert">{{ typedError }}</p>
      <div class="row pair">
        <button type="button" class="btn sm secondary t-label" @click="startCamera">Use the camera</button>
        <button type="submit" class="btn sm primary t-label">Look up</button>
      </div>
    </form>

    <div v-else class="well res col">
      <span class="row code"><Icon name="scan" :size="22" /><span class="t-bodys num">{{ formatBarcode(code) }}</span></span>
      <span v-if="mode === 'looking'" class="t-body c2" role="status">Looking it up…</span>
      <template v-else>
        <span class="t-body c2" role="status">{{ missCopy(miss) }}</span>
        <div class="row pair">
          <button type="button" class="btn sm secondary t-label" @click="again">{{ miss === "not_found" ? "Scan again" : "Try again" }}</button>
          <button type="button" class="btn sm primary t-label" @click="emit('create', code)">Create food</button>
        </div>
        <span class="t-capn c2">The new food keeps this barcode, so the next scan finds it.</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scan { gap: var(--space-m); }
.m0 { margin: 0; }
.view { position: relative; aspect-ratio: 1 / 1; max-height: 56vh; width: 100%; border-radius: var(--radius-l); overflow: hidden; background: #000; }
.view.off { background: var(--color-surface-2); }
.video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.view.off .video { display: none; }
.frame { position: absolute; left: 12%; right: 12%; top: 37%; height: 26%; pointer-events: none; }
.corner { position: absolute; width: 28px; height: 28px; border: solid #fff; }
.tl { top: 0; left: 0; border-width: 3px 0 0 3px; border-top-left-radius: 12px; }
.tr { top: 0; right: 0; border-width: 3px 3px 0 0; border-top-right-radius: 12px; }
.bl { bottom: 0; left: 0; border-width: 0 0 3px 3px; border-bottom-left-radius: 12px; }
.br { bottom: 0; right: 0; border-width: 0 3px 3px 0; border-bottom-right-radius: 12px; }
.line { position: absolute; left: 8%; right: 8%; top: 50%; height: 2px; background: var(--color-action); box-shadow: 0 0 12px var(--color-action); }
.hint { position: absolute; left: var(--space-m); right: var(--space-m); bottom: var(--space-l); margin: 0; text-align: center; color: #fff; text-shadow: 0 1px 4px #000; }
.view.off .hint { top: 50%; bottom: auto; transform: translateY(-50%); color: var(--text-primary); text-shadow: none; }
.typing { gap: var(--space-m); }
.fl { gap: var(--space-xs); }
.res { gap: var(--space-m); align-items: flex-start; padding: var(--space-l); }
.code { gap: var(--space-s); align-items: center; }
.pair { gap: var(--space-s); width: 100%; }
.pair > .btn { flex: 1 1 0; min-width: 0; }
@media (prefers-reduced-motion: no-preference) {
  .line { animation: sweep 1.6s ease-in-out infinite alternate; }
}
@keyframes sweep { from { top: 15%; } to { top: 85%; } }
</style>
