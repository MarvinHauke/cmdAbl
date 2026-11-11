import { test } from "node:test";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { activate } from "./index.js";

test("find: every command is documented and its examples parse", () => {
  assertDocumented(declaredBy(activate), ["find search", "find next", "find prev"]);
});
