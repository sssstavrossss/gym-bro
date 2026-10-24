import { reactive } from "vue";
import type { PublicConfig } from "../auth/publicConfig";

export const boot = reactive({
  ready: false,
  signedIn: false,
  accountId: "",
  name: "",
  configError: "",
  config: null as PublicConfig | null,
});
