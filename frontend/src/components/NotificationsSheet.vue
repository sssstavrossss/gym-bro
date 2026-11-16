<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import CappedList from "./CappedList.vue";
import Icon from "./Icon.vue";
import { getInbox, markAllNotificationsRead, putNotificationType, type InboxItem, type NotificationSettings } from "../api";
import { recentNotes } from "../lib/inboxView";
import { enableReminders, getNotifications, notificationHint } from "../lib/notifications";
import { deviceTimeZone, profile } from "../state/profile";
import { inbox } from "../state/inbox";
import { closeSheet, ui } from "../ui";

const open = computed(() => ui.sheet === "notifications");
const items = ref<InboxItem[]>([]);
const loaded = ref(false);
const notes = ref<NotificationSettings | null>(null);
const error = ref("");
const busy = ref(false);
const hint = notificationHint();
const list = computed(() => recentNotes(items.value, profile.form.timeZone || deviceTimeZone()));

const reminderLine = computed(() => {
  if (!notes.value) return "Monday morning";
  if (!notes.value.configured) return "Monday morning · push isn't set up on the server";
  return `Monday morning · push ${notes.value.enabled ? "on" : "off"} on this device`;
});
const typeOn = computed(() => {
  const settings = notes.value;
  if (!settings?.configured) return false;
  return settings.types?.find((item) => item.id === "recalculate")?.enabled ?? false;
});

/** Opening the sheet reads what's in it. The reminder shown on Home stays open until it's acted on there. */
async function load() {
  error.value = "";
  void getNotifications().then((value) => { notes.value = value; }).catch(() => { error.value = "Couldn't load notification settings."; });
  try {
    const body = await getInbox();
    items.value = body.items;
    inbox.unread = body.unread;
    loaded.value = true;
    if ((body.badge ?? 0) > 0) {
      await markAllNotificationsRead();
      inbox.badge = 0;
    }
  } catch {
    loaded.value = true;
    error.value = "Couldn't load notifications.";
  }
}
watch(open, (value) => { if (value) void load(); });

async function onType() {
  if (!notes.value || busy.value) return;
  busy.value = true;
  error.value = "";
  const next = !typeOn.value;
  try {
    if (next && notes.value.configured && !notes.value.enabled) {
      notes.value = await enableReminders(notes.value);
    }
    notes.value = await putNotificationType("recalculate", next);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "Couldn't update reminders.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BottomSheet :open="open" label="Notifications" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow">Notifications</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div class="col body" data-notifications-sheet>
      <CappedList v-if="list.length" tag="ul" :max-rows="5" :watch-key="list.length" class="notes" data-note-list>
        <li v-for="note in list" :key="note.id" class="note" :class="{ done: note.state === 'done', tall: Boolean(note.body) }">
          <span class="nic" aria-hidden="true"><Icon name="refresh" :size="15" /></span>
          <span class="col grow ntext">
            <span class="t-bodys nlabel">{{ note.label }}</span>
            <span v-if="note.body" class="t-label c2">{{ note.body }}</span>
          </span>
          <span class="col side">
            <span class="t-capn c3 when">{{ note.state === "done" ? `Done · ${note.date}` : note.date }}</span>
            <RouterLink v-if="note.state === 'today'" to="/today" class="tag t-capn" data-on-today @click="closeSheet">On Today</RouterLink>
            <span v-else-if="note.state === 'new'" class="tag t-capn">New</span>
          </span>
        </li>
      </CappedList>
      <p v-else-if="loaded" class="t-body c2 m0" data-no-notes>Nothing yet. Reminders you turn on below show up here.</p>

      <h3 class="t-cap c3 m0 sub">Reminders</h3>
      <button
        type="button"
        class="srow"
        role="switch"
        :aria-checked="typeOn"
        :disabled="busy || !notes?.configured"
        data-reminder-switch
        @click="onType"
      >
        <span class="col grow">
          <span class="t-body">Weekly recalculate reminder</span>
          <span class="t-capn c2">{{ reminderLine }}</span>
        </span>
        <span class="switch" :class="{ on: typeOn }" aria-hidden="true"><i /></span>
      </button>
      <p v-if="hint" class="t-capn c2 m0">{{ hint }}</p>
      <p v-if="error" class="t-body m0" role="alert">{{ error }}</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: center; }
.m0 { margin: 0; overflow-wrap: anywhere; }
.body { gap: var(--space-m); }
.sub { margin-top: var(--space-xs); }
.body :deep(.notes) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.note { display: flex; gap: var(--space-m); align-items: center; padding: var(--space-m) 0; border-bottom: 1px solid var(--color-border); min-width: 0; }
.note:last-child { border-bottom: 0; }
.note.tall { align-items: flex-start; }
.nic { width: 28px; height: 28px; border-radius: 50%; background: var(--color-surface-2); color: var(--text-secondary); display: grid; place-items: center; flex: none; }
.ntext { min-width: 0; gap: var(--space-2xs); overflow-wrap: anywhere; }
.done .nlabel { font-weight: 500; color: var(--text-secondary); }
.side { align-items: flex-end; gap: var(--space-xs); flex: none; }
.when { white-space: nowrap; font-variant-numeric: tabular-nums; }
.tag { padding: var(--space-2xs) var(--space-s); border-radius: var(--radius-xs); border: 0; background: var(--color-action); color: var(--color-on-action); font-weight: 600; text-decoration: none; white-space: nowrap; }
.srow { min-height: 52px; width: 100%; display: flex; align-items: center; gap: var(--space-m); text-align: left; padding: 0; }
.srow:disabled { opacity: 1; }
.switch { position: relative; width: 46px; height: 28px; border-radius: var(--radius-l); background: var(--color-track); flex: none; transition: background .15s; }
.switch i { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: var(--radius-m); background: var(--text-tertiary); transition: transform .15s, background .15s; }
.switch.on { background: var(--color-action); }
.switch.on i { transform: translateX(18px); background: var(--color-on-action); }
.srow:disabled .switch { opacity: .45; }
:global(html.dt-xl) .note { flex-wrap: wrap; }
:global(html.dt-xl) .side { flex-direction: row; align-items: center; }
</style>
