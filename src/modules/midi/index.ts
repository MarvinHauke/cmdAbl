import type { ModuleApi } from "../types.js";
import { registerMidi } from "./command.js";
import capturePage from "../../../ui/modules/midi/capture.html";

/** `midi monitor` — what the controller sends (plan 0018); the page is ui/modules/midi/capture.html. */
export function activate(api: ModuleApi): void {
  registerMidi(api, capturePage);
}
