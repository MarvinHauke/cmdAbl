import type { BridgeResult, HelloInfo } from "../ableton/bridgeProtocol.js";
import type { InstalledScript } from "../ableton/installedScript.js";

// What `cmdabl setup` tells the user to do about the Remote Script, from three
// facts: the version this extension ships, the version in Live's User Library,
// and the version the running script reports. Live keeps the Python it loaded
// until it restarts, so "installed X, running Y" is the case that matters.
// Pure: the facts come in, one message goes out.

export interface ScriptFacts {
  shipped: string;
  installed: InstalledScript;
  /** The running script's answer to a fresh `hello`; null = not asked. */
  running: BridgeResult<HelloInfo> | null;
}

const ENABLE =
  "enable cmdAbl as a control surface (Live Settings → Tempo & MIDI → Control Surface → cmdAbl)";

export function adviseRemoteScript(facts: ScriptFacts): string {
  const { shipped, installed, running } = facts;
  const live = running?.ok ? running.value.script : null;

  // The installed copy is something else than this extension ships.
  if (installed.status === "outdated") {
    const was = installed.version ? `version ${installed.version}` : "an unversioned copy";
    return (
      `Remote Script: the installed copy is ${was}, this extension ships ${shipped}. ` +
      `See the lines above for what the copy reported; then restart Live.`
    );
  }
  if (installed.status === "missing") {
    return `Remote Script: not installed (this extension ships ${shipped}). Run cmdabl setup again and check the messages above.`;
  }

  // Installed and current, or not readable (other platform): the running script decides.
  const known = installed.status === "current" ? `Remote Script ${shipped} is installed` : `Remote Script ${shipped} is shipped`;
  // Same version is not same files: the version stays put during a development
  // line, and Live keeps the Python it loaded until it restarts.
  if (live === shipped) {
    return `${known} and running. If the script or cmdAbl was just updated, restart Live once so it loads the new files; otherwise there is nothing to do.`;
  }
  if (live !== null) {
    return `${known}, but Live still runs ${live}. Restart Live to load Remote Script ${shipped}.`;
  }
  const why = running && !running.ok ? ` (${running.text})` : "";
  return `${known} but not running${why}. Restart Live if it has not been restarted since, then ${ENABLE}.`;
}
