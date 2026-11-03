import type { ModuleApi } from "../types.js";
import { registerMap } from "./command.js";
import capturePage from "../../../ui/modules/midi/capture.html";

/** `map` — MIDI controls that run command lines (plan 0018); the learn page is ui/modules/midi/capture.html. */
export function activate(api: ModuleApi): void {
  registerMap(api, capturePage);
}
