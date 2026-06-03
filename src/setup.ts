import * as fs from "node:fs";
import * as path from "node:path";

const KARABINER_APP = "/Applications/Karabiner-Elements.app";
const KARABINER_MODS_DIR = path.join(
  process.env["HOME"] ?? "~",
  ".config/karabiner/assets/complex_modifications",
);
const SYMLINK_NAME = "cmdabl.json";

// __dirname is dist/ in the CJS bundle; karabiner/ sits one level up
function karabinerSourcePath(): string {
  return path.resolve(__dirname, "../karabiner/cmdabl.json");
}

export function isKarabinerSetupDone(): boolean {
  return fs.existsSync(path.join(KARABINER_MODS_DIR, SYMLINK_NAME));
}

export function runKarabinerSetup(): void {
  if (!fs.existsSync(KARABINER_APP)) {
    console.error("cmdAbl setup: Karabiner-Elements not found at /Applications/Karabiner-Elements.app");
    return;
  }

  const source = karabinerSourcePath();
  if (!fs.existsSync(source)) {
    console.error(`cmdAbl setup: karabiner rule file not found at ${source}`);
    return;
  }

  fs.mkdirSync(KARABINER_MODS_DIR, { recursive: true });

  const target = path.join(KARABINER_MODS_DIR, SYMLINK_NAME);
  if (fs.existsSync(target)) {
    console.warn(`cmdAbl setup: ${target} already exists — skipping. Delete it to re-run setup.`);
    return;
  }

  fs.symlinkSync(source, target);
  console.log(`cmdAbl setup: linked ${target}`);
  console.log("cmdAbl setup: open Karabiner-Elements → Complex Modifications → Add rule → enable 'cmdAbl'");
}
