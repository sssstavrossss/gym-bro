<script setup lang="ts">
import { computed } from "vue";
import DescribeBox from "./DescribeBox.vue";
import FoundRows from "./FoundRows.vue";
import Icon from "./Icon.vue";
import {
  addLabel,
  clearedLine,
  describeHint,
  describeNote,
  describeOfflineNote,
  describePhotoAlone,
  describePhotoHint,
  describePhotoPlaceholder,
  describePlaceholder,
  describeRetryPrompt,
  leftLine,
  noteText,
  recentLine,
  reviewTitle,
} from "../lib/describe";
import { connection } from "../state/connection";
import {
  attachPhoto,
  canDescribe,
  cancelRevise,
  clearReview,
  describe,
  findAgain,
  findFoods,
  removePhoto,
  restoreReview,
  startRevise,
  toggleRow,
  useRecent,
} from "../state/describe";
import { deviceTimeZone } from "../state/profile";
import { toast } from "../ui";

// The Describe tab on Add food: words, a photo or both, then the foods Claude found, then Add.
// Logging and the amount screen belong to the food sheet, so this pane only asks for them.

const props = defineProps<{
  today: string;
  /** A past or planned day with no time picked: Add waits for one. */
  needTime: boolean;
}>();

const emit = defineEmits<{
  open: [index: number];
  search: [query: string];
  quick: [name: string];
  add: [];
}>();

const finding = computed(() => describe.phase === "finding");
const spent = computed(() => describe.limit > 0 && describe.left === 0);
const canSend = computed(() => !connection.offline && !finding.value && !spent.value);
const canFind = computed(() => canSend.value && canDescribe(describe.text, describe.photo));
const canFindAgain = computed(() => canSend.value && canDescribe(describe.draft, describe.draftPhoto));
/** The words at the top of the review, or what Claude saw when only a photo was sent. */
const sentText = computed(() => describe.text || (describe.photo ? describePhotoAlone : noteText({ text: "", photo: describe.fromPhoto, seen: describe.seen })));
const addText = computed(() => (props.needTime ? "Pick a time to add" : addLabel(describe.rows)));
const canAdd = computed(() => !props.needTime && !describe.adding && !describe.revising && describe.rows.some((row) => row.on && row.food));
const left = computed(() => leftLine(describe, deviceTimeZone()));

/** × on your words: back to an empty Describe, with Undo in case it was a slip (a new find would cost one of the day's). */
function clear() {
  const shown = sentText.value;
  const kept = clearReview();
  if (kept) toast(clearedLine(shown), { label: "Undo", run: () => void restoreReview(kept) });
}

// Enter finds, like a search. Shift+Enter is a new line.
function entered(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
  event.preventDefault();
  return true;
}
function onKey(event: KeyboardEvent) {
  if (entered(event) && canFind.value) void findFoods();
}
function onDraftKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    cancelRevise();
    return;
  }
  if (entered(event) && canFindAgain.value) void findAgain();
}
</script>

