import type { Bridge } from "../ableton/bridgeClient.js";
import { select } from "../ableton/bridgeOps.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { fail, ok, type CommandResult } from "../types.js";

/**
 * Select a node in Live through the bridge's `select` op and map the reply to
 * a CommandResult. A failure keeps the bridge's code and text unchanged (1 =
 * the Set changed, 5 = script unavailable/outdated) — modules add no wording.
 */
export async function selectNodeResult(
  bridge: Bridge,
  node: Pick<ObjectNode, "scope" | "route" | "name">,
): Promise<CommandResult> {
  const reply = await select(bridge, node);
  return reply.ok ? ok() : fail(reply.code, reply.text);
}
