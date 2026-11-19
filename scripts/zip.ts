import { lstat, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { zipSync, type Zippable } from "fflate";

export async function zipPaths(roots: { source: string; path: string }[], destination: string) {
  const files: Zippable = {};
  async function add(source: string, path: string): Promise<void> {
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`Refusing to include a symlink: ${source}`);
    if (info.isDirectory()) {
      for (const name of await readdir(source)) await add(join(source, name), `${path}/${name}`);
    } else if (info.isFile()) {
      files[path] = await readFile(source);
    } else {
      throw new Error(`Unsupported archive entry: ${source}`);
    }
  }
  for (const root of roots) await add(root.source, root.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, zipSync(files, { level: 6 }));
}
