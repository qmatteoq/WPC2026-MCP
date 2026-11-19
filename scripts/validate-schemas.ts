import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv } from "ajv";
import AjvDraft04Module from "ajv-draft-04";
import formatsModule from "ajv-formats";

const folder = process.argv[2] ?? "artifacts/template";
const schemas = [
  ["manifest.json", "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json"],
  ["declarativeAgent.json", "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.6/schema.json"],
  ["ai-plugin.json", "https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json"]
] as const;
await mkdir("artifacts/schemas", { recursive: true });
for (const [file, url] of schemas) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Schema download failed (${response.status}): ${url}`);
  const text = await response.text();
  await writeFile(join("artifacts/schemas", file), text);
  let schema = JSON.parse(text);
  if (typeof schema === "string") schema = JSON.parse(schema);
  const validator = schema.$schema?.includes("draft-04")
    ? new AjvDraft04Module.default({ strict: false, allErrors: true })
    : new Ajv({ strict: false, allErrors: true });
  formatsModule.default(validator);
  const validate = validator.compile(schema);
  const input = JSON.parse(await readFile(join(folder, file), "utf8"));
  if (!validate(input)) throw new Error(`${file}: ${JSON.stringify(validate.errors, null, 2)}`);
  console.info(`${file}: schema valid`);
}
