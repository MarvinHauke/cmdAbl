import type { ModuleApi } from "../types.js";
import { fillTemplate } from "../../core/inlineJson.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";

const NOTE_WIDTH = 640;
const NOTE_HEIGHT = 520;

/**
 * `note [-e]` — one Markdown note per Live Set (plan 0013). The Set carries an id (kept by the Remote
 * Script); the note is the file `<id>.md` in this module's folder of the extension's data folder. The page
 * answers once when it closes: "" = nothing changed (or dismissed), "\n" = the text was cleared, anything
 * else = the full new text. `changed: true` tells the page the text is not yet saved (it comes from a failed save), so
 * Save sends it even when the user did not edit it. A Set only gets its id when there is a text to keep, so looking at the note
 * never changes the Set. `template` is the note page (ui/modules/note/note.html), given by index.ts.
 */
export function registerNote(api: ModuleApi, template: string): void {
  // Text that could not be saved. It stays in memory (never in the log: a note can hold anything) until the
  // next save succeeds or cmdAbl restarts; the next `note` opens in edit with it.
  let pending: string | null = null;

  api.commands.add({
    name: "note",
    topic: "Look things up",
    summary: "open the note of this Live Set",
    description:
      "Opens the Markdown note that belongs to this Live Set, for reminders: headings, lists, checkboxes, tables and code are drawn, " +
      "links are shown as text. note opens it to read; note -e opens it to edit, and so does a Set that has no note yet. " +
      "In the page, e switches to editing, Cmd+S saves and closes, and Esc closes (with unsaved changes it warns first). " +
      "The note is a plain Markdown file in cmdAbl's data folder, linked to the Set by an id stored inside the Set, so it follows the Set " +
      "when it is renamed or saved under another name (both copies then share one note). The Set gets its id the first time a note is saved, " +
      "which marks the Set as changed: save it so the link is kept. Needs the cmdAbl Remote Script. A saved note shows nothing; the log has one line.",
    examples: [
      { line: "note", note: "read the note of this Set" },
      { line: "note -e", note: "open the note to edit" },
    ],
    requires: ["bridge"],
    options: [{ name: "edit", short: "e", summary: "open the note to edit instead of to read" }],
    run: async (invocation): Promise<CommandResult | void> => {
      // Reading never creates an id: a Set nobody wrote a note for stays as it is.
      let id = await api.set.id(false);
      const stored = id === null ? null : await api.files.read(`${id}.md`);
      // null can mean "no note" or "could not be read": the write below checks again.
      let text = stored ?? "";
      // Text from a save that failed comes back, after the note that is there now.
      if (pending !== null) text = text.trim() === "" ? pending : `${text.replace(/\s+$/, "")}\n\n${pending}`;
      const mode = invocation.options.edit === true || text.trim() === "" || pending !== null ? "edit" : "view";

      const answer = await api.dialog(fillTemplate(template, { NOTE: { text, mode, changed: pending !== null } }), NOTE_WIDTH, NOTE_HEIGHT, "note");
      if (!answer) return; // unchanged, or dismissed
      const next = answer.trim() === "" ? "" : answer; // "\n" = cleared

      if (id === null) {
        id = await api.set.id(true);
        if (id === null) return keep(next, "this Set could not be given an id (is the Remote Script running?)");
      }
      // The page may have started empty because the id or the file could not be read, not because there is no note:
      // never replace a note that is there now.
      if (stored === null) {
        const now = await api.files.read(`${id}.md`);
        if (now !== null && now.trim() !== "") return keep(next, "this Set already has a note that could not be read before");
      }
      if (!(await api.files.write(`${id}.md`, next))) return keep(next, "the file could not be written");
      pending = null;
      return { ...ok(), log: [`note saved (${next.length} characters, set ${id})`] };
    },
  });

  /** A save that failed: say so and keep the text in memory (not in the log) for the next `note`. */
  function keep(text: string, why: string): CommandResult {
    pending = text.trim() === "" ? null : text;
    return {
      ...fail(ExitCode.FAILURE, `note: not saved — ${why}. Run note again: your text is kept until cmdAbl restarts.`),
      log: [`note not saved: ${why} (${text.length} characters kept in memory)`],
    };
  }
}
