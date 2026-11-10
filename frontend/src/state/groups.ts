import { reactive } from "vue";
import {
  ApiError,
  createGroup,
  deleteGroup,
  listGroups,
  logGroup,
  ServerUnreachable,
  type SavedGroup,
} from "../api";
import { log, rememberEntries, type LogEntry } from "./log";
import { toast } from "../ui";

export const savedGroups = reactive({
  list: [] as SavedGroup[],
  loaded: false,
});

let generation = 0;

export async function loadGroups(): Promise<void> {
  const gen = ++generation;
  try {
    const body = await listGroups();
    if (gen !== generation) return;
    savedGroups.list = body.groups;
    savedGroups.loaded = true;
  } catch (error) {
    if (error instanceof ServerUnreachable) log.unreachable = true;
  }
}

export async function saveGroupFromEntries(
  name: string,
  entryIds: string[],
): Promise<{ ok: true; group: SavedGroup } | { ok: false; message: string }> {
  try {
    const group = await createGroup({ name, entryIds });
    savedGroups.list = [group, ...savedGroups.list.filter((row) => row.id !== group.id)];
    savedGroups.loaded = true;
    return { ok: true, group };
  } catch (error) {
    if (error instanceof ServerUnreachable) {
      log.unreachable = true;
      return { ok: false, message: "Server unreachable, try again." };
    }
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't save that group." };
  }
}

export async function deleteSavedGroup(id: string): Promise<boolean> {
  try {
    await deleteGroup(id);
    savedGroups.list = savedGroups.list.filter((group) => group.id !== id);
    return true;
  } catch (error) {
    if (error instanceof ServerUnreachable) log.unreachable = true;
    toast(error instanceof ApiError ? error.message : "Couldn't delete that group.");
    return false;
  }
}

export async function readdSavedGroup(
  id: string,
  input: { localDate: string; timeZone: string; time: string | null; idempotencyKey: string },
): Promise<{ ok: true; entries: LogEntry[]; notice: string } | { ok: false; message: string }> {
  try {
    const body = await logGroup(id, input);
    return { ok: true, entries: rememberEntries(body.entries), notice: body.notice };
  } catch (error) {
    if (error instanceof ServerUnreachable) {
      log.unreachable = true;
      return { ok: false, message: "Server unreachable, try again." };
    }
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't add that group." };
  }
}
