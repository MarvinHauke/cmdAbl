import type { Module } from "./types.js";

import * as historyModule from "./history/index.js";
import * as gotoModule from "./goto/index.js";
import * as muteModule from "./mute/index.js";
import * as soloModule from "./solo/index.js";
import * as pakablModule from "./pakabl/index.js";

/**
 * Every module cmdAbl ships with — the single list the platform activates.
 * Adding a feature = adding a module here; nothing else in the core changes.
 * Order is irrelevant: provider ordering is declared via `registerProvider`'s
 * `priority`, not by activation order.
 */
export const MODULES: Module[] = [historyModule, gotoModule, muteModule, soloModule, pakablModule];
