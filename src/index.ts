import { readFile } from "node:fs/promises";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
// Fail before listening if the operator forgot the local data or access configuration.
await Promise.all([readFile(config.dataFile), readFile(config.accessFile)]);
const server = createApp(config).listen(config.port, config.host, () => {
  console.info(`Zava MCP listening on http://${config.host}:${config.port}/mcp (Entra SSO required).`);
});
server.on("error", error => { console.error(error); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { server.close(); server.closeIdleConnections(); });
}
