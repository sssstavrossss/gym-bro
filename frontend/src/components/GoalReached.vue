<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { kg } from "../lib/format";
import { dismissGoal } from "../lib/prompts";
import { boot } from "../state/boot";
import { commitProfile, profile } from "../state/profile";
import { toast } from "../ui";

const goal = computed(() => profile.saved?.goalWeightKg ?? null);
const trend = computed(() => profile.weight?.trendKg ?? null);

function keep() {
  const latest = profile.weight?.latestDate;
  if (latest && goal.value != null) dismissGoal(boot.accountId, latest, String(goal.value));
  toast("Keeping your current goal");
}

async function maintain() {
  profile.form.goal = "maintain";
  profile.form.rate = "";
  const ok = await commitProfile();
  if (!ok) return;
  toast("Switched to Maintain · new target from today");
}
</script>

<template>
  <section class="card gr" role="region" aria-labelledby="gr-h">
    <div class="row top">
      <span class="ic" aria-hidden="true"><Icon name="check" :size="18" :sw="2.6" /></span>
      <div class="col grow">
        <h2 id="gr-h" class="t-bodys m0">You've reached your goal weight</h2>
        <span class="t-label c2">Trend {{ trend != null ? kg(trend) : "—" }} kg · goal {{ goal != null ? kg(goal) : "—" }} kg</span>
      </div>
    </div>
    <p class="t-body m0">Switch to Maintain, or keep your current goal?</p>
    <div class="row btns">
      <button type="button" class="chip on t-label big" @click="maintain">Switch to Maintain</button>
      <button type="button" class="chip t-label big" @click="keep">Keep my goal</button>
    </div>
    <p class="t-capn c2 m0">Nothing changes until you choose. Maintain eats about what you burn.</p>
  </section>
</template>

<style scoped>
.gr { gap: 10px; border: 1px solid var(--color-border); }
.m0 { margin: 0; }
.top { gap: 12px; align-items: flex-start; }
.ic { width: 36px; height: 36px; border-radius: 18px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; flex: none; }
.btns { gap: 8px; flex-wrap: wrap; }
.chip.big { min-height: 44px; padding: 0 16px; border-radius: 22px; color: var(--text-primary); }
.chip.big.on { color: var(--color-on-action); }
</style>
