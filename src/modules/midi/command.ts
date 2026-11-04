import type { ModuleApi } from "../types.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { captureMessages, isCaptured } from "../midiCapture.js";
import { monitorLines } from "./format.js";

/** `midi monitor` — what the controller sends, for finding out a control's name (plan 0018). */
export function registerMidi(api: ModuleApi, template: string): void {
  api.commands.add({
    name: "midi",
    topic: "Control",
    summary: "look at incoming MIDI",
    description: "Tools for the MIDI input that map uses. midi monitor shows the last messages the controller sent.",
    children: [
      {
        name: "monitor",
        summary: "watch the MIDI messages the controller sends",
        description:
          "Opens a small page that lists what the controller sends, live, newest first, with type, channel, number and value. Move some controls to see " +
          "their names, then press Enter or Esc to close it. While the page is open, bound controls do not run their lines. Needs the cmdAbl " +
          "Remote Script and cmdAbl set as a MIDI input in Live's settings.",
        examples: [{ line: "midi monitor", note: "watch the controls you move" }],
        requires: ["bridge"],
        run: async (): Promise<CommandResult> => {
          const caught = await captureMessages(api, "Move some controls", "Enter or Esc closes it", "midi monitor", "monitor", template);
          if (!isCaptured(caught)) return caught;
          // With the live view, closing just ends the window, quietly; without it (the page answered "list") the list is the only output.
          if (caught.fallback) {
            return caught.messages.length === 0
              ? fail(ExitCode.FAILURE, "midi monitor: nothing arrived. Is the controller connected and cmdAbl set as an input in Live's MIDI settings?")
              : ok(monitorLines(caught.messages).join("\n"));
          }
          return { ...ok(), log: [`midi monitor: ${caught.messages.length} message(s) seen`] };
        },
      },
    ],
  });
}
