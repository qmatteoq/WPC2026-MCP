# Configure Zava once; connect it two ways

Use a test tenant. Nothing in this repository creates Azure resources, changes
Entra registrations, grants consent, or installs a Microsoft 365 package for you.

## 1. Choose a stable remote endpoint

Run this server locally and forward port 3001 through your approved development
tunnel, or host it on your approved Node.js service. For a tunnel, the server can
stay bound to `127.0.0.1`; a container host normally needs `HOST=0.0.0.0`.
Production hosting needs platform TLS termination and operational hardening.

Use one HTTPS origin in both:

```text
.env: PUBLIC_BASE_URL=https://YOUR_HOST
config/package.json: baseUrl=https://YOUR_HOST
```

The full MCP endpoint for **both integrations** is:

```text
https://YOUR_HOST/mcp
```

The endpoint has one path; do not use the lab's `/mcp/messages` path with this
implementation. Do not add a trailing `/mcp` to `PUBLIC_BASE_URL` or `baseUrl`.
Allow Microsoft 365's documented static egress addresses if your host restricts
incoming traffic. Use TLS 1.2+ and no interactive gateway login page.

## 2. Register the Entra API and Enterprise token store SSO configuration

Follow the [current Entra SSO documentation](https://learn.microsoft.com/en-us/plugins/plugin-authentication-entra-sso).
The following is a checklist, not a replacement for your organization's identity
and consent policies.

1. In Entra, register a **single-tenant API application** for Zava Claims MCP.
   Record its application/client GUID and tenant GUID. Do not create a client
   secret for this sample: the server validates incoming tokens, not obtains them.
2. In Teams Developer Portal, open **Tools > Microsoft Entra SSO client ID
   registration**. Register the Entra client ID with the full MCP endpoint as its
   Base URL, restricted to your organization. Use an app restriction compatible
   with both the Cowork connector and the declarative agent action.
3. Copy the generated **SSO registration ID** and **Application ID URI**.
   They are different values. The registration ID belongs in package references;
   the Application ID URI identifies the protected API/scopes.
4. Update the Entra app's `identifierUris` to include the generated Application ID
   URI. Under Expose an API, create/verify the delegated `access_as_user` scope.
   Complete the portal registration with the full
   `<APPLICATION_ID_URI>/access_as_user` scope.
5. Add the Web redirect URI
   `https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect`.
   This is the SSO callback, not the static OAuth `oAuthRedirect` callback.
6. Preauthorize the Microsoft Enterprise token store client,
   `ab3be6b7-f5df-413d-ac2d-abf1e3fd9c0b`, for the delegated scope. Follow tenant
   policy for admin consent and test-user assignment.
7. Configure the API's expected access-token version and explicit audiences.
   Entra v2 access tokens generally use the API client GUID as `aud`; v1 tokens
   can use an Application ID URI. Current SSO guidance also requires accepting
   the generated URI. List only the actual client GUID/SSO URI(s) for this API in
   `TOKEN_AUDIENCES`, comma separated. Never disable audience/issuer verification.

Populate `.env`:

```text
TENANT_ID=<tenant GUID>
TOKEN_AUDIENCES=<API client GUID>,<SSO Application ID URI>
PUBLIC_BASE_URL=https://YOUR_HOST
REQUIRED_SCOPE=access_as_user
```

`REQUIRED_SCOPE` is the token's short `scp` claim value, not the full scope URI.
The server validates the cryptographic signature against the tenant's Entra
keys, expiry, tenant-specific issuer, configured audience, `tid`, user `oid`,
and delegated scope. App-only tokens are not accepted.

If different consumers need separate SSO registrations or different generated
Application ID URIs, configure them explicitly rather than assuming references
are interchangeable. The package supports separate `connectorSsoId` and
`agentSsoId`; the server accepts the explicit audiences configured for either.
No reference ID is an access token, client ID, Application ID URI, or secret.

## 3. Assign source permissions

Copy `config\access.example.json` to `config\access.json`. Replace placeholder keys
with actual **user object IDs in the configured tenant**, not display names,
email addresses, application/client IDs, or the user's home-tenant ID for a guest.

For a two-user demo, assign the presenter both regions and a second test user
North only. To use just one account, remove the second entry entirely.

```json
{
  "users": {
    "<presenter object GUID>": ["North", "South"],
    "<second test user object GUID>": ["North"]
  }
}
```

The angle-bracket example is illustrative, not valid production configuration.
All map keys must be GUIDs and at least one valid region must be assigned.
Unlisted users get HTTP 403. Permissions are checked before MCP requests and
again when tools load source data. A direct claim-ID lookup never bypasses ACLs.
Source permission edits take effect on the next request.

## 4. Start and check the server

```powershell
npm ci
npm run build
npm start
Invoke-RestMethod http://127.0.0.1:3001/health
```

In another terminal, confirm the public health endpoint is reachable. A request
to `/mcp` without a bearer token must get HTTP 401 and a `WWW-Authenticate`
protected-resource metadata URL. Never share access tokens in logs or chat.

The public health and metadata routes contain no claim data. MCP GET/DELETE
return 405 after authentication because this implementation uses stateless
JSON-response Streamable HTTP; clients use POST for JSON-RPC requests.

## 5. Build the combined Cowork plugin + declarative agent package

Copy `config\package.example.json` to `config\package.json`, then fill in:

| Setting | Source |
| --- | --- |
| `appId` | Your unique Microsoft 365 app GUID; generate once and keep it stable across updates |
| `baseUrl` | The same HTTPS origin as `PUBLIC_BASE_URL` |
| `connectorSsoId` | SSO auth configuration ID permitted for the Cowork connector |
| `agentSsoId` | SSO auth configuration ID permitted for the agent action; can be the same when restrictions permit |
| `developer` | Your actual publisher name, documentation, privacy, and terms URLs |

The example app GUID is for the sample only. Generate a unique GUID with
`[guid]::NewGuid()` for your own installation.

```powershell
npm run package:app -- --config config/package.json
npm run validate:schemas -- artifacts/app
```

The ZIP contains these entries at its root:

```text
manifest.json
ai-plugin.json
declarativeAgent.json
toolDescription.json
color.png
outline.png
THIRD-PARTY-NOTICES.txt
skills/zava-claims-review/SKILL.md
```

The **outer** app manifest uses `agentConnectors[].authorization.referenceId`;
the agent's **action** manifest uses `runtimes[].auth.reference_id`.
Both point to separately obtained vault references, never credentials.
The agent action uses `functions: []` and `run_for_functions: ["*"]` for runtime
discovery. Cowork has an explicit `mcpToolDescription` because current host
guidance still requires it even with a newer app manifest.

Upload `artifacts\zava-demo.zip` through the supported plugin upload workflow in
your tenant. The Camp lab documents Cowork **+ > Customize** for developer upload
and Microsoft 365 admin center **Agents > All Agents > Upload Agent** for managed
deployment. Scope the rollout to test users first; user-upload availability is
tenant-dependent. Bind SSO usage restrictions to the actual published app when
appropriate, ensuring it works for both package integrations.

Verify the plugin is enabled for the Cowork session and that **Zava Claims
Assistant** appears in Microsoft 365 Copilot's agent list after installation.
Installing a package does not automatically grant source permissions or consent.
If the tenant rejects the combined package, retain the rejection details and
check supported manifest versions/feature availability rather than claiming
success from schema validation alone.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Server refuses to start | `.env` placeholders, missing files, port conflict; there is no anonymous fallback |
| HTTP 401 | Signature/expiry, tenant issuer, exact API audience, token-store SSO setup; never use a Graph access token |
| HTTP 403 | `scp` contains `access_as_user`; user object ID has an assigned region; browser Origin is permitted |
| HTTP 500 | Validate JSON data/access files and linked IDs; server logs contain the operator-facing error |
| Tools missing in Cowork | `toolDescription.json` in ZIP, manifest reference, endpoint/auth permissions, session plugin enabled |
| Agent can't call tools | `reference_id` spelling, action file reference, endpoint, app restriction, consent |
| Claims absent only for one user | Region ACLs are applied server-side; this can be expected |
| Connector absent in Copilot | Tenant feature/license availability, rollout, User access, governance policy, propagation |
| Browser opens protected record URL | This sample exposes tools, not a source-system browser UI; use claim IDs, not invented links |
| No Excel attachment | File generation is host-provided, not an MCP server tool; skill must report that limitation |
| A report repeats old values | Start a new conversation and explicitly request a fresh tool call; inspect server tool-call logs |

Before presenting, rehearse a real sign-in, a subsequent call, token renewal where
possible, both host integrations, and the second user's region restriction.
Local tests use synthetic signing keys and cannot establish those tenant results.
