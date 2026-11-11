import { test } from "node:test";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { registerMap } from "./command.js";

test("map: the commands are documented and their examples parse", () => {
  assertDocumented(declaredBy((api) => void registerMap(api, "")), ["map learn", "map add"]);
});
