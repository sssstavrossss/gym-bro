<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getHealth, getMe, type HealthResponse, type MeResponse } from "./api";
import { isConfigured, loadPublicConfig, type PublicConfig } from "./auth/publicConfig";
import { accessToken, currentAccount, signIn, signOut } from "./auth/session";

const config = ref<PublicConfig | null>(null);
const configError = ref("");
const accountName = ref("");
const signedIn = ref(false);
const health = ref<HealthResponse | null>(null);
const healthError = ref("");
const me = ref<MeResponse | null>(null);
const meError = ref("");
const busy = ref(false);

const ready = computed(() => config.value !== null && isConfigured(config.value));
const heading = computed(() => me.value?.displayName || accountName.value || "there");

onMounted(async () => {
  try {
    health.value = await getHealth();
  } catch (error) {
    healthError.value = message(error, "Health check failed.");
  }

  try {
    config.value = await loadPublicConfig();
  } catch (error) {
    configError.value = message(error, "Could not load sign-in settings.");
    return;
  }

  const loaded = config.value;
  if (loaded === null || !isConfigured(loaded)) {
    configError.value = "Entra settings are empty. Copy .env.example to .env, fill it in, and restart the API.";
    return;
  }

  try {
    const account = await currentAccount(loaded);
    signedIn.value = account !== null;
    accountName.value = account?.name ?? account?.username ?? "";
    if (account) {
      await refreshMe();
    }
  } catch (error) {
    meError.value = message(error, "Sign-in failed.");
  }
});

async function refreshMe(): Promise<void> {
  if (!config.value) return;
  meError.value = "";
  const token = await accessToken(config.value);
  if (!token) return;
  const result = await getMe(token);
  if (result.user) {
    me.value = result.user;
    return;
  }
  meError.value = `The API rejected the token (${result.status}). ${result.body}`.trim();
}

async function onSignIn(): Promise<void> {
  if (!config.value) return;
  busy.value = true;
  meError.value = "";
  try {
    await signIn(config.value);
  } catch (error) {
    meError.value = message(error, "Sign-in failed.");
    busy.value = false;
  }
}

async function onSignOut(): Promise<void> {
  if (!config.value) return;
  busy.value = true;
  try {
    await signOut(config.value);
  } catch (error) {
    meError.value = message(error, "Sign-out failed.");
    busy.value = false;
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
</script>

<template>
  <main>
    <header>
      <p class="mark">Gym Bro</p>
      <h1 v-if="signedIn">Hello, {{ heading }}</h1>
      <h1 v-else>Sign in to say hello</h1>
      <p class="lede">
        Phase 0 checks that Microsoft sign-in, the API, and Postgres all talk to each other.
        Nutrition tracking comes later.
      </p>
    </header>

    <p class="health" :data-state="health?.databaseReachable ? 'up' : 'down'">
      <template v-if="health">
        API {{ health.status }}. Database {{ health.databaseReachable ? "reachable" : "unreachable" }}.
      </template>
      <template v-else-if="healthError">{{ healthError }}</template>
      <template v-else>Checking the API…</template>
    </p>

    <p v-if="configError" class="error" role="alert">{{ configError }}</p>

    <section v-if="ready && !signedIn" class="card">
      <p>Sign in with the Entra External ID account for this app. The button sends you to Microsoft and back.</p>
      <button type="button" :disabled="busy" @click="onSignIn">
        {{ busy ? "Redirecting…" : "Sign in" }}
      </button>
    </section>

    <section v-else-if="signedIn" class="card">
      <p class="eyebrow">From <code>GET /api/me</code></p>
      <dl v-if="me">
        <div>
          <dt>Name</dt>
          <dd>{{ me.displayName || "Not in the token" }}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{{ me.email || "Not in the token" }}</dd>
        </div>
        <div>
          <dt>Object id</dt>
          <dd><code>{{ me.objectId }}</code></dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd>{{ formatTime(me.firstSeenAt) }}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{{ formatTime(me.lastSeenAt) }}</dd>
        </div>
      </dl>
      <p v-else-if="!meError">Asking the API who you are…</p>
      <p v-if="meError" class="error" role="alert">{{ meError }}</p>
      <button type="button" class="secondary" :disabled="busy" @click="onSignOut">Sign out</button>
    </section>
  </main>
</template>
