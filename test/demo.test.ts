import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { ClaimsStore } from "../src/store.js";
import { toolDescriptions } from "../src/tools.js";
import { renderPackage, templateSettings } from "../scripts/package.js";

const tenant = "11111111-1111-4111-8111-111111111111";
const presenter = "22222222-2222-4222-8222-222222222222";
const northUser = "33333333-3333-4333-8333-333333333333";
const unassigned = "44444444-4444-4444-8444-444444444444";
const audience = "55555555-5555-4555-8555-555555555555";
const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
const { privateKey, publicKey } = await generateKeyPair("RS256");
const key = await exportJWK(publicKey);
key.kid = "test-key";
const keys = createLocalJWKSet({ keys: [key] });
let directory: string;
let http: Server;
let url: string;
let config: ReturnType<typeof loadConfig>;

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    tid: tenant, oid: presenter, scp: "access_as_user",
    iss: issuer, aud: audience,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides
  }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(privateKey);
}

async function connect(objectId = presenter) {
  const client = new Client({ name: "zava-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${await token({ oid: objectId })}` } }
  });
  await client.connect(transport);
  return client;
}

async function replaceFile(file: string, text: string) {
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = z.array(z.object({ type: z.literal("text"), text: z.string() })).parse(result.content);
  const text = content[0]?.text;
  assert.ok(text);
  return { isError: result.isError === true, text, data: result.isError ? null : JSON.parse(text) };
}

before(async () => {
  await mkdir("artifacts", { recursive: true });
  directory = await mkdtemp(join("artifacts", "test-"));
  await writeFile(join(directory, "claims.json"), await readFile("data/claims.json"));
  await writeFile(join(directory, "access.json"), JSON.stringify({
    users: { [presenter]: ["North", "South"], [northUser]: ["North"] }
  }));
  config = loadConfig({
    TENANT_ID: tenant, TOKEN_AUDIENCES: audience,
    PUBLIC_BASE_URL: "https://zava.example.invalid",
    DATA_FILE: join(directory, "claims.json"), ACCESS_FILE: join(directory, "access.json")
  });
  http = createApp(config, createTokenVerifier(config, keys)).listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  url = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (http) {
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("configuration fails closed for missing identity or insecure public URLs", () => {
  assert.throws(() => loadConfig({}));
  assert.throws(() => loadConfig({
    TENANT_ID: tenant, TOKEN_AUDIENCES: audience, PUBLIC_BASE_URL: "http://localhost:3001"
  }));
});

test("health and protected-resource discovery do not expose claim records", async () => {
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).authentication, "Entra SSO required");
  const metadata = await fetch(`${url}/.well-known/oauth-protected-resource/mcp`);
  assert.equal((await metadata.json()).resource, "https://zava.example.invalid/mcp");
  const response = await fetch(`${url}/mcp`, { method: "POST" });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  assert.doesNotMatch(await response.text(), /CLM-/);
});

test("rejects expired, wrong-audience, wrong-tenant, unsigned, and app-only tokens", async () => {
  const verify = createTokenVerifier(config, keys);
  for (const overrides of [
    { exp: 1 }, { aud: "wrong-api" }, { tid: unassigned },
    { iss: `https://login.microsoftonline.com/${unassigned}/v2.0` }, { scp: undefined }
  ]) {
    await assert.rejects(verify(`Bearer ${await token(overrides)}`));
  }
  await assert.rejects(verify("Bearer eyJhbGciOiJub25lIn0.e30."));
  await assert.rejects(verify(undefined));
});

test("rejects a token with a valid signature but missing required delegated scope", async () => {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token({ scp: "some_other_scope" })}` }
  });
  assert.equal(response.status, 403);
});

test("valid tenant users without source permissions are denied", async () => {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token({ oid: unassigned })}` }
  });
  assert.equal(response.status, 403);
});

