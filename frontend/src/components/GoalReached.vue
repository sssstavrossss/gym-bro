<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { keepGoal } from "../api";
import { dismissGoal } from "../lib/prompts";
import { boot } from "../state/boot";
import { commitProfile, profile } from "../state/profile";
import { weightUnit, wt } from "../state/units";
import { toast } from "../ui";

const goal = computed(() => profile.saved?.goalWeightKg ?? null);
const trend = computed(() => profile.weight?.trendKg ?? null);

/** Hidden at once for this visit, and saved on the account so other devices hide it too. */
function keep() {
  const latest = profile.weight?.latestDate;
  if (latest && goal.value != null) dismissGoal(boot.accountId, latest, String(goal.value));
  toast("Keeping your current goal");
  void keepGoal().then(() => {
    if (profile.weight) profile.weight = { ...profile.weight, goalReached: false };
  }, () => {
    // Offline: it stays hidden for this visit and comes back on the next one.
  });
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
  <section class="card outline gr" role="region" aria-labelledby="gr-h">
    <div class="row top">
      <span class="disc filled" aria-hidden="true"><Icon name="check" :size="16" :sw="2.6" /></span>
      <div class="col grow">
        <h2 id="gr-h" class="t-bodys section-title m0">You've reached your goal weight</h2>
        <span class="t-label c2">Trend {{ trend != null ? wt(trend) : "—" }} {{ weightUnit() }} · goal {{ goal != null ? wt(goal) : "—" }} {{ weightUnit() }}</span>
      </div>
    </div>
    <p class="t-body m0">Switch to Maintain, or keep your current goal?</p>
    <div class="row btns">
      <button type="button" class="btn sm primary t-label" @click="maintain">Switch to Maintain</button>
      <button type="button" class="btn sm secondary t-label" @click="keep">Keep my goal</button>
    </div>
    <p class="t-capn c2 m0">Nothing changes until you choose. Maintain eats about what you burn.</p>
  </section>
</template>

<style scoped>
.m0 { margin: 0; }
.top { gap: var(--space-m); align-items: flex-start; }
.btns { gap: var(--space-s); flex-wrap: wrap; }
</style>
