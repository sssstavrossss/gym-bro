<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import ExerciseBrowser from "./ExerciseBrowser.vue";
import ExerciseRow from "./ExerciseRow.vue";
import { getSwaps, type SwapsResponse } from "../api";
import { exercises } from "../state/exercises";

// The workout sheet's swap screen (docs/training.md, phase 5): the same movement first, then the same main muscle,
// then the whole library.
const props = defineProps<{ exerciseId: string }>();
const emit = defineEmits<{ pick: [string] }>();
const data = ref<SwapsResponse | null>(null);
const state = ref<"loading" | "ready" | "failed">("loading");
const broken = reactive(new Set<string>());

onMounted(async () => {
  try {
    data.value = await getSwaps(props.exerciseId);
    state.value = "ready";
  } catch {
    state.value = "failed";
  }
});

const byId = computed(() => new Map(exercises.items.map((item) => [item.id, item])));
const groups = computed(() => {
  const options = data.value?.options ?? [];
  const pick = (why: string) => options.filter((option) => option.why === why).map((option) => byId.value.get(option.id)).filter((item) => item != null);
  return [
    { id: "movement", label: "Same movement", items: pick("movement") },
    { id: "muscle", label: "Same muscle", items: pick("muscle") },
  ].filter((group) => group.items.length);
});
</script>

<template>
  <div class="col swaps">
    <p v-if="state === 'loading'" class="t-label c2 m0 note">Finding similar exercises…</p>
    <p v-else-if="state === 'failed'" class="t-label c2 m0 note">Couldn't load similar exercises. Pick one from the library below.</p>
    <p v-else-if="data?.planKit" class="t-capn c2 m0" data-swap-kit>These fit your plan's equipment and go-easy areas.</p>
    <section v-for="group in groups" :key="group.id" class="col" :aria-labelledby="`swap-${group.id}`" :data-swap-group="group.id">
      <h2 :id="`swap-${group.id}`" class="t-cap c3 section-title m0">{{ group.label }}</h2>
      <ul class="list">
        <li v-for="item in group.items" :key="item.id">
          <ExerciseRow :item="item" action="swap" :broken="broken" @pick="emit('pick', $event)" />
        </li>
      </ul>
    </section>
    <ExerciseBrowser title="All exercises" title-id="swap-all-title" action="swap" @pick="emit('pick', $event)" />
  </div>
</template>

<style scoped>
.m0 { margin: 0; }
.swaps { gap: var(--space-m); padding-top: var(--space-s); }
.note { padding-block: var(--space-s); }
.list { list-style: none; margin: 0; padding: 0; }
</style>
