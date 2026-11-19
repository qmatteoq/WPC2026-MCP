import express, { type ErrorRequestHandler } from "express";
import { errors as joseErrors } from "jose";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AccessError, createTokenVerifier, type Principal } from "./auth.js";
import type { Config } from "./config.js";
import { ClaimsStore } from "./store.js";
import { createClaimsMcp } from "./tools.js";

export function createApp(
  config: Config,
  verifyToken = createTokenVerifier(config),
  store = new ClaimsStore(config.dataFile, config.accessFile)
) {
  const app = express();
  const principals = new WeakMap<express.Request, Principal>();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => {
    res.json({ status: "healthy", service: "zava-claims", authentication: "Entra SSO required" });
  });
  const resourceMetadata = {
    resource: `${config.publicBaseUrl}/mcp`,
    authorization_servers: [`https://login.microsoftonline.com/${config.tenantId}/v2.0`],
    scopes_supported: [config.requiredScope],
    bearer_methods_supported: ["header"]
  };
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    (_req, res) => { res.json(resourceMetadata); });

  app.use("/mcp", async (req, res, next) => {
    try {
      if (req.headers.origin && req.headers.origin !== config.publicBaseUrl) {
        throw new AccessError(403, "This browser origin is not allowed.");
      }
      const principal = await verifyToken(req.headers.authorization);
      await store.load(principal);
      principals.set(req, principal);
      next();
    } catch (error) {
      if (error instanceof AccessError || error instanceof joseErrors.JOSEError) {
        const status = error instanceof AccessError ? error.status : 401;
        const code = status === 401 ? "invalid_token" : "insufficient_scope";
        res.setHeader("WWW-Authenticate",
          `Bearer error="${code}", resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp", scope="${config.requiredScope}"`);
        console.warn(JSON.stringify({ event: "access_denied", status }));
        res.status(status).json({ error: code });
        return;
      }
      next(error);
    }
  });
  app.use("/mcp", express.json({ limit: "256kb" }));
  app.post("/mcp", async (req, res, next) => {
    const principal = principals.get(req);
    if (!principal) {
      next(new Error("Missing authenticated request principal."));
      return;
    }
    const server = createClaimsMcp(principal, store);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on("close", () => {
      void Promise.all([transport.close(), server.close()]).catch(error => {
        console.error("MCP transport cleanup failed.", error);
      });
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });
  app.all("/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Stateless MCP: use POST for JSON-RPC requests." });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error("Zava request failed.", error);
    if (res.headersSent) { res.end(); return; }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "Invalid JSON request." });
      return;
    }
    res.status(500).json({ error: "Zava server error. Check server configuration and logs." });
  };
  app.use(errorHandler);
  return app;
}
