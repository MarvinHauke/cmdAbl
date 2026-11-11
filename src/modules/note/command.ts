import type { Loop, ModuleApi } from "../types.js";
import { fillTemplate } from "../../core/surfaces/inlineJson.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { buildStamp, loopForStamp, parseAnswer, shouldRestoreLoop, type PageThen, type StampInfo } from "./stamp.js";

const NOTE_WIDTH = 640;
const NOTE_HEIGHT = 520;

/**
 * `note [-e]` and `stamp` — one Markdown note per Live Set (plan 0013). The Set carries an id (kept by the Remote
 * Script); the note is the file `<id>.md` in this module's folder of the extension's data folder. The page
 * answers once when it closes, as JSON `{"text": string | null, "then": "stamp" | "view" | null}`: `text` null = nothing
 * changed (or dismissed), "" = the text was cleared, anything else = the full new text; `then` = what follows the save: "stamp" (m pressed), "view" (Esc in stamp edit),
 * null (done). `changed: true` tells the page the text is not yet saved (it comes from a failed
 * save), so Save sends it even when the user did not edit it. A Set only gets its id when there is a text to keep,
 * so looking at the note never changes the Set. `template` is the note page (ui/modules/note/note.html), given by index.ts.
 *
 * Stamp round (`stamp`, or `then: "stamp"`): read the transport, build the heading, maybe loop the current bars
 * while the user writes, open the page in mode "stamp", save, and put the old loop back (only if nobody moved ours).
 */
