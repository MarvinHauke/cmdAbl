import type { ModuleApi } from "../types.js";
import tagEditorTemplate from "../../../ui/modules/tag/editor.html";
import { activate as activateTag } from "./command.js";

export { changeLines } from "./command.js";

/** The tag module: `command.ts` holds the commands (testable); the editor page is imported here. */
export function activate(api: ModuleApi): void {
  activateTag(api, tagEditorTemplate);
}
