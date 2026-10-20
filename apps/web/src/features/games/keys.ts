import { STORAGE_PREFIX } from "@/constants";

/** The games' device keys (`kakure.games.*`), under the prefix Forget this device clears. */
export const gameKey = (name: string): string => `${STORAGE_PREFIX}games.${name}`;
