<script setup lang="ts">
// Decision 12 + S7: the trend reached the goal weight → ask; nothing changes without an answer.
import { computed } from "vue";
import Icon from "./Icon.vue";
import { int, kg } from "../lib/format";
import { goalReached, keepGoal, state, switchToMaintain, trendWeight } from "../store";
import { toast } from "../ui";
const p = state.profile;
const manual = computed(() => p.goalMode === "manual");
function keep() { keepGoal(); toast(manual.value ? `Keeping ${int(p.manualKcal ?? 0)} kcal` : "Keeping your current goal"); }
function maintain() { switchToMaintain(); toast("Switched to Maintain · new target from today"); }
</script>

<template>
  <section v-if="goalReached" class="card gr" role="region" aria-labelledby="gr-h">
    <div class="row top"><span class="ic" aria-hidden="true"><Icon name="check" :size="18" :sw="2.6" /></span>
      <div class="col grow"><h2 id="gr-h" class="t-bodys m0">You've reached your goal weight</h2>
        <span class="t-label c2">Trend {{ kg(trendWeight) }} kg · goal {{ kg(p.goalWeight) }} kg</span></div></div>
    <p class="t-body m0">{{ manual ? `Keep ${int(p.manualKcal ?? 0)} kcal, or switch to Maintain?` : "Switch to Maintain, or keep your current goal?" }}</p>
    <div class="row btns">
      <button type="button" class="chip on t-label big" @click="maintain">Switch to Maintain</button>
      <button type="button" class="chip t-label big" @click="keep">{{ manual ? `Keep ${int(p.manualKcal ?? 0)} kcal` : "Keep my goal" }}</button>
    </div>
    <p class="t-capn c2 m0">Nothing changes until you choose. Maintain eats about what you burn.</p>
  </section>
</template>

<style scoped>
.gr { gap: 10px; border: 1px solid var(--color-border-strong); }
.m0 { margin: 0; }
.top { gap: 12px; }
.ic { width: 36px; height: 36px; border-radius: 18px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; flex: none; }
.btns { gap: 8px; flex-wrap: wrap; }
.chip.big { min-height: 44px; padding: 0 16px; border-radius: 22px; color: var(--text-primary); }
.chip.big.on { color: var(--color-on-action); }
</style>
