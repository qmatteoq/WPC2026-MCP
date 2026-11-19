# Zava Claims: one MCP, two Copilot experiences

A presentation sample inspired by [Copilot Camp's Cowork labs](https://microsoft.github.io/copilot-camp/pages/copilot-cowork/).
One **Entra-secured remote MCP endpoint** serves:

| Experience | Integration | What to demonstrate |
| --- | --- | --- |
| Copilot Cowork | Packaged `agentConnectors` plus `agentSkills` | The same tools plus a repeatable claims-review/report workflow |
| Zava Claims Assistant | Declarative agent with a `RemoteMCPServer` action | A focused, agent-scoped experience over the same source |

The Microsoft 365 app package includes both the Cowork plugin and the declarative
agent. No separate federated connector registration is required.

## What is implemented

- TypeScript MCP server using the official MCP SDK, stateless Streamable HTTP at `/mcp`.
- Strict, single-tenant Entra JWT validation (signature, issuer, audience, expiry,
  delegated scope) and server-side per-user North/South region authorization.
- Five read-only tools: `get_my_access`, `get_claims`, `get_claim`,
  `get_inspections`, `get_contractors`.
- Six synthetic insurance claims, five inspections, six contractors, and an
  explicit snapshot date of **2026-11-18**. No real policyholders or claims.
- A Cowork skill for an operations briefing and, when supported by the host,
  an Excel workbook with Summary, Claims, and Actions sheets.
- A declarative agent using runtime MCP discovery. Cowork receives its required
  packaged tool-description file, generated from the same Zod schemas.
- Repeatable package generation, Microsoft JSON Schema validation, and local
  signed-JWT/MCP integration tests.

This is a deliberately smaller implementation of the lab scenario: JSON files
replace Azure Table Storage/Azurite, reads replace operational write tools, and
Entra SSO replaces the lab's DCR proxy. There is no client secret or DCR broker.
It is not a production claims-processing system.

## Start here

Prerequisites: Windows PowerShell, Node.js 22+, an approved npm registry,
a Microsoft 365 test tenant with Cowork and declarative agents enabled, and
permission to configure an Entra app, SSO registration, and test-user rollout.

```powershell
npm ci
Copy-Item .env.example .env
Copy-Item config\access.example.json config\access.json
Copy-Item config\package.example.json config\package.json
```

Follow [the setup guide](docs/setup.md) to fill in non-secret tenant, endpoint,
SSO-registration, app-identity, and developer metadata. `config/access.json` maps
actual Entra user **object IDs** to regions; no user is authorized by default.
Do not use the example placeholder keys unchanged.

```powershell
npm run build
npm start
```

Publish local port 3001 through an organization-approved HTTPS tunnel, with
network access from Microsoft 365. The tunnel must not impose its own login
screen on MCP traffic: the server itself enforces Entra tokens. Keep the local
server and tunnel running during the session.

```powershell
Invoke-RestMethod http://127.0.0.1:3001/health
npm run package:app -- --config config/package.json
npm run validate:schemas -- artifacts/app
```

The configured upload ZIP is `artifacts\zava-demo.zip`.
Source `appPackage\*.json` files are templates, not directly installable files.
The packaging command refuses placeholder configuration.

For source/schema inspection before tenant configuration:

```powershell
npm run package:app -- --template
npm run validate:schemas
```

`artifacts\zava-demo-TEMPLATE.zip` uses a reserved `.invalid` endpoint and dummy
SSO references. It is **not installable or connected to your tenant**.

## Present the demo

Use the [presenter script](docs/demo-script.md) for a 10-12 minute sequence, prompts,
expected calculations, and a per-user authorization comparison.

The central message is **same backend, different integration and scope**.
Do not claim that packaging a connector automatically makes it available on
every Copilot surface or that a user-scoped response is an indexed Graph item.

## Local checks and source bundle

```powershell
npm run check
npm test
npm run build
npm run bundle
```

Tests generate temporary signing keys and synthetic identities locally. They
exercise actual MCP initialize/list/call traffic and token validation; they do
not use your Entra credentials or call your tenant.

`artifacts\zava-mcp-demo-source.zip` excludes `.env`, local access/package
configuration, installed dependencies, build output, and generated app packages.
Packaging uses Node.js and does not change PowerShell execution policies.

## Scope and limitations

- Tenant installation, real Entra SSO token issuance/refresh, admin approval,
  Cowork skill activation, and generated Excel output require rehearsal in your
  tenant. Local checks and JSON Schema validation do not prove host acceptance.
- The package targets app manifest 1.30, declarative-agent schema 1.6, and MCP
  plugin schema 2.4. Feature availability and combined-package acceptance depend
  on the tenant/host. Do not silently downgrade schemas to make validation pass.
- No Graph indexing, MCP writes, claim decisions, payments, file-upload APIs,
  storage provisioning, Azure deployment, or real source-system integration.
- Claims and permissions are reloaded on each request. This is a tiny local demo
  store, not a transactional database. Publish edited JSON files by replacing a
  completed temporary file (atomic rename), not by streaming edits into a live file.
- `/health` confirms process readiness, not successful Entra authentication.
  Protected operations fail closed; an unknown user has no source access.
- Both tenant-specific Entra v1 and v2 issuer formats are allowed; audiences must
  be explicitly configured. The server never trusts `/common` as an issuer.
- All source dates, priorities, and reserve indicators are demo facts/heuristics,
  not advice about policy coverage or claim settlement.

## References

- [Cowork plugin lab](https://microsoft.github.io/copilot-camp/pages/copilot-cowork/02-cowork-plugins/)
- [Zava Cowork SSO lab](https://microsoft.github.io/copilot-camp/pages/copilot-cowork/03-cowork-plugins-sso/)
- [Zava authenticated MCP lab](https://microsoft.github.io/copilot-camp/pages/extend-m365-copilot/10-mcp-auth/)
- [Remote MCP configuration and Cowork tool descriptions](https://learn.microsoft.com/en-us/plugins/configure-plugin-mcp-servers)
- [Entra SSO configuration](https://learn.microsoft.com/en-us/plugins/plugin-authentication-entra-sso)
- [Declarative-agent dynamic tool discovery](https://learn.microsoft.com/en-us/plugins/plugin-dynamic-tool-discovery)

Guidance checked on 2026-11-18. See `THIRD-PARTY-NOTICES.txt` for the upstream icon
license and attribution.