export function registerNote(api: ModuleApi, template: string, now: () => Date = () => new Date()): void {
  // Text that could not be saved. It stays in memory (never in the log: a note can hold anything) until the
  // next save succeeds or cmdAbl restarts; the next `note` opens in edit with it.
  let pending: string | null = null;

  /** Read the note, open the page, write what came back. Returns what to do next and the result when something failed. */
  async function session(mode: "view" | "edit" | "stamp", stamp?: StampInfo): Promise<{ then: PageThen; result?: CommandResult }> {
    // Reading never creates an id: a Set nobody wrote a note for stays as it is.
    let id = await api.set.id(false);
    const stored = id === null ? null : await api.files.read(`${id}.md`);
    // null can mean "no note" or "could not be read": the write below checks again.
    let text = stored ?? "";
    // Text from a save that failed comes back, after the note that is there now.
    if (pending !== null) text = text.trim() === "" ? pending : `${text.replace(/\s+$/, "")}\n\n${pending}`;
    const shown = mode === "stamp" ? "stamp" : mode === "edit" || text.trim() === "" || pending !== null ? "edit" : "view";
    const input: Record<string, unknown> = { text, mode: shown, changed: pending !== null };
    if (shown === "stamp" && stamp) input.stamp = stamp;

    const answer = parseAnswer(await api.dialog(fillTemplate(template, { NOTE: input }), NOTE_WIDTH, NOTE_HEIGHT, "note"));
    const then = answer.then;
    if (answer.text === null) {
      // unchanged, or dismissed; an unreadable answer leaves a trace
      if (answer.unreadable) api.logger.warn("note: unreadable page answer (treated as unchanged)");
      return { then };
    }
    const next = answer.text.trim() === "" ? "" : answer.text;

    if (id === null) {
      id = await api.set.id(true);
      if (id === null) return { then, result: keep(next, "this Set could not be given an id (is the Remote Script running?)") };
    }
    // The page may have started empty because the id or the file could not be read, not because there is no note:
    // never replace a note that is there now.
    if (stored === null) {
      const now = await api.files.read(`${id}.md`);
      if (now !== null && now.trim() !== "") return { then, result: keep(next, "this Set already has a note that could not be read before") };
    }
    if (!(await api.files.write(`${id}.md`, next))) return { then, result: keep(next, "the file could not be written") };
    pending = null;
    return { then, result: { ...ok(), log: [`note saved (${next.length} characters, set ${id})`] } };
  }

  /**
   * One round of the page loop: for a stamp, read the transport, build the heading and maybe set the loop; open
   * the page; save; and put the old loop back whatever the save did (only if nobody moved ours).
   */
  async function round(mode: "view" | "edit" | "stamp"): Promise<{ then: PageThen; result?: CommandResult; log: string[] }> {
    if (mode !== "stamp") return { ...(await session(mode)), log: [] };
    const transport = await api.set.transport();
    const info = buildStamp(transport, now());
    const wanted = loopForStamp(transport, await api.settings.get<boolean>("stampLoop"), await api.settings.get<number>("loopBars"));
    let old: Loop | null = null;
    let set: Loop | null = null;
    if (wanted !== null && transport !== null) {
      old = transport.loop;
      set = await api.set.setLoop(wanted);
    }
    const log: string[] = [];
    try {
      return { ...(await session("stamp", info)), log };
    } finally {
      if (old !== null && set !== null) {
        const current = (await api.set.transport())?.loop ?? null;
        if (shouldRestoreLoop(current, set)) {
          if ((await api.set.setLoop(old)) !== null) log.push("note: loop put back");
          else api.logger.warn("note: loop not restored: the Remote Script did not answer");
        } else log.push("note: loop left alone (it was moved meanwhile)");
      }
    }
  }

  /**
   * The page loop: open the page, and on each answer save the text, restore this round's loop, then act on `then`:
   * "stamp" opens the stamp page, "view" reopens the note to read, null ends. A failed save ends the loop with
   * exit 1 (the text stays pending).
   */
  async function pageLoop(first: "view" | "edit" | "stamp"): Promise<CommandResult | void> {
    const log: string[] = [];
    let mode = first;
    let wrote = false;
    for (;;) {
      const r = await round(mode);
      log.push(...(r.result?.log ?? []), ...r.log);
      if (r.result) {
        if (r.result.code !== ExitCode.OK) return { ...r.result, log };
        wrote = true;
      }
      if (r.then === null) break;
      mode = r.then;
    }
    return wrote || log.length > 0 ? { ...ok(), log } : undefined;
  }

  api.commands.add({
    name: "note",
    topic: "Look things up",
    summary: "open the note of this Live Set",
    description:
      "Opens the Markdown note that belongs to this Live Set, for reminders: headings, lists, checkboxes, tables and code are drawn, " +
      "links are shown as text. note opens it to read; note -e opens it to edit, and so does a Set that has no note yet. " +
      "The stamp command adds a stamp (a new entry with the song position and the time). " +
      "In the page, e switches to editing, m adds a stamp, Cmd+S saves and closes; Esc in edit goes back to reading and keeps the text, and Esc while reading saves and closes (Discard asks once). " +
      "The note is a plain Markdown file in cmdAbl's data folder, linked to the Set by an id stored inside the Set, so it follows the Set " +
      "when it is renamed or saved under another name (both copies then share one note). The Set gets its id the first time a note is saved, " +
      "which marks the Set as changed: save it so the link is kept. Needs the cmdAbl Remote Script. A saved note shows nothing; the log has one line.",
    examples: [
      { line: "note", note: "read the note of this Set" },
      { line: "note -e", note: "open the note to edit" },
    ],
    requires: ["bridge"],
    options: [{ name: "edit", short: "e", summary: "open the note to edit instead of to read" }],
    run: (invocation) => pageLoop(invocation.options.edit === true ? "edit" : "view"),
  });

  api.commands.add({
    name: "stamp",
    topic: "Look things up",
    summary: "add a stamp to the note: song position and time, then write below it",
    description:
      "Adds a stamp to the note of this Live Set: a new entry at the end with a heading that holds the song position (while the song plays) " +
      "and the date and time; you write below it. The page opens in edit. While Arrangement playback runs, the next bars loop so the music repeats while you write " +
      "(settings note.stampLoop and note.loopBars). Esc saves and goes to reading the note, where m adds the next stamp; closing the page puts the loop back as it was, " +
      "unless you moved it meanwhile. Cmd+S saves and closes. Needs the cmdAbl Remote Script; see note for where the text is kept.",
    examples: [{ line: "stamp", note: "add a stamp at the song position and write below it" }],
    requires: ["bridge"],
    run: () => pageLoop("stamp"),
  });

  // Declared after the first commands.add so the key's namespace is the module's name (`note`).
  api.settings.declare({
    heading: "Note",
    items: [
      {
        key: "note.stampLoop",
        label: "Loop while stamping",
        help: "A stamp during Arrangement playback loops the next bars while you write, and puts the loop back when you close.",
        kind: "bool",
        default: true,
      },
      {
        key: "note.loopBars",
        label: "Loop length (bars)",
        help: "How many bars a stamp loops.",
        kind: "int",
        default: 4,
        min: 1,
        max: 64,
      },
    ],
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
