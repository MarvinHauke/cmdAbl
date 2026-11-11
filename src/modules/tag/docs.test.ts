import { test } from "node:test";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { activate } from "./index.js";

test("tag: the command is documented and its examples parse", () => {
  assertDocumented(declaredBy((api) => activate(api)), ["tag"]);
});
