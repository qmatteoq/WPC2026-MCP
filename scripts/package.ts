import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { toolDescriptions } from "../src/tools.js";
import { zipPaths } from "./zip.js";

const httpsUrl = z.string().url().refine(value => new URL(value).protocol === "https:");
const settingsSchema = z.object({
  appId: z.string().uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  baseUrl: httpsUrl.refine(value => {
    const url = new URL(value);
    return url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  }),
  connectorSsoId: z.string().min(1).max(128),
  agentSsoId: z.string().min(1).max(128),
  developer: z.object({
    name: z.string().min(1).max(32),
    websiteUrl: httpsUrl, privacyUrl: httpsUrl, termsOfUseUrl: httpsUrl
  })
});
export type PackageSettings = z.infer<typeof settingsSchema>;

export async function renderPackage(settings: PackageSettings, output: string) {
  const config = settingsSchema.parse(settings);
  const replacements: Record<string, string> = {
    VERSION: config.version,
    APP_ID: config.appId,
    MCP_URL: `${new URL(config.baseUrl).origin}/mcp`,
    CONNECTOR_SSO_ID: config.connectorSsoId,
    AGENT_SSO_ID: config.agentSsoId,
    DEVELOPER_NAME: config.developer.name,
    WEBSITE_URL: config.developer.websiteUrl,
    PRIVACY_URL: config.developer.privacyUrl,
    TERMS_URL: config.developer.termsOfUseUrl
  };
  await mkdir(output, { recursive: true });
  for (const filename of ["manifest.json", "ai-plugin.json", "declarativeAgent.json"]) {
    const template: unknown = JSON.parse(await readFile(join("appPackage", filename), "utf8"));
    const rendered = JSON.stringify(template, (_key, value: unknown) =>
      typeof value === "string" ? value.replace(/\$\{\{([A-Z_]+)\}\}/g,
        (_match, key: string) => {
          const replacement = replacements[key];
          if (!replacement) throw new Error(`Unknown package token ${key}.`);
          return replacement;
        }) : value, 2);
    await writeFile(join(output, filename), `${rendered}\n`);
  }
  await writeFile(join(output, "toolDescription.json"), `${JSON.stringify(toolDescriptions, null, 2)}\n`);
  await cp("appPackage/skills", join(output, "skills"), { recursive: true });
  for (const file of ["color.png", "outline.png"]) await cp(join("appPackage", file), join(output, file));
  await cp("THIRD-PARTY-NOTICES.txt", join(output, "THIRD-PARTY-NOTICES.txt"));
}

export const templateSettings: PackageSettings = {
  appId: "ea301718-6257-42ee-9e90-d7e94951b328",
  version: "1.0.0",
  baseUrl: "https://zava-demo.example.invalid",
  connectorSsoId: "TEMPLATE_REPLACE_CONNECTOR_SSO_ID",
  agentSsoId: "TEMPLATE_REPLACE_AGENT_SSO_ID",
  developer: {
    name: "Zava Synthetic Demo",
    websiteUrl: "https://zava-demo.example.invalid",
    privacyUrl: "https://zava-demo.example.invalid/privacy",
    termsOfUseUrl: "https://zava-demo.example.invalid/terms"
  }
};

async function main() {
  const template = process.argv.includes("--template");
  const configIndex = process.argv.indexOf("--config");
  const configFile = process.argv[configIndex + 1];
  if (!template && (configIndex === -1 || !configFile)) {
    throw new Error("Pass --config config/package.json, or --template for a non-installable preview package.");
  }
  const config = template ? templateSettings :
    settingsSchema.parse(JSON.parse(await readFile(configFile!, "utf8")));
  if (!template && /YOUR_|REPLACE_|TEMPLATE_|example\.invalid|\$\{\{/i.test(JSON.stringify(config))) {
    throw new Error("Replace all package settings placeholders before packaging.");
  }
  const directory = resolve("artifacts", template ? "template" : "app");
  await renderPackage(config, directory);
  const destination = resolve("artifacts", template ? "zava-demo-TEMPLATE.zip" : "zava-demo.zip");
  const files = [
    "manifest.json", "ai-plugin.json", "declarativeAgent.json", "toolDescription.json",
    "color.png", "outline.png", "THIRD-PARTY-NOTICES.txt", "skills"
  ];
  await zipPaths(files.map(path => ({ source: join(directory, path), path })), destination);
  console.info(`${template ? "Template only; not installable" : "Configured app package"}: ${destination}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
