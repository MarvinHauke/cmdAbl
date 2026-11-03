import { test } from "node:test";
import { assertDocumented, declaredBy } from "../docs.testkit.js";
import { activate } from "./index.js";

test("map: the commands are documented and their examples parse", () => {
  assertDocumented(declaredBy(activate), ["map learn", "map add"]);
});