<template>
  <div class="dpane" data-describe>
    <div class="dscroll">
      <template v-if="describe.phase === 'write'">
        <DescribeBox
          v-model="describe.text"
          :photo-url="describe.photo?.url ?? null"
          :placeholder="describe.photo ? describePhotoPlaceholder : describePlaceholder"
          :reading="describe.readingPhoto"
          @keydown="onKey"
          @pick="attachPhoto($event)"
          @remove="removePhoto()"
        />
        <p class="t-label c2 hint">{{ describe.photo ? describePhotoHint : describeHint }}</p>
        <p v-if="describe.error" class="err t-label" role="alert">{{ describe.error }}</p>
        <p v-if="connection.offline" class="well t-label c2" role="status">{{ describeOfflineNote }}</p>
        <template v-if="describe.recent.length">
          <div class="lhead">
            <h3 class="t-cap c2 section-title">Recent</h3>
            <span class="grow" />
            <span class="t-capn c2">tap to use again</span>
          </div>
          <ul class="rows" aria-label="Recent descriptions">
            <li v-for="recent in describe.recent" :key="recent.id">
              <button type="button" class="drow pick" :disabled="connection.offline" @click="useRecent(recent)">
                <span v-if="recent.photo" class="cam" aria-label="From a photo"><Icon name="camera" :size="18" /></span>
                <span class="col grow tx">
                  <span class="t-body clamp">{{ noteText(recent) }}</span>
                  <span class="t-label c2">{{ recentLine(recent, today, deviceTimeZone()) }}</span>
                </span>
                <Icon name="right" :size="16" class="c3" />
              </button>
            </li>
          </ul>
        </template>
      </template>

      <template v-else>
        <DescribeBox
          v-if="describe.revising"
          v-model="describe.draft"
          focus
          data-describe-draft
          :photo-url="describe.draftPhoto?.url ?? null"
          :placeholder="describe.draftPhoto ? describePhotoPlaceholder : describePlaceholder"
          :disabled="finding"
          :reading="describe.readingPhoto"
          @keydown="onDraftKey"
          @pick="attachPhoto($event, 'draftPhoto')"
          @remove="removePhoto('draftPhoto')"
        />
        <div v-else class="well dcard">
          <button type="button" class="dtext" aria-label="Edit what you ate" :disabled="describe.adding || finding" @click="startRevise">
            <img v-if="describe.photo" :src="describe.photo.url" alt="Your photo" class="wthumb" />
            <span v-else-if="describe.fromPhoto" class="cam" aria-label="From a photo"><Icon name="camera" :size="18" /></span>
            <span class="t-body grow" :class="{ c2: !describe.text }">{{ sentText }}</span>
            <Icon name="edit" :size="16" class="c2" />
          </button>
          <button type="button" class="clr c2" aria-label="Clear and start over" data-describe-clear :disabled="describe.adding || finding" @click="clear"><Icon name="x" :size="16" /></button>
        </div>
        <p v-if="describe.revising && describe.error" class="err t-label" role="alert">{{ describe.error }}</p>

        <FoundRows v-if="finding" :rows="[]" title="" finding="Finding foods…" label="Foods found" />

        <div v-else class="review" :class="{ dim: describe.revising }" :inert="describe.revising || undefined">
          <FoundRows
            :rows="describe.rows"
            :title="reviewTitle(describe.rows)"
            label="Foods found"
            quick
            @toggle="toggleRow"
            @open="emit('open', $event)"
            @search="(seed) => emit('search', seed)"
            @quick="emit('quick', $event)"
          />
          <p v-if="!describe.revising && describe.error" class="err t-label" role="alert">{{ describe.error }}</p>
          <div v-if="!describe.revising" class="retry" data-describe-retry>
            <span class="t-label c2">{{ describeRetryPrompt }}</span>
            <button type="button" class="btn sm secondary t-label" :disabled="describe.adding" @click="startRevise">Edit and try again</button>
          </div>
        </div>
      </template>
      <p class="t-capn c3 note">{{ describeNote }}</p>
    </div>

    <div class="dtray">
      <button v-if="describe.phase === 'write'" type="button" class="btn primary block t-bodys" data-toast-floor :disabled="!canFind" @click="findFoods">
        <Icon name="sparkle" :size="18" /><span>{{ describe.retryable ? "Try again" : "Find foods" }}</span>
      </button>
      <div v-else-if="describe.revising" class="row pair">
        <button type="button" class="btn secondary t-bodys" @click="cancelRevise">Cancel</button>
        <button type="button" class="btn primary t-bodys grow" :disabled="!canFindAgain" @click="findAgain">
          <Icon name="sparkle" :size="18" /><span>{{ describe.retryable ? "Try again" : "Find again" }}</span>
        </button>
      </div>
      <button v-else type="button" class="btn primary block t-bodys" data-toast-floor :disabled="!canAdd" @click="emit('add')">
        {{ finding ? "Add" : addText }}
      </button>
      <p v-if="left && (describe.phase === 'write' || describe.revising)" class="t-capn c3 left" role="status">{{ left }}</p>
    </div>
  </div>
</template>

<style scoped>
.dpane { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dscroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: var(--space-m); }
.hint, .note { margin: 0; }
.err { margin: 0; padding: var(--space-m); border-radius: var(--radius-l); border: 1px dashed var(--text-tertiary); }
.lhead { display: flex; align-items: center; gap: var(--space-s); margin-top: var(--space-s); }
.lhead h3 { margin: 0; }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.drow { display: flex; align-items: center; gap: var(--space-s); border-bottom: 1px solid var(--color-border); min-width: 0; }
.pick { display: flex; align-items: center; gap: var(--space-m); min-height: var(--control-hit); padding: var(--space-m) 0; background: none; border: 0; color: inherit; text-align: left; min-width: 0; width: 100%; cursor: pointer; }
.tx { gap: 2px; min-width: 0; }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* The words (tap to edit) and × (start over) share the box. The box's padding moves onto the words' button so all of it
   but the × edits; the × is a 44px hit at the end, as in the search field. */
.dcard { display: flex; align-items: center; padding: 0; flex: none; }
.dtext { display: flex; align-items: center; gap: var(--space-m); flex: 1 1 auto; min-width: 0; padding: var(--space-m) 0 var(--space-m) var(--space-m); background: none; text-align: left; border: 0; color: inherit; cursor: pointer; }
.clr { width: var(--control-hit); height: var(--control-hit); display: inline-flex; align-items: center; justify-content: center; flex: none; background: none; border: 0; padding: 0; cursor: pointer; }
.clr:disabled, .dtext:disabled { cursor: default; }
.wthumb { width: var(--control-hit); height: var(--control-hit); border-radius: var(--radius-s); object-fit: cover; flex: none; }
/* A photo isn't kept, so a camera tile stands in for it on a recent one. */
.cam { width: var(--control-hit); height: var(--control-hit); border-radius: var(--radius-s); background: var(--color-surface-2); color: var(--text-secondary); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.well .cam { background: var(--color-hover); }
.dtray { flex: none; padding-top: var(--space-m); margin-top: var(--space-m); border-top: 1px solid var(--color-border); }
.dtray .btn :deep(svg) { flex: none; }
.pair { gap: var(--space-s); }
.pair > .btn.secondary { flex: none; padding-inline: var(--space-l); }
.pair > .btn.primary { flex: 1 1 auto; }
.left { margin: var(--space-s) 0 0; text-align: center; }
.review { display: flex; flex-direction: column; gap: var(--space-m); }
.review.dim { opacity: .4; }
.retry { display: flex; align-items: center; justify-content: space-between; gap: var(--space-m); flex-wrap: wrap; }
</style>
