<script setup lang="ts">
import { DESCRIBE_WORKOUT_MAX, describeWorkoutHint, describeWorkoutNote, describeWorkoutPlaceholder } from "../lib/describeWorkout";
import { connection } from "../state/connection";
import { workoutDescribe } from "../state/workoutDescribe";

// The workout sheet's Describe screen: the words, a hint, and what went wrong. The sheet's footer has the button.
const emit = defineEmits<{ find: [] }>();

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    emit("find");
  }
}
</script>

<template>
  <div class="col body" data-workout-describe>
    <label class="field dbox">
      <textarea
        v-model="workoutDescribe.text"
        class="t-body"
        rows="5"
        :maxlength="DESCRIBE_WORKOUT_MAX"
        :placeholder="describeWorkoutPlaceholder"
        :disabled="workoutDescribe.finding"
        aria-label="What you did"
        autocomplete="off"
        data-no-autofocus
        @keydown="onKey"
      />
    </label>
    <p class="t-label c2 m0">{{ describeWorkoutHint }}</p>
    <p v-if="workoutDescribe.error" class="err t-label" role="alert">{{ workoutDescribe.error }}</p>
    <p v-if="connection.offline" class="well t-label c2 m0" role="status">Describing needs a connection. + Exercise works offline.</p>
    <p v-if="workoutDescribe.finding" class="t-label c2 m0" role="status">Finding exercises…</p>
    <p class="t-capn c3 m0">{{ describeWorkoutNote }}</p>
  </div>
</template>

<style scoped>
.m0 { margin: 0; }
.body { gap: var(--space-m); padding-bottom: var(--space-l); }
.dbox { padding: var(--space-m); align-items: stretch; flex: none; }
.dbox textarea { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; resize: none; font: inherit; padding: 0; }
.dbox textarea::placeholder { color: var(--text-tertiary); }
.err { margin: 0; padding: var(--space-m); border-radius: var(--radius-l); border: 1px dashed var(--text-tertiary); }
</style>
