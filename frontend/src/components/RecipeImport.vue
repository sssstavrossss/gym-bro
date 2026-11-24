<script setup lang="ts">
import { computed } from "vue";
import FoundRows from "./FoundRows.vue";
import Icon from "./Icon.vue";
import { importHint, importNote, importPlaceholder, importSource, importTitle, importUseLabel, RECIPE_IMPORT_MAX } from "../lib/recipeImport";
import { chosenRows, describeLeftShownAt, leftLine } from "../lib/describe";
import { connection } from "../state/connection";
import { describe } from "../state/describe";
import { deviceTimeZone } from "../state/profile";
import { findIngredients, recipeImport, toggleImportRow } from "../state/recipeImport";

// The import step of New recipe: paste, find, check. Use hands the checked rows to the recipe form.

const emit = defineEmits<{
  use: [];
  open: [index: number];
  search: [seed: string, index: number];
}>();

const finding = computed(() => recipeImport.phase === "finding");
const canFind = computed(() => !finding.value && !connection.offline && describe.left > 0 && importSource(recipeImport.text) != null);
const canUse = computed(() => chosenRows(recipeImport.rows).length > 0);
const left = computed(() => (describe.left <= describeLeftShownAt ? leftLine({ limit: describe.limit, left: describe.left, nextAt: describe.nextAt }, deviceTimeZone()) : ""));

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canFind.value) {
    event.preventDefault();
    void findIngredients();
  }
}
</script>

<template>
  <div class="ipane" data-recipe-import>
    <div class="iscroll">
      <template v-if="recipeImport.phase !== 'review'">
        <label class="field ibox">
          <textarea
            v-model="recipeImport.text"
            class="t-body"
            rows="6"
            :maxlength="RECIPE_IMPORT_MAX"
            :placeholder="importPlaceholder"
            :disabled="finding"
            aria-label="Recipe link or ingredients"
            autocomplete="off"
            data-no-autofocus
            @keydown="onKey"
          />
        </label>
        <p class="t-label c2 m0">{{ importHint }}</p>
        <p v-if="recipeImport.error" class="err t-label" role="alert">{{ recipeImport.error }}</p>
        <p v-if="connection.offline" class="well t-label c2" role="status">Importing needs a connection. Add ingredient works offline.</p>
        <FoundRows v-if="finding" :rows="[]" title="" finding="Finding ingredients…" label="Ingredients found" />
      </template>
      <template v-else>
        <div v-if="recipeImport.name || recipeImport.site" class="well src">
          <Icon name="download" :size="18" class="c2" />
          <span class="col grow">
            <span class="t-body ell">{{ recipeImport.name || "Pasted ingredients" }}</span>
            <span class="t-label c2">{{ [recipeImport.site, recipeImport.portions ? `${recipeImport.portions} portions` : ""].filter(Boolean).join(" · ") }}</span>
          </span>
        </div>
        <FoundRows
          :rows="recipeImport.rows"
          :title="importTitle(recipeImport.rows)"
          label="Ingredients found"
          @toggle="toggleImportRow"
          @open="emit('open', $event)"
          @search="(seed, index) => emit('search', seed, index)"
        />
      </template>
      <p class="t-capn c3 m0">{{ importNote }}</p>
    </div>

    <div class="itray">
      <button v-if="recipeImport.phase !== 'review'" type="button" class="btn primary block t-bodys" :disabled="!canFind" @click="findIngredients">
        <Icon name="sparkle" :size="18" /><span>Find ingredients</span>
      </button>
      <button v-else type="button" class="btn primary block t-bodys" :disabled="!canUse" @click="emit('use')">{{ importUseLabel(recipeImport.rows) }}</button>
      <p v-if="left && recipeImport.phase !== 'review'" class="t-capn c3 left" role="status">{{ left }}</p>
    </div>
  </div>
</template>

<style scoped>
.ipane { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.iscroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: var(--space-m); }
.m0 { margin: 0; }
.ibox { padding: var(--space-m); align-items: stretch; flex: none; }
.ibox textarea { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; resize: none; font: inherit; padding: 0; }
.ibox textarea::placeholder { color: var(--text-tertiary); }
.err { margin: 0; padding: var(--space-m); border-radius: var(--radius-l); border: 1px dashed var(--text-tertiary); }
.src { display: flex; align-items: center; gap: var(--space-m); flex: none; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.itray { flex: none; padding-top: var(--space-m); margin-top: var(--space-m); border-top: 1px solid var(--color-border); }
.itray .btn :deep(svg) { flex: none; }
.left { margin: var(--space-s) 0 0; text-align: center; }
</style>
