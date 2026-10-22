import type { Module } from "./types.js";

import * as historyModule from "./history/index.js";
import * as gotoModule from "./goto/index.js";
import * as muteModule from "./mute/index.js";
import * as soloModule from "./solo/index.js";
import * as armModule from "./arm/index.js";
import * as volModule from "./vol/index.js";
import * as findModule from "./find/index.js";
import * as manModule from "./man/index.js";
import * as lomModule from "./lom/index.js";
import * as pakablModule from "./pakabl/index.js";
import * as tagModule from "./tag/index.js";
import * as noteModule from "./note/index.js";

/**
 * Every module cmdAbl ships with — the single list the platform activates.
 * Adding a feature = adding a module here; nothing else in the core changes.
 * Order is irrelevant: provider ordering is declared via `registerProvider`'s
 * `priority`, not by activation order.
 */
export const MODULES: Module[] = [
  historyModule,
  gotoModule,
  findModule,
  muteModule,
  soloModule,
  armModule,
  volModule,
  manModule,
  lomModule,
  pakablModule,
  tagModule,
  noteModule,
];
