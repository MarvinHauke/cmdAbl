import type { LiveRoutes, ModuleApi } from "../types.js";
import { fillTemplate } from "../../core/surfaces/inlineJson.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { buildStamp, parseAnswer, type PageThen, type StampInfo } from "./stamp.js";

const NOTE_WIDTH = 640;
const NOTE_HEIGHT = 520;

// Why stamps are commands under `note`: the note owns its file (`api.files` is scoped per module, so a separate
// module could not write into it), and actions are subcommands, never flags (plan 0005): `note` opens, `note stamp`
// adds a stamp (the loop while writing is the `loop` module, plan 0026). Both groups run on their own through a bare fallback child
// (`open`, `add`), as `git stash` runs `git stash push` (plan 0005 "Runnable groups"; plan 0013 "Spelling").

/**
 * `note [-e]` and `note stamp` — one Markdown note per Live Set (plan 0013). The Set carries an id (kept by the Remote
 * Script); the note is the file `<id>.md` in this module's folder of the extension's data folder. The page
 * answers once when it closes, as JSON `{"text": string | null, "then": "stamp" | "view" | null}`: `text` null = nothing
 * changed (or dismissed), "" = the text was cleared, anything else = the full new text; `then` = what follows the save: "stamp" (s pressed), "view" (Esc in stamp edit),
 * null (done). `changed: true` tells the page the text is not yet saved (it comes from a failed
 * save), so Save sends it even when the user did not edit it. A Set only gets its id when there is a text to keep,
 * so looking at the note never changes the Set. `template` is the note page (ui/modules/note/note.html), given by index.ts.
 *
 * Stamp round (`note stamp`, or `then: "stamp"`): read the transport, build the heading, open the page in mode "stamp" and save.
 * The loop while writing is the page's job through `loop here` / `loop back` (module `loop`, plan 0026).
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

    const answer = parseAnswer(await openPage(fillTemplate(template, { NOTE: input })));
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
   * The note page as a live page: it reads the stamp heading from the route `heading` (`loop` tells whether the page
   * should loop while the user writes) and may run `loop here` / `loop back` while open (plan 0013, 0026, 0018 "Page runs").
   * `onClose` is the safety net: `loop back` runs after the page closes whatever the page did. Without the server the
   * platform shows it as a data page (LIVE = null) and it falls back to `then`.
   */
  function openPage(html: string): Promise<string | null> {
    const routes: LiveRoutes = {
      heading: async () => {
        const transport = await api.set.transport();
        const loop = ((await api.settings.get<boolean>("stampLoop")) ?? true) && transport !== null && transport.playing && !transport.session;
        return { ...buildStamp(transport, now()), loop };
      },
    };
    return api.ui.livePage("note", html, NOTE_WIDTH, NOTE_HEIGHT, routes, { run: ["loop here", "loop back"], onClose: "loop back" });
  }

  /** One round of the page loop: for a stamp, build the heading; open the page; save. */
  async function round(mode: "view" | "edit" | "stamp"): Promise<{ then: PageThen; result?: CommandResult; log: string[] }> {
    const info = mode === "stamp" ? buildStamp(await api.set.transport(), now()) : undefined;
    return { ...(await session(mode, info)), log: [] };
  }

  /**
   * The page loop: open the page, and on each answer save the text, then act on `then`:
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

  const needsBridge = ["bridge"] as const;

  api.commands.add({
    name: "note",
    topic: "Look things up",
    summary: "the note of this Live Set, and stamps in it",
    description:
      "The Markdown note that belongs to this Live Set, for reminders: headings, lists, checkboxes, tables and code are drawn, " +
      "links are shown as text. note opens it to read, note -e to edit (a Set that has no note yet opens in edit). " +
      "note stamp adds a stamp (a new entry with the song position and the time); while you write it, the page loops the next bars (see loop). " +
      "In the page, e switches to editing, s adds a stamp, Cmd+S saves and closes, Esc goes back or closes. " +
      "The note is a plain Markdown file in cmdAbl's data folder, linked to the Set by an id stored inside the Set, so it follows the Set " +
      "when it is renamed or saved under another name (both copies then share one note). The Set gets its id the first time a note is saved, " +
      "which marks the Set as changed: save it so the link is kept. Needs the cmdAbl Remote Script.",
    children: [
      {
        name: "open",
        fallback: true,
        bare: true,
        summary: "open the note of this Live Set",
        description:
          "Opens the note to read; -e opens it to edit, and so does a Set that has no note yet. " +
          "In the page, e switches to editing, s adds a stamp (see note stamp), Cmd+S saves and closes; Esc in edit goes back to reading and keeps the text, " +
          "and Esc while reading saves and closes (Discard asks once). A saved note shows nothing; the log has one line.",
        examples: [
          { line: "note", note: "read the note of this Set" },
          { line: "note -e", note: "open the note to edit" },
        ],
        requires: [...needsBridge],
        options: [{ name: "edit", short: "e", summary: "open the note to edit instead of to read" }],
        run: (invocation) => pageLoop(invocation.options.edit === true ? "edit" : "view"),
      },
      {
        name: "stamp",
        summary: "add a stamp to the note: song position and time, then write below it",
        description:
          "note stamp adds a stamp to this Set's note (see note; the stamps live in the note's file): a new entry at the end with a heading that holds the song position " +
          "(while the song plays) and the date and time; you write below it. The page opens in edit. While Arrangement playback runs, the page runs loop here so the music " +
          "repeats while you write (setting note.stampLoop; the length is loop.bars). Esc saves and goes to reading the note, where s adds the next stamp; closing the page " +
          "runs loop back, which puts the loop back as it was unless you moved it meanwhile. Cmd+S saves and closes. Needs the cmdAbl Remote Script.",
        children: [
          {
            name: "add",
            fallback: true,
            bare: true,
            summary: "add a stamp at the song position and write below it",
            description:
              "Opens the note page in edit with a new heading at the end that holds the song position (while the song plays) and the date and time; " +
              "you write below it. While Arrangement playback runs, the page loops the next bars (loop here) until it closes (loop back).",
            examples: [{ line: "note stamp", note: "add a stamp at the song position and write below it" }],
            requires: [...needsBridge],
            run: () => pageLoop("stamp"),
          },
        ],
      },
    ],
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
