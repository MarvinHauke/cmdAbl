import { createBridgeClient, createUdpTransport, type Bridge } from "./bridgeClient.js";
import { createTokenSource } from "./bridgeToken.js";
import { inspectInstalledScript } from "./installedScript.js";

// Access to the Remote Script bridge (the SDK cannot change Live's selection or
// read some LOM-only facts, so cmdAbl talks to its companion Remote Script over
// a local UDP socket — see remote-script/cmdAbl and 0001 Phase 4).

/**
 * The request/response bridge (protocol with replies — see bridgeClient.ts).
 * One shared client per Extension Host; modules call getBridge() until a port
 * exists, and tests use createFakeBridge. Typed operations are in bridgeOps.ts.
 */
let shared: Bridge | null = null;
export function getBridge(): Bridge {
  if (!shared) {
    shared = createBridgeClient({
      transport: createUdpTransport(),
      installed: () => inspectInstalledScript(),
      token: createTokenSource(),
    });
  }
  return shared;
}
