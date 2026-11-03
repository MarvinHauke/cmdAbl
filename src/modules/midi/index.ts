import type { ModuleApi } from "../types.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { captureMessages, isCaptured } from "../midiCapture.js";
import { monitorLines } from "./format.js";

/** `midi monitor` — what the controller sends, for finding out a control's name (plan 0018). */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "midi",
    topic: "Control",
    summary: "look at incoming MIDI",
    description: "Tools for the MIDI input that map uses. midi monitor shows the last messages the controller sent.",
    children: [
      {
        name: "monitor",
        summary: "show the last 20 incoming MIDI messages",
        description:
          "Opens a small page that says Move a control, then press Enter. Everything the controller sends meanwhile is listed afterwards, " +
          "newest first, with type, channel, number and value. While the page is open, bound controls do not run their lines. Needs the cmdAbl " +
          "Remote Script and cmdAbl set as a MIDI input in Live's settings.",
        examples: [{ line: "midi monitor", note: "move some controls, press Enter, read the list" }],
        requires: ["bridge"],
        run: async (): Promise<CommandResult> => {
          const caught = await captureMessages(api, "Move some controls", "then press Enter to see what arrived", "midi monitor");
          if (!isCaptured(caught)) return caught;
          if (!caught.done) return ok();
          if (caught.messages.length === 0) return fail(ExitCode.FAILURE, "midi monitor: nothing arrived. Is the controller connected and cmdAbl set as an input in Live's MIDI settings?");
          return ok(monitorLines(caught.messages).join("\n"));
        },
      },
    ],
  });
}
