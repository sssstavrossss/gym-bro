<script setup lang="ts">
import Icon from "./Icon.vue";
import { recipeFigure, recipeMacro } from "../lib/recipes";
import type { Recipe } from "../api";

defineProps<{
  recipes: Recipe[];
  saving: boolean;
  heading?: string;
  activeIndex?: number;
}>();
const emit = defineEmits<{ add: [recipe: Recipe]; edit: [recipe: Recipe]; remove: [recipe: Recipe]; create: [] }>();
</script>

<template>
  <div v-if="recipes.length || heading" class="recipes col">
    <div class="row lhead">
      <span class="t-cap c3">{{ heading || "Recipes" }}</span>
      <span class="grow" />
      <button type="button" class="chip t-label" @click="emit('create')">
        <Icon name="plus" :size="14" :sw="2.4" /> New recipe
      </button>
    </div>
    <div v-for="(recipe, index) in recipes" :key="recipe.id" class="rrow row" :class="{ hl: activeIndex === index }">
      <span class="gic" aria-hidden="true"><Icon name="food" :size="16" /></span>
      <button type="button" class="col grow rtext" @click="emit('add', recipe)">
        <span class="row gap6 nm">
          <span class="t-body name" data-recipe-name>{{ recipe.name }}</span>
          <span class="mark t-capn">recipe</span>
        </span>
        <span class="t-label c2 detail" data-recipe-detail>
          <span>{{ recipe.ingredients.length }} foods · {{ recipeFigure(recipe.perPortion.kcal) }} kcal</span>
          <span> P {{ recipeMacro(recipe.perPortion.protein) }} · F {{ recipeMacro(recipe.perPortion.fat) }} · C {{ recipeMacro(recipe.perPortion.carbs) }} per portion<template v-if="recipe.finishedGrams"> · {{ recipeFigure(recipe.finishedGrams) }} g finished</template></span>
        </span>
      </button>
      <button type="button" class="cbtn" :aria-label="`Edit recipe ${recipe.name}`" :disabled="saving" @click="emit('edit', recipe)">
        <Icon name="edit" :size="16" />
      </button>
      <button type="button" class="cbtn" :aria-label="`Delete recipe ${recipe.name}`" :disabled="saving" @click="emit('remove', recipe)">
        <Icon name="trash" :size="16" />
      </button>
      <button type="button" class="cbtn filled" :aria-label="`Log recipe ${recipe.name}`" :disabled="saving" @click="emit('add', recipe)">
        <Icon name="plus" :size="18" :sw="2.4" />
      </button>
    </div>
    <div v-if="heading && !recipes.length" class="empty col">
      <span class="t-bodys">No recipes yet</span>
      <span class="t-label c2">Build one from foods you log. It saves as a single entry.</span>
    </div>
  </div>
</template>

<style scoped>
.recipes { gap: 0; }
.lhead { padding: 10px 0 2px; gap: 8px; }
.rrow { min-height: 56px; align-items: flex-start; gap: calc(var(--space-gap) / 3); padding: calc(var(--space-gap) / 2) 0; border-bottom: 1px solid var(--color-border); }
.rrow.hl { background: var(--color-surface-2); border-radius: 12px; }
.gic { width: 32px; height: 32px; margin-top: 6px; border-radius: 10px; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); flex: none; }
.empty { gap: 4px; padding: 8px 0 16px; }
.rtext { gap: 2px; min-width: 0; min-height: var(--control-hit); align-items: flex-start; justify-content: center; text-align: left; }
.nm { align-items: baseline; min-width: 0; max-width: 100%; }
.name { flex: 1 1 0; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.detail { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.gap6 { gap: 6px; }
.mark { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--color-border); color: var(--text-secondary); white-space: nowrap; flex: none; }
.empty { margin: 0; padding: 8px 0 12px; }
</style>
