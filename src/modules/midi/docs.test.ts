import { test } from "node:test";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { registerMidi } from "./command.js";

test("midi: the commands are documented and their examples parse", () => {
  assertDocumented(declaredBy((api) => registerMidi(api, "")), ["midi monitor"]);
});
