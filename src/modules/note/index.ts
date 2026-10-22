import type { ModuleApi } from "../types.js";
import { registerNote } from "./command.js";
import noteTemplate from "../../../ui/modules/note/note.html";

/** `note [-e]` — the Markdown note of the Live Set (plan 0013); the page is ui/modules/note/note.html. */
export function activate(api: ModuleApi): void {
  registerNote(api, noteTemplate);
}
