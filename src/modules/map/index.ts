import type { ModuleApi } from "../types.js";
import { registerMap } from "./command.js";

/** `map` — MIDI controls that run command lines (plan 0018). */
export function activate(api: ModuleApi): void {
  const { sync } = registerMap(api);
  // Told once the script answers and whenever another Set opens; every map command syncs again too.
  api.onSetChange(() => void sync().catch(() => {}));
}
