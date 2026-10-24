<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const title = computed(() => String(route.meta.title ?? ""));
const body = computed(() => String(route.meta.body ?? ""));
</script>

<template>
  <main class="screen">
    <header class="screen-head">
      <h1 class="t-title">{{ title }}</h1>
    </header>
    <section class="card">
      <p class="t-body c2">{{ body }}</p>
    </section>
  </main>
</template>
