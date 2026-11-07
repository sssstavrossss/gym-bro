<script setup lang="ts">
import { signIn } from "../auth/session";
import { boot } from "../state/boot";

function onSignIn() {
  if (boot.config) void signIn(boot.config);
}
</script>

<template>
  <main class="signin">
    <div class="signin-card">
      <header class="screen-head">
        <h1 class="t-title">Gym Bro</h1>
      </header>
      <p class="t-body c2">Sign in to set up your profile and targets.</p>
      <p v-if="boot.configError" class="alert" role="alert">{{ boot.configError }}</p>
      <button v-else type="button" class="primary-btn t-bodys" @click="onSignIn">Sign in</button>
    </div>
  </main>
</template>

<style scoped>
.signin {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: calc(var(--sat) + 24px) var(--space-screen) calc(var(--sab) + 24px);
}
.signin-card {
  width: min(100%, 480px);
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-gap);
  min-width: 0;
}
.signin-card .t-title,
.signin-card p {
  overflow-wrap: anywhere;
}
</style>
