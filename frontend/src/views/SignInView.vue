<script setup lang="ts">
import { signIn } from "../auth/session";
import { boot } from "../state/boot";

function onSignIn() {
  if (boot.config) void signIn(boot.config);
}
</script>

<template>
  <main class="screen setup">
    <header class="screen-head">
      <h1 class="t-title">Gym Bro</h1>
    </header>
    <p class="t-body c2">Sign in to set up your profile and targets.</p>
    <p v-if="boot.configError" class="alert" role="alert">{{ boot.configError }}</p>
    <button v-else type="button" class="primary-btn t-bodys" @click="onSignIn">Sign in</button>
  </main>
</template>

<style scoped>
.setup { max-width: 480px; }
</style>
