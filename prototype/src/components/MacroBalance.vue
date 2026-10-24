<script setup lang="ts">
// Profile → Macro balance (decision 15). Hidden by default; presets first, exact numbers on request.
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";
import { DEFAULT_FAT, DEFAULT_PROTEIN, FAT_PRESETS, PROTEIN_PRESETS } from "../lib/nutrition";
import { keyboardEntry } from "../lib/viewport";
import { shown, state } from "../store";

const p = state.profile;
const open = ref(false);
const isDefault = computed(() => p.proteinPerKg === DEFAULT_PROTEIN && p.fatPct === DEFAULT_FAT);
const pKey = computed(() => PROTEIN_PRESETS.find((x) => x.value === p.proteinPerKg)?.key ?? "custom");
const fKey = computed(() => FAT_PRESETS.find((x) => x.value === p.fatPct)?.key ?? "custom");
const exact = ref(pKey.value === "custom" || fKey.value === "custom");
const summary = computed(() => {
  if (isDefault.value) return "Default";
  if (pKey.value === "custom" || fKey.value === "custom") return `Custom · ${p.proteinPerKg.toFixed(1)} g/kg · ${p.fatPct} %`;
  const name = (k: string) => k[0].toUpperCase() + k.slice(1);
  return `${name(pKey.value)} protein · ${name(fKey.value)} fat`;
});
const protein = computed({ get: () => pKey.value, set: (k: string) => { const v = PROTEIN_PRESETS.find((x) => x.key === k); if (v) p.proteinPerKg = v.value; } });
const fat = computed({ get: () => fKey.value, set: (k: string) => { const v = FAT_PRESETS.find((x) => x.key === k); if (v) p.fatPct = v.value; } });
const pOpts = PROTEIN_PRESETS.map((x) => ({ value: x.key as string, label: `${x.label} · ${x.value.toFixed(1)}` }));
const fOpts = FAT_PRESETS.map((x) => ({ value: x.key as string, label: `${x.label} · ${x.value} %` }));

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function step(key: "proteinPerKg" | "fatPct", d: number) {
  if (key === "proteinPerKg") p.proteinPerKg = clamp(Math.round((p.proteinPerKg + d) * 10) / 10, 1.2, 3.0);
  else p.fatPct = clamp(p.fatPct + d, 15, 40);
}
function typed(key: "proteinPerKg" | "fatPct", e: Event) {
  const el = e.target as HTMLInputElement;
  const n = Number(el.value.replace(",", "."));
  if (Number.isFinite(n) && n > 0) {
    if (key === "proteinPerKg") p.proteinPerKg = clamp(Math.round(n * 10) / 10, 1.2, 3.0);
    else p.fatPct = clamp(Math.round(n / 5) * 5, 15, 40);
  }
  el.value = key === "proteinPerKg" ? p.proteinPerKg.toFixed(1) : String(p.fatPct);
}
function reset() { p.proteinPerKg = DEFAULT_PROTEIN; p.fatPct = DEFAULT_FAT; exact.value = false; }
</script>

<template>
  <section class="card mb">
    <button type="button" class="row head" :aria-expanded="open" aria-controls="mb-body" @click="open = !open">
      <span class="col grow"><span class="t-body">Macro balance</span><span class="t-capn c2">{{ open ? "Customise protein and fat" : "Customise" }}</span></span>
      <span class="t-label" :class="isDefault ? 'c3' : ''">{{ summary }}</span>
      <Icon :name="open ? 'down' : 'right'" :size="16" class="c3" />
    </button>
    <div v-if="open" id="mb-body" class="col body">
      <div class="col grp">
        <div class="row"><span class="t-capm c2 grow">Protein</span><span class="t-label">{{ shown.p }} g</span><span class="t-capn c3">&nbsp;· g per kg</span></div>
        <Segmented v-model="protein" :options="pOpts" :height="34" />
      </div>
      <div class="col grp">
        <div class="row"><span class="t-capm c2 grow">Fat</span><span class="t-label">{{ shown.f }} g</span><span class="t-capn c3">&nbsp;· % of kcal</span></div>
        <Segmented v-model="fat" :options="fOpts" :height="34" />
      </div>
      <div class="row carbs"><span class="t-capm c2 grow">Carbs</span><span class="t-label">{{ shown.c }} g</span><span class="t-capn c3">&nbsp;· the rest</span></div>
      <p class="t-label c2 note">Carbs fill the rest of your calories — more carbs means less protein or fat.</p>

      <button v-if="!exact" type="button" class="t-label link" @click="exact = true">Exact numbers…</button>
      <div v-else class="row steppers">
        <div class="stepper row">
          <button type="button" class="t-head c2" aria-label="Less protein" :disabled="p.proteinPerKg <= 1.2" @click="step('proteinPerKg', -0.1)">−</button>
          <span class="grow center base cent">
            <input v-if="keyboardEntry" class="t-bodys sinput" :value="p.proteinPerKg.toFixed(1)" inputmode="decimal" aria-label="Protein, grams per kg (1.2–3.0)" @change="typed('proteinPerKg', $event)" />
            <span v-else class="t-bodys">{{ p.proteinPerKg.toFixed(1) }}</span><span class="t-label c2">g/kg</span>
          </span>
          <button type="button" class="t-head c2" aria-label="More protein" :disabled="p.proteinPerKg >= 3.0" @click="step('proteinPerKg', 0.1)">+</button>
        </div>
        <div class="stepper row">
          <button type="button" class="t-head c2" aria-label="Less fat" :disabled="p.fatPct <= 15" @click="step('fatPct', -5)">−</button>
          <span class="grow center base cent">
            <input v-if="keyboardEntry" class="t-bodys sinput" :value="p.fatPct" inputmode="numeric" aria-label="Fat, % of calories (15–40)" @change="typed('fatPct', $event)" />
            <span v-else class="t-bodys">{{ p.fatPct }}</span><span class="t-label c2">%</span>
          </span>
          <button type="button" class="t-head c2" aria-label="More fat" :disabled="p.fatPct >= 40" @click="step('fatPct', 5)">+</button>
        </div>
      </div>
      <p v-if="exact" class="t-capn c3 note">Protein 1.2–3.0 g/kg in 0.1 steps · fat 15–40 % in 5 % steps</p>
      <button v-if="!isDefault" type="button" class="t-label link" @click="reset">Reset to default (Normal · Normal)</button>
    </div>
  </section>
</template>

<style scoped>
.mb { padding: 0 16px; gap: 0; }
.head { gap: 10px; min-height: 56px; text-align: left; width: 100%; }
.body { gap: 14px; padding: 4px 0 16px; border-top: 1px solid var(--color-border); padding-top: 14px; }
.grp { gap: 8px; }
.carbs { padding-top: 2px; }
.note { margin: 0; }
.link { align-self: flex-start; color: var(--text-primary); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--text-tertiary); padding: 4px 0; }
.steppers { gap: 8px; }
.stepper { flex: 1 1 0; min-height: 44px; border-radius: 10px; padding: 0 4px; background: var(--color-surface-2); }
.stepper button { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }
.stepper button:disabled { opacity: .3; cursor: default; }
.center { text-align: center; }
.cent { justify-content: center; }
.sinput { width: 34px; text-align: right; background: transparent; border: 0; outline: 0; padding: 0; color: #fff; }
.sinput:focus { text-decoration: underline; text-underline-offset: 4px; text-decoration-color: var(--text-tertiary); }
.can-hover .head:hover .t-body { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--text-tertiary); }
</style>
