<script setup lang="ts">
import { ref } from "vue";
import Icon from "./Icon.vue";
import { DESCRIBE_TEXT_MAX } from "../lib/describe";

// The box on Describe: the words, and a photo of the meal. Either one is enough. The first description
// and "Edit and try again" both use it, so the photo looks and works the same in both. The photo sits
// on the left with the words beside it, so long words stay in their column, never under the photo.

defineProps<{
  /** The thumbnail of the photo to send, or null. */
  photoUrl: string | null;
  placeholder: string;
  /**
   * Take focus on mount. Only "Edit and try again", where tapping it means typing. Opening Describe keeps
   * the keyboard down, like Search, so Recent and "Add a photo" stay in view.
   */
  focus?: boolean;
  disabled?: boolean;
  /** A picked photo is still being read. */
  reading?: boolean;
}>();

const text = defineModel<string>({ required: true });

const emit = defineEmits<{
  keydown: [event: KeyboardEvent];
  pick: [file: File];
  remove: [];
}>();

const input = ref<HTMLInputElement | null>(null);

function picked() {
  const file = input.value?.files?.[0];
  if (file) emit("pick", file);
  // The same photo can be picked again after it is removed.
  if (input.value) input.value.value = "";
}
</script>

<template>
  <div class="field dbox">
    <div class="body">
      <div v-if="photoUrl" class="thumb">
        <img :src="photoUrl" alt="Your photo" />
        <button type="button" class="tx" aria-label="Remove the photo" :disabled="disabled" @click="emit('remove')">
          <span><Icon name="x" :size="12" :sw="2.6" /></span>
        </button>
      </div>
      <!-- A hidden copy of the words sizes the box, so every line shows (the autosize grid used by the amount fields). -->
      <div class="autosize t-body">
        <span class="mirror" aria-hidden="true">{{ (text || placeholder) + " " }}</span>
        <textarea
          v-model="text"
          v-autofocus="focus"
          :data-no-autofocus="focus ? undefined : ''"
          rows="1"
          :maxlength="DESCRIBE_TEXT_MAX"
          :placeholder="placeholder"
          :disabled="disabled"
          aria-label="What you ate"
          enterkeyhint="go"
          autocomplete="off"
          @keydown="emit('keydown', $event)"
        />
      </div>
    </div>
    <div v-if="!photoUrl" class="foot">
      <!-- Without capture, a phone offers both the camera and the photo library. -->
      <input ref="input" type="file" accept="image/*" hidden data-describe-photo-input @change="picked" />
      <button type="button" class="btn sm secondary t-label" :disabled="disabled || reading" @click="input?.click()">
        <Icon name="camera" :size="14" /><span>{{ reading ? "Reading photo…" : "Add a photo" }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dbox {
  flex-direction: column; align-items: stretch; gap: var(--space-s); padding: var(--space-m); flex: none;
  /* The empty box's height inside its padding: three lines, the gap, and the photo button's row (its 44px
     target less the overhang below). A photo is this tall, so adding one doesn't change the box. */
  --dbox-inner: calc(64px + var(--space-s) + var(--control-hit) - (var(--control-hit) - var(--control-chip)) / 2);
}
/* The photo and the words are two columns: the words keep to theirs and grow with them. */
.body { display: flex; align-items: flex-start; gap: var(--space-l); }
/* Three lines empty, so the hint still shows above the keyboard; it grows as you write. */
.autosize { display: grid; flex: 1; min-width: 0; min-height: 64px; }
/* Beside a photo the words are at least as tall as it, and more words grow the box. */
.thumb + .autosize { min-height: var(--dbox-inner); }
.autosize > * { grid-area: 1 / 1; padding: 0; font: inherit; letter-spacing: inherit; white-space: pre-wrap; overflow-wrap: break-word; }
.mirror { visibility: hidden; }
/* main.css sets every phone field to at least 16px so iOS doesn't zoom; the copy must match the field. */
@media (hover: none) and (pointer: coarse) {
  .mirror { font-size: max(16px, 1rem); }
}
.dbox textarea { border: 0; outline: 0; background: transparent; color: inherit; min-width: 0; overflow: hidden; resize: none; }
.dbox textarea::placeholder { color: var(--text-tertiary); }
/* The small button keeps its 44px target: the face sits at the box's padding and the target overhangs it. */
.foot { display: flex; margin-bottom: calc((var(--control-hit) - var(--control-chip)) / -2); }
.foot .btn { --btn-bg: var(--color-hover); }
.thumb { position: relative; width: var(--dbox-inner); height: var(--dbox-inner); flex: none; }
.thumb img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-m); }
/* A 24px disc on the corner, in a 44px target. */
.tx {
  position: absolute; top: calc(var(--control-hit) / -2 + var(--space-xs)); right: calc(var(--control-hit) / -2 + var(--space-xs));
  width: var(--control-hit); height: var(--control-hit); display: flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: none; color: var(--text-primary); cursor: pointer;
}
.tx span { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--color-bg); box-shadow: 0 0 0 1px var(--color-border); }
.tx:disabled { opacity: .4; cursor: default; }
</style>
