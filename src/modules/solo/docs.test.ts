import { test } from "node:test";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { activate } from "./index.js";

test("solo: every command is documented and its examples parse", () => {
  assertDocumented(declaredBy(activate), ["solo"]);
});
