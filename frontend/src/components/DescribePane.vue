<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import {
  addLabel,
  DESCRIBE_TEXT_MAX,
  describeHint,
  describeNote,
  describeOfflineNote,
  describePlaceholder,
  recentLine,
  reviewTitle,
  searchSeed,
} from "../lib/describe";
import { recentSubtitle } from "../lib/foodSheet";
import { connection } from "../state/connection";
import { describe, editDescription, findFoods, toggleRow, useRecent } from "../state/describe";
import { deviceTimeZone } from "../state/profile";
import { foodUnit } from "../state/units";

// The Describe tab on Add food: a text box, then the foods Claude found, then Add.
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

const canFind = computed(() => describe.text.trim().length > 0 && !connection.offline);
const addText = computed(() => (props.needTime ? "Pick a time to add" : addLabel(describe.rows)));
const canAdd = computed(() => !props.needTime && !describe.adding && describe.rows.some((row) => row.on && row.food));

function onKey(event: KeyboardEvent) {
  // Enter finds, like a search. Shift+Enter is a new line.
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (canFind.value) void findFoods();
}
</script>

<template>
  <div class="dpane" data-describe>
    <div class="dscroll">
      <template v-if="describe.phase === 'write'">
        <label class="field dbox">
          <textarea
            v-model="describe.text"
            v-autofocus
            class="t-body"
            rows="4"
            :maxlength="DESCRIBE_TEXT_MAX"
            :placeholder="describePlaceholder"
            aria-label="What you ate"
            enterkeyhint="go"
            autocomplete="off"
            @keydown="onKey"
          />
        </label>
        <p class="t-label c2 hint">{{ describeHint }}</p>
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
                <span class="col grow tx">
                  <span class="t-body clamp">{{ recent.text }}</span>
                  <span class="t-label c2">{{ recentLine(recent, today, deviceTimeZone()) }}</span>
                </span>
                <Icon name="right" :size="16" class="c3" />
              </button>
            </li>
          </ul>
        </template>
      </template>

      <template v-else>
        <button type="button" class="well dtext" aria-label="Edit what you ate" :disabled="describe.adding" @click="editDescription">
          <span class="t-body grow">{{ describe.text }}</span>
          <Icon name="edit" :size="16" class="c2" />
        </button>

        <template v-if="describe.phase === 'finding'">
          <div class="lhead" role="status"><h3 class="t-cap c2 section-title">Finding foods…</h3></div>
          <ul class="rows" aria-hidden="true">
            <li v-for="width in [70, 80, 55, 65]" :key="width" class="drow">
              <span class="chk off faint" />
              <span class="col grow skc">
                <span class="sk" :style="{ width: width + '%' }" />
                <span class="sk thin" :style="{ width: width - 25 + '%' }" />
              </span>
            </li>
          </ul>
        </template>

        <template v-else>
          <div class="lhead">
            <h3 class="t-cap c2 section-title">{{ reviewTitle(describe.rows) }}</h3>
            <span class="grow" />
            <span v-if="describe.rows.some((row) => row.food)" class="t-capn c2">tap one to change it</span>
          </div>
          <ul class="rows" aria-label="Foods found">
            <li v-for="(row, index) in describe.rows" :key="row.key" class="drow" :class="{ top: !row.food }" :data-described="row.food ? 'found' : 'missing'">
              <template v-if="row.food">
                <button type="button" class="chkhit" :aria-pressed="row.on" :aria-label="`Include ${row.food.name}`" @click="toggleRow(index)">
                  <span class="chk" :class="{ off: !row.on }"><Icon v-if="row.on" name="check" :size="14" :sw="3" /></span>
                </button>
                <button type="button" class="pick grow" :class="{ dim: !row.on }" @click="emit('open', index)">
                  <span class="col grow tx">
                    <span class="row nm">
                      <span class="t-body ell">{{ row.food.name }}</span>
                      <span v-if="row.guessed" class="tag t-capn">guessed</span>
                    </span>
                    <span class="t-label c2">{{ recentSubtitle(row.food, row.amount, row.unit, foodUnit()) }}</span>
                    <span class="t-capn c3 quote">“{{ row.phrase }}”</span>
                  </span>
                  <Icon name="right" :size="16" class="c3" />
                </button>
              </template>
              <template v-else>
                <span class="chkhit"><span class="chk off" /></span>
                <span class="col grow miss">
                  <span class="col tx">
                    <span class="t-body">No match for “{{ row.phrase }}”</span>
                    <span class="t-label c2">Pick a food or type the calories.</span>
                  </span>
                  <span class="row gap8">
                    <button type="button" class="btn sm secondary t-label" @click="emit('search', searchSeed(row))"><Icon name="search" :size="14" /><span>Search</span></button>
                    <button type="button" class="btn sm secondary t-label" @click="emit('quick', row.name || row.phrase)">Quick add</button>
                  </span>
                </span>
              </template>
            </li>
          </ul>
          <p v-if="describe.error" class="err t-label" role="alert">{{ describe.error }}</p>
        </template>
      </template>
      <p class="t-capn c3 note">{{ describeNote }}</p>
    </div>

    <div class="dtray">
      <button v-if="describe.phase === 'write'" type="button" class="btn primary block t-bodys" :disabled="!canFind" @click="findFoods">
        <Icon name="sparkle" :size="18" /><span>Find foods</span>
      </button>
      <button v-else type="button" class="btn primary block t-bodys" :disabled="!canAdd" @click="emit('add')">
        {{ describe.phase === "finding" ? "Add" : addText }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dpane { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dscroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: var(--space-m); }
.dbox { align-items: flex-start; padding: var(--space-m); flex: none; }
.dbox textarea { border: 0; outline: 0; background: transparent; color: inherit; width: 100%; min-height: 104px; resize: none; font: inherit; padding: 0; }
.dbox textarea::placeholder { color: var(--text-tertiary); }
.hint, .note { margin: 0; }
.err { margin: 0; padding: var(--space-m); border-radius: var(--radius-l); border: 1px dashed var(--text-tertiary); }
.lhead { display: flex; align-items: center; gap: var(--space-s); margin-top: var(--space-s); }
.lhead h3 { margin: 0; }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.drow { display: flex; align-items: center; gap: var(--space-s); border-bottom: 1px solid var(--color-border); min-width: 0; }
.drow.top { align-items: flex-start; }
.pick { display: flex; align-items: center; gap: var(--space-m); min-height: var(--control-hit); padding: var(--space-m) 0; background: none; border: 0; color: inherit; text-align: left; min-width: 0; width: 100%; cursor: pointer; }
.pick.dim .tx { opacity: .55; }
.tx { gap: 2px; min-width: 0; }
.nm { gap: var(--space-s); min-width: 0; align-items: center; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.quote { font-style: italic; }
.chkhit { flex: none; display: inline-flex; align-items: center; justify-content: center; width: var(--control-hit); height: var(--control-hit); margin-left: calc((var(--control-hit) - 24px) / -2); background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
.drow.top .chkhit { margin-top: var(--space-s); }
span.chkhit { cursor: default; }
.chk { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--color-action); color: var(--color-on-action); }
.chk.off { background: transparent; box-shadow: inset 0 0 0 2px var(--text-tertiary); }
.chk.faint { opacity: .4; }
.drow:has(.chk.faint) { padding: var(--space-m) 0; }
.miss { gap: var(--space-s); padding: var(--space-m) 0; min-width: 0; }
.gap8 { gap: var(--space-s); flex-wrap: wrap; }
.skc { gap: 8px; }
.sk { display: block; height: 12px; border-radius: 6px; background: var(--color-surface-2); }
.sk.thin { height: 10px; }
.dtext { display: flex; align-items: flex-start; gap: var(--space-s); text-align: left; border: 0; color: inherit; cursor: pointer; flex: none; }
.dtray { flex: none; padding-top: var(--space-m); margin-top: var(--space-m); border-top: 1px solid var(--color-border); }
.dtray .btn :deep(svg) { flex: none; }
</style>
