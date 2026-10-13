import { test } from "node:test";
import { assertDocumented, declaredBy } from "../docs.testkit.js";
import { activate } from "./index.js";

test("tree: the command is documented and its examples parse", () => {
  assertDocumented(declaredBy(activate), ["tree"]);
});
