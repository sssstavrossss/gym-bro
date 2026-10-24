import { ref } from "vue";
/** Only one row can be swiped open at a time. */
export const openRowId = ref<string | null>(null);
