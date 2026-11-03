import type { ModuleApi } from "../types.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { OPERATORS, controlOf, formatControl, isOperator, parseControl, validateBinding, type MessageType, type OperatorName } from "../../core/midi.js";
import type { MidiBinding } from "../../core/midiEngine.js";
import { captureMessages, isCaptured } from "../midiCapture.js";
import { bindingRow, parseBindings, sameSlot, serializeBindings } from "./store.js";

const SYNTAX = "map <control> [press|release|hold|toggle] | <command line>";

/**
 * `map` — MIDI controls that run command lines (plan 0018, "The simple version"). The bindings of a Set live in the
 * file `modules/map/<setid>.json`; this module loads them, hands them to `api.midi.setBindings` (which makes the
 * script forward exactly those controls) and writes them back after every change. The Set only gets an id when its first
 * binding is saved.
 */
export function registerMap(api: ModuleApi): { sync(): Promise<void> } {
  let bindings: MidiBinding[] = [];
  let loaded = false;
  let loadedId: string | null = null;

  // The add form first: the group's own usage line ("map <command>") says nothing about a binding.
  const usage = (): string =>
    [
      `usage: ${SYNTAX}`,
      "       map learn [press|release|hold|toggle] | <command line>",
      "       map -l",
      "       map --rm <n>",
      "       map --on | --off",
    ].join("\n");
  const usageFail = (why: string): CommandResult => fail(ExitCode.USAGE, `map: ${why}\n${usage()}`);

  /** Load the bindings of the current Set when the Set changed since last time (or on first use) and give them to the engine. */
  // A file that cannot be read as bindings is never overwritten: map says so and waits for the user to fix or remove it.
  let damaged: string | null = null;
  // sync and commit run one at a time, so a Set change cannot read a file between an id and its write.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {});
    return result;
  };
  const sync = (): Promise<void> => serial(syncNow);
  async function syncNow(): Promise<void> {
    const id = await api.set.id(false);
    if (loaded && id === loadedId && damaged === null) return; // a damaged file is read again each time, so fixing it works
    let text: string | null = null;
    let unreadable: string | null = null;
    if (id !== null) {
      const read = await api.files.readResult(`${id}.json`);
      if (read.status === "ok") text = read.text;
      else if (read.status === "failed") unreadable = read.reason;
    }
    const parsed = parseBindings(text);
    damaged = (parsed.damaged || unreadable !== null) && id !== null ? `${id}.json` : null;
    if (damaged) api.logger.warn(`${damaged} cannot be read${unreadable ? ` (${unreadable})` : " as bindings"}; map leaves it alone until you fix or remove it`);
    if (parsed.dropped > 0) api.logger.warn(`${parsed.dropped} binding(s) in ${id}.json ignored (not a control, operator or line); they will be removed at the next change`);
    const previous = bindings;
    bindings = parsed.bindings;
    const set = await api.midi.setBindings(bindings);
    if (!set.ok) {
      // The script is not there (yet): keep what we had and try again at the next command.
      api.logger.info(`bindings not given to the script: ${set.text}`);
      bindings = previous;
      return;
    }
    if (set.value.refused.length) api.logger.warn(`refused: ${set.value.refused.join("; ")}`);
    loaded = true;
    loadedId = id;
    api.logger.info(`${bindings.length} binding(s) loaded for this Set`);
  }

  /** Make `next` the bindings: the engine and script first (they fail when the script is not running), then the file. */
  const commit = (next: MidiBinding[]): Promise<CommandResult | null> => serial(() => commitNow(next));
  async function commitNow(next: MidiBinding[]): Promise<CommandResult | null> {
    let id = await api.set.id(false);
    if (id === null) {
      id = await api.set.id(true);
      if (id === null) return fail(ExitCode.UNAVAILABLE, "map: this Set could not be given an id (is the Remote Script running?)");
    }
    if (damaged === `${id}.json`) return fail(ExitCode.FAILURE, `map: ${id}.json cannot be read; fix it or remove it`);
    const set = await api.midi.setBindings(next);
    if (!set.ok) return fail(set.code, `map: ${set.text}`);
    if (set.value.refused.length) {
      await api.midi.setBindings(bindings);
      return fail(ExitCode.USAGE, `map: ${set.value.refused.join("; ")}`);
    }
    if (!(await api.files.write(`${id}.json`, serializeBindings(next)))) {
      await api.midi.setBindings(bindings);
      return fail(ExitCode.FAILURE, "map: the bindings could not be saved; nothing changed");
    }
    bindings = next;
    loaded = true;
    loadedId = id;
    return null;
  }

  /** Add (or replace the line of) one binding. */
  async function add(control: string, operator: OperatorName, line: string): Promise<CommandResult> {
    const parsed = parseControl(control);
    if (!parsed) return usageFail(`"${control}" is not a control (CC37, N36, PB; add /ch2 to limit the channel)`);
    return addParsed({ control: parsed, operator, line });
  }

  async function addParsed(binding: MidiBinding): Promise<CommandResult> {
    const problem = validateBinding(binding.operator, binding.line);
    if (problem) return usageFail(problem);
    const first = binding.line.trim().split(/\s+/)[0]!;
    if (!api.commands.roots().some((c) => c.name === first || c.aliases?.includes(first))) {
      return usageFail(`no command "${first}" to run`);
    }
    const at = bindings.findIndex((b) => sameSlot(b, binding));
    const next = at >= 0 ? bindings.map((b, i) => (i === at ? { ...b, line: binding.line } : b)) : [...bindings, binding];
    const failed = await commit(next);
    if (failed) return failed;
    const n = at >= 0 ? at + 1 : next.length;
    return { ...ok(`map ${n}: ${formatControl(binding.control)} ${binding.operator} | ${binding.line}${at >= 0 ? " (replaced)" : ""}`), log: [`map ${n} ${at >= 0 ? "replaced" : "added"}`] };
  }

  const operatorOf = (given: unknown[] | undefined): OperatorName => {
    const name = (given?.[0] as string | undefined)?.toLowerCase();
    return name !== undefined && isOperator(name) ? name : "press";
  };

  api.commands.completer("map-bindings", () =>
    bindings.map((b, i) => ({ label: String(i + 1), description: `${formatControl(b.control)} ${b.operator} | ${b.line}` })),
  );

  api.commands.add({
    name: "map",
    topic: "Control",
    summary: "run command lines from MIDI controls",
    description:
      "Binds a MIDI control to a command line, so a button or knob on your controller runs it. map CC37 toggle | solo #lead --set {} binds " +
      "controller 37 to a line; the line is everything after the bar, chains with ; included. The operator says when the line runs and what {} " +
      "becomes: press (the default) runs it when the control goes down, release when it comes up, hold on both with 1 and 0, toggle on every press " +
      "with 1, 0, 1, and so on. Press and release give no value, so they cannot use {}. A control is CC37, N36 (a note) or PB (pitch bend); add /ch2 " +
      "to listen to one channel only. Bindings belong to the Live Set and are stored with it. A line runs without dialogs: an address that is " +
      "ambiguous does not run and is logged. Giving the same control and operator again replaces the line. Needs the cmdAbl Remote Script.",
    children: [
      {
        name: "learn",
        summary: "bind the control you move next",
        description:
          "Opens a small page that says Move a control, then press Enter. When you press Enter, the control that was moved last is bound to the line " +
          "after the bar, with the operator you name (press if none). A control that sends on several channels is bound to the channel it used.",
        examples: [{ line: "map learn toggle | mute #fx --set {}", note: "move a control, then press Enter" }],
        requires: ["bridge"],
        args: [
          { name: "operator", kind: "enum", choices: [...OPERATORS], required: false, summary: "When the line runs: press (default), release, hold or toggle" },
          { name: "line", kind: "text", raw: true, summary: "The command line to run, after the bar" },
        ],
        run: async (invocation): Promise<CommandResult> => {
          const operator = operatorOf(invocation.args[0]);
          const line = String((invocation.args[1] as string[] | undefined)?.[0] ?? "").trim();
          if (line === "") return usageFail("missing argument <line>");
          const problem = validateBinding(operator, line);
          if (problem) return usageFail(problem);
          await sync();
          const caught = await captureMessages(api, "Move a control", `then press Enter to bind it to: ${line}`, "map learn");
          if (!isCaptured(caught)) return caught;
          if (!caught.done) return ok();
          const newest = caught.messages[caught.messages.length - 1];
          if (!newest) return fail(ExitCode.FAILURE, "map learn: no control was moved. Is the controller connected and cmdAbl set as an input in Live's MIDI settings?");
          return addParsed({ control: controlOf({ type: newest.type as MessageType, channel: newest.channel, number: newest.number, value: newest.value }), operator, line });
        },
      },
      {
        name: "add",
        fallback: true,
        summary: "bind a control, list the bindings, remove one, or switch mapping on or off",
        description:
          "map <control> [operator] | <line> binds the control to the line. map -l lists the bindings of this Set as numbered rows, map --rm 2 removes the " +
          "second one, map --off stops all MIDI mapping and map --on starts it again (the setting is kept).",
        examples: [
          { line: "map CC37 | mute #drums --set 0", note: "controller 37 mutes the tracks tagged drums" },
          { line: "map N36 hold | mute #drums --set {}", note: "mute while the note is held" },
          { line: "map CC37/ch2 toggle | solo #lead --set {}", note: "a latching solo on channel 2" },
          { line: "map -l", note: "list the bindings" },
          { line: "map --rm 2", note: "remove binding 2" },
          { line: "map --off", note: "stop MIDI mapping" },
        ],
        requires: ["bridge"],
        options: [
          { name: "list", short: "l", summary: "list the bindings of this Set as numbered rows" },
          { name: "rm", takesValue: true, valueLabels: ["n"], complete: "map-bindings", summary: "remove binding number n (see map -l)" },
          { name: "on", summary: "switch MIDI mapping on" },
          { name: "off", summary: "switch MIDI mapping off" },
        ],
        args: [
          { name: "control", kind: "text", required: false, summary: "The control: CC37, N36, PB, with /ch2 to limit the channel" },
          { name: "operator", kind: "enum", choices: [...OPERATORS], required: false, summary: "When the line runs: press (default), release, hold or toggle" },
          { name: "line", kind: "text", raw: true, required: false, summary: "The command line to run, after the bar; {} is the operator's value" },
        ],
        run: async (invocation): Promise<CommandResult> => {
          const o = invocation.options;
          const control = invocation.args[0]?.[0] as string | undefined;
          const line = String((invocation.args[2] as string[] | undefined)?.[0] ?? "").trim();
          const modes = ["list", "rm", "on", "off"].filter((k) => o[k] !== undefined);
          if (modes.length > 1) return usageFail(`${modes.map((m) => `--${m}`).join(" and ")} do not go together`);

          if (modes.length === 1) {
            if (control !== undefined || line !== "") return usageFail(`--${modes[0]} takes no control or line`);
            if (o.on === true || o.off === true) {
              const saved = await api.midi.setEnabled(o.on === true);
              return ok(`map is ${o.on === true ? "on" : "off"}${saved ? "" : " for this session (the setting could not be saved)"}`);
            }
            await sync();
            if (o.list === true) {
              const off = (await api.midi.enabled()) ? "" : "map is off (map --on)\n";
              return bindings.length === 0
                ? ok(`${off}map: no bindings in this Set. Add one: ${SYNTAX}`)
                : ok(off + bindings.map((b, i) => bindingRow(i + 1, b)).join("\n"));
            }
            const n = Number(o.rm);
            if (!Number.isInteger(n) || n < 1) return usageFail(`--rm takes a number from map -l, not "${String(o.rm)}"`);
            if (n > bindings.length) return fail(ExitCode.NOT_FOUND, `map: no binding ${n}${bindings.length ? ` (1-${bindings.length})` : ", this Set has none"}`);
            const removed = bindings[n - 1]!;
            const failed = await commit(bindings.filter((_, i) => i !== n - 1));
            if (failed) return failed;
            return { ...ok(`map: removed ${n}: ${formatControl(removed.control)} ${removed.operator} | ${removed.line}`), log: [`map ${n} removed`] };
          }

          if (control === undefined) return usageFail("missing argument <control>");
          if (line === "") return usageFail("missing argument <line>");
          await sync();
          return add(control, operatorOf(invocation.args[1]), line);
        },
      },
    ],
  });

  return { sync };
}