test("rejects cross-origin browser requests even with a valid token", async () => {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`, Origin: "https://untrusted.example.invalid"
    }
  });
  assert.equal(response.status, 403);
});

test("MCP initialize/list/call works and packaged tools match live tools", async () => {
  const client = await connect();
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 5);
    for (const tool of listed.tools) {
      const packaged = toolDescriptions.tools.find(item => item.name === tool.name);
      assert.ok(packaged);
      assert.equal(tool.description, packaged.description);
      assert.deepEqual(tool.inputSchema, packaged.inputSchema);
      assert.equal(tool.annotations?.readOnlyHint, true);
    }
    const result = await call(client, "get_my_access");
    assert.deepEqual(result.data.regions, ["North", "South"]);
  } finally { await client.close(); }
});

test("claims totals and truncation describe all filtered matches, not just returned rows", async () => {
  const client = await connect();
  try {
    const result = await call(client, "get_claims", { status: "Open", limit: 1 });
    assert.equal(result.isError, false);
    assert.equal(result.data.matchedCount, 3);
    assert.equal(result.data.returnedCount, 1);
    assert.equal(result.data.truncated, true);
    assert.equal(result.data.totalAmount, 169500);
    assert.equal(result.data.totalReserve, 140000);
    assert.equal(result.data.asOf, "2026-11-18");
  } finally { await client.close(); }
});

test("region authorization applies to lists, direct IDs, inspections, and contractors", async () => {
  const client = await connect(northUser);
  try {
    const claims = await call(client, "get_claims");
    assert.equal(claims.data.matchedCount, 3);
    assert.equal(claims.data.totalAmount, 72500);
    assert.ok(claims.data.claims.every((item: { region: string }) => item.region === "North"));
    const inaccessible = await call(client, "get_claim", { claimId: "CLM-1003" });
    const missing = await call(client, "get_claim", { claimId: "CLM-9999" });
    assert.equal(inaccessible.isError, true);
    assert.equal(inaccessible.text, missing.text);
    const inspections = await call(client, "get_inspections");
    assert.equal(inspections.data.inspections.length, 2);
    assert.equal((await call(client, "get_inspections", { claimId: "CLM-1003" })).isError, true);
    const contractors = await call(client, "get_contractors", { region: "South" });
    assert.deepEqual(contractors.data.contractors, []);
  } finally { await client.close(); }
});

test("overdue flags use snapshot date; completed and same-day inspections are not overdue", async () => {
  const client = await connect();
  try {
    const result = await call(client, "get_inspections");
    const overdue = result.data.inspections.filter((item: { overdue: boolean }) => item.overdue);
    assert.deepEqual(overdue.map((item: { id: string }) => item.id), ["INS-101", "INS-103"]);
    assert.equal((await call(client, "get_contractors", {
      region: "North", specialty: "Fire"
    })).data.contractors.length, 0);
  } finally { await client.close(); }
});

test("invalid inputs do not become successful empty reports", async () => {
  const client = await connect();
  try {
    for (const args of [{ limit: 0 }, { status: "Paid" }, { region: "West" }]) {
      assert.equal((await call(client, "get_claims", args)).isError, true);
    }
  } finally { await client.close(); }
});

test("source edits are visible on the next call without reindexing or restarting", async () => {
  const client = await connect();
  const file = join(directory, "claims.json");
  const original = await readFile(file, "utf8");
  try {
    const data = JSON.parse(original);
    data.claims[0].amount = 43000;
    await replaceFile(file, JSON.stringify(data));
    const result = await call(client, "get_claim", { claimId: "CLM-1001" });
    assert.equal(result.data.claim.amount, 43000);
  } finally {
    await replaceFile(file, original);
    await client.close();
  }
});

test("revoked source permissions take effect on the next MCP request", async () => {
  const client = await connect(northUser);
  const file = join(directory, "access.json");
  const original = await readFile(file, "utf8");
  try {
    await replaceFile(file, JSON.stringify({ users: { [presenter]: ["North", "South"] } }));
    await assert.rejects(client.callTool({ name: "get_claims", arguments: {} }));
  } finally {
    await replaceFile(file, original);
    await client.close();
  }
});

test("combined package binds connector and agent to the identical endpoint with distinct auth fields", async () => {
  const output = join(directory, "package");
  await renderPackage(templateSettings, output);
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  const plugin = JSON.parse(await readFile(join(output, "ai-plugin.json"), "utf8"));
  assert.equal(manifest.agentConnectors[0].toolSource.remoteMcpServer.mcpServerUrl,
    plugin.runtimes[0].spec.url);
  assert.equal(manifest.agentConnectors[0].toolSource.remoteMcpServer.authorization.referenceId,
    templateSettings.connectorSsoId);
  assert.equal(plugin.runtimes[0].auth.reference_id, templateSettings.agentSsoId);
  assert.equal(manifest.copilotAgents.declarativeAgents[0].file, "declarativeAgent.json");
  assert.deepEqual(plugin.runtimes[0].run_for_functions, ["*"]);
  assert.deepEqual(JSON.parse(await readFile(join(output, "toolDescription.json"), "utf8")), toolDescriptions);
  for (const [file, dimension] of [["color.png", 192], ["outline.png", 32]] as const) {
    const bytes = await readFile(join(output, file));
    assert.equal(bytes.readUInt32BE(16), dimension);
    assert.equal(bytes.readUInt32BE(20), dimension);
  }
});
