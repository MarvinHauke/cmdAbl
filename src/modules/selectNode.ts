import type { Bridge } from "../ableton/bridgeClient.js";
import { select } from "../ableton/bridgeOps.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { fail, ok, type CommandResult } from "../core/types.js";

/**
 * Select a node in Live through the bridge's `select` op and map the reply to
 * a CommandResult. A failure keeps the bridge's code and text unchanged (1 =
 * the Set changed, 5 = script unavailable/outdated) — modules add no wording.
 * `unfold` also shows the track's chains in the Session mixer (never folds).
 */
export async function selectNodeResult(
  bridge: Bridge,
  node: Pick<ObjectNode, "scope" | "route" | "name">,
  options: { unfold?: boolean } = {},
): Promise<CommandResult> {
  const reply = await select(bridge, node, { showChains: options.unfold === true });
  if (!reply.ok) return fail(reply.code, reply.text);
  // `--unfold` never turns a selection into a failure; only a write that did
  // not take is worth a word. null (the track cannot show chains) is silence.
  if (options.unfold === true && reply.value.isShowingChains === false) {
    return ok("selected; the track's chains could not be shown in the mixer");
  }
  return ok();
}
