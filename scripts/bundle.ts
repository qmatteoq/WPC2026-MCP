import { join } from "node:path";
import { zipPaths } from "./zip.js";

const names = [
  "src", "scripts", "test", "data", "appPackage", "docs",
  "package.json", "package-lock.json", "tsconfig.json", ".gitignore",
  ".env.example", "README.md", "THIRD-PARTY-NOTICES.txt"
];
const roots = names.map(path => ({ source: path, path }));
for (const name of ["access.example.json", "package.example.json"]) {
  roots.push({ source: join("config", name), path: `config/${name}` });
}
const destination = join("artifacts", "zava-mcp-demo-source.zip");
await zipPaths(roots, destination);
console.info(`Source bundle: ${destination}`);
