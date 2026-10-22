import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

// `api.files` (plan 0013): a module's own small files in the extension's data folder, under
// `<data folder>/modules/<module name>/`. Names are plain file names, so a module cannot reach
// another module's files or anything outside its folder. Text is UTF-8; a write goes to a
// temporary file and is renamed, so a crash never leaves half a file. Nothing throws: a refused
// name, a missing file or a failing disk answers null/false and, where it matters, a warning
// (the name and the reason, never the content). The host has no URL, TextEncoder or
// structuredClone: only node:fs/promises, node:path and strings are used here.

export const MAX_FILE_NAME = 100;
/** The largest text a module may write (a note is a few kB; this stops a runaway loop). */
export const MAX_FILE_BYTES = 1024 * 1024;

/** A plain file name: no "/", "\\" or "..", no leading dot, not empty, at most 100 characters. */
export function validFileName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_FILE_NAME &&
    !name.startsWith(".") &&
    !name.includes("..") &&
    !/[\/\\\0]/.test(name)
  );
}

export interface ModuleFiles {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<boolean>;
}

export interface FilesDeps {
  /** The extension's data folder (the one holding `bridge-token`). */
  base: string;
  /** The module's name now (it may be set by its first command, so it is read at each call). */
  module: () => string;
  warn: (text: string) => void;
  fs?: Pick<typeof fsp, "readFile" | "writeFile" | "mkdir" | "rename" | "unlink">;
}

export function createModuleFiles(deps: FilesDeps): ModuleFiles {
  const fs = deps.fs ?? fsp;

  /** The module's folder, or null (with a warning) when its name is not a plain name. */
  function folder(): string | null {
    const module = deps.module();
    if (!validFileName(module)) {
      deps.warn(`files: refused (the module name "${module}" is not a plain name)`);
      return null;
    }
    return path.join(deps.base, "modules", module);
  }

  return {
    async read(name) {
      if (!validFileName(name)) {
        deps.warn(`files: refused read of "${String(name).slice(0, 40)}" (not a plain file name)`);
        return null;
      }
      const dir = folder();
      if (dir === null) return null;
      try {
        return await fs.readFile(path.join(dir, name), "utf8");
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") deps.warn(`files: cannot read ${name} (${(e as NodeJS.ErrnoException)?.code ?? "error"})`);
        return null;
      }
    },

    async write(name, text) {
      if (!validFileName(name)) {
        deps.warn(`files: refused write of "${String(name).slice(0, 40)}" (not a plain file name)`);
        return false;
      }
      if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
        deps.warn(`files: refused write of ${name} (not text, or over ${MAX_FILE_BYTES} bytes)`);
        return false;
      }
      const dir = folder();
      if (dir === null) return false;
      const temp = path.join(dir, `.${crypto.randomBytes(6).toString("hex")}.tmp`);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(temp, text, "utf8");
        await fs.rename(temp, path.join(dir, name));
        return true;
      } catch (e: unknown) {
        deps.warn(`files: cannot write ${name} (${(e as NodeJS.ErrnoException)?.code ?? "error"})`);
        await fs.unlink(temp).catch(() => {});
        return false;
      }
    },
  };
}
