import { test } from "node:test";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { PAGE } from "./page.testkit.js";
import { activate } from "./command.js";

test("tag: the command is documented and its examples parse", () => {
  assertDocumented(declaredBy((api) => activate(api, PAGE)), ["tag"]);
});
