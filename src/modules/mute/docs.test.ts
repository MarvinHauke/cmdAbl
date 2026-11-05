import { test } from "node:test";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { activate } from "./index.js";

test("mute: every command is documented and its examples parse", () => {
  assertDocumented(declaredBy(activate), ["mute"]);
});
