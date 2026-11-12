import type { ModuleApi } from "../types.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { behindSongEnd, friendlyRefusal } from "../shared/position.js";
import { describeLoop, loopHere, MAX_BARS, MIN_BARS, parseBars, sameLoop, shouldRestoreLoop, type LoopState } from "./logic.js";

const NO_SCRIPT = "the Remote Script did not answer (is it running, and up to date?)";
const needsBridge = ["bridge"] as const;

/**
 * `loop` — the arrangement loop (plan 0026): `loop` shows it, `loop here [bars]` loops from the current bar and
 * remembers the loop before, `loop on` / `loop off` switch it, `loop back` puts the remembered loop back (only
 * while the loop is still the one `loop here` set). The remembered loop lives in memory until cmdAbl restarts.
 */
export function activate(api: ModuleApi): void {
  /** The loop `loop here` set and the one before it; `loop back` restores `old` only while `set` is still there. */
  let ours: { old: LoopState; set: LoopState } | null = null;

  const unavailable = (what: string): CommandResult => fail(ExitCode.UNAVAILABLE, `loop ${what}: ${NO_SCRIPT}`);

  /** A setLoop failure: its own code (1 Live refused, 5 no script) and text. */
  const failed = (what: string, r: { code: 1 | 5; text: string }, exact?: string | null): CommandResult => {
    const text = friendlyRefusal(r.text, exact);
    if (text !== r.text) api.logger.debug(`loop ${what}: ${r.text}`);
    return fail(r.code === 5 ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `loop ${what}: ${text}`);
  };

  api.commands.add({
    name: "loop",
    topic: "Look things up",
    summary: "the arrangement loop: loop from here, switch it, put it back",
    description:
      "The Arrangement loop of this Live Set. loop shows it, loop here [bars] loops from the current bar (bars long, setting loop.bars, 4 by default), " +
      "switches it on and remembers the loop before, loop on and loop off switch it, loop back puts the loop from before the last loop here back, " +
      "but only while it is still the one loop here set. Bars use the Set's current time signature. Needs the cmdAbl Remote Script. " +
      "The note page uses loop here and loop back while you write a stamp.",
    children: [
      {
        name: "show",
        fallback: true,
        bare: true,
        summary: "show the arrangement loop",
        description: "Shows whether the Arrangement loop is on, where it starts (bar) and how long it is (bars). Changes nothing.",
        examples: [{ line: "loop", note: "show the loop" }],
        requires: [...needsBridge],
        run: async (): Promise<CommandResult> => {
          const t = await api.set.transport();
          if (t === null) return unavailable("show");
          const text = describeLoop(t);
          return { ...ok(), message: text, log: [text] };
        },
      },
      {
        name: "here",
        summary: "loop from the current bar and switch the loop on",
        description:
          "Loops from the start of the current bar, bars long (default: setting loop.bars, 4), switches the loop on and remembers the loop before; " +
          "loop back puts it back. A second loop here before loop back keeps the first remembered loop. Bars use the Set's time signature.",
        examples: [
          { line: "loop here", note: "loop the next 4 bars (or loop.bars)" },
          { line: "loop here 8", note: "loop the next 8 bars" },
        ],
        requires: [...needsBridge],
        args: [{ name: "bars", kind: "number", required: false, summary: `How many bars, ${MIN_BARS}–${MAX_BARS} (default: setting loop.bars)` }],
        run: async (invocation): Promise<CommandResult> => {
          const given = invocation.args[0]?.[0];
          let bars: number | null;
          if (given === undefined) bars = (await api.settings.get<number>("bars")) ?? 4;
          else {
            bars = parseBars(String(given));
            if (bars === null) return fail(ExitCode.USAGE, `loop here: "${String(given)}" is not a number of bars (${MIN_BARS}–${MAX_BARS})`);
          }
          const transport = await api.set.transport();
          if (transport === null) return unavailable("here");
          const wanted = loopHere(transport, bars);
          if (wanted === null) return fail(ExitCode.FAILURE, "loop here: no usable bar length from Live");
          const barNumber = Math.round(transport.barStart / transport.barLen) + 1;
          const result = await api.set.setLoop(wanted);
          if (!result.ok) return failed("here", result, behindSongEnd(wanted.start, transport.songLength, { num: transport.sigNum, den: transport.sigDen }, "loopStart"));
          const set = result.loop;
          // Still ours and untouched: keep the first old loop.
          if (ours === null || !sameLoop(transport.loop, ours.set)) ours = { old: transport.loop, set };
          else ours = { old: ours.old, set };
          return { ...ok(), log: [`loop here: ${bars} bar${bars === 1 ? "" : "s"} from bar ${barNumber}`] };
        },
      },
      {
        name: "on",
        summary: "switch the arrangement loop on",
        description: "Switches the Arrangement loop on, where it is. Nothing changes if it is already on.",
        examples: [{ line: "loop on", note: "switch the loop on" }],
        requires: [...needsBridge],
        run: () => switchLoop(true),
      },
      {
        name: "off",
        summary: "switch the arrangement loop off",
        description: "Switches the Arrangement loop off, keeping its position. Nothing changes if it is already off.",
        examples: [{ line: "loop off", note: "switch the loop off" }],
        requires: [...needsBridge],
        run: () => switchLoop(false),
      },
      {
        name: "back",
        summary: "put back the loop from before the last loop here",
        description:
          "Puts back the loop from before the last loop here, only if the loop is still the one loop here set; a loop you moved meanwhile is left alone. " +
          "Does nothing (exit 0) when there is nothing to restore.",
        examples: [{ line: "loop back", note: "restore the loop from before loop here" }],
        requires: [...needsBridge],
        run: async (): Promise<CommandResult> => {
          if (ours === null) return { ...ok(), log: ["loop back: nothing to restore"] };
          const mine = ours;
          const now = await api.set.transport();
          if (now === null) return unavailable("back"); // `ours` is kept
          if (!shouldRestoreLoop(now.loop, mine.set)) {
            ours = null;
            return { ...ok(), log: ["loop back: loop left alone (it was moved meanwhile)"] };
          }
          const restored = await api.set.setLoop(mine.old);
          if (!restored.ok) {
            api.logger.warn(`loop back: loop not restored: ${restored.text}`);
            return failed("back", restored); // `ours` is kept: loop back can be tried again
          }
          ours = null;
          return { ...ok(), log: ["loop back: loop put back"] };
        },
      },
    ],
  });

  api.settings.declare({
    heading: "Loop",
    items: [
      {
        key: "loop.bars",
        label: "Loop length (bars)",
        help: "How many bars loop here loops when you give no number.",
        kind: "int",
        default: 4,
        min: MIN_BARS,
        max: MAX_BARS,
      },
    ],
  });

  async function switchLoop(on: boolean): Promise<CommandResult> {
    const word = on ? "on" : "off";
    const transport = await api.set.transport();
    if (transport === null) return unavailable(word);
    if (transport.loop.on === on) return { ...ok(), log: [`loop ${word}: already ${word}`] };
    const result = await api.set.setLoop({ ...transport.loop, on });
    if (!result.ok) return failed(word, result);
    return { ...ok(), log: [`loop ${word}: done`] };
  }
}
