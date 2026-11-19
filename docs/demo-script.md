# Presenter script: one MCP endpoint, two entry points

Allow 10-12 minutes after setup. Run each experience in a fresh conversation.
The numbers below refer to the unmodified synthetic dataset, snapshot
**2026-11-18**, in **USD**. No real insurance/customer data is used.

## Before the session

- Complete `setup.md`; run the local checks, then rehearse both tenant flows.
- Keep server and approved HTTPS tunnel alive; keep the terminal visible for
  tool-call events. Logs contain tool names/outcomes, not tokens or claim payloads.
- Stage deployment to test users only. The presenter sees North and South;
  optionally a second signed-in test user sees North only.
- Confirm Cowork can create Excel files. The MCP server supplies data; Cowork's
  host supplies spreadsheet generation.
- Open the outer manifest, `ai-plugin.json`, and the skill side by side for the
  explanation. Use the rendered files under `artifacts\app`, not source templates.

## 1. Cowork plugin: add repeatable know-how

Enable the Zava Claims plugin in a new Cowork session.

> Use the zava-claims-review skill to prepare an Excel operations review for all
> Zava claims I can access. Include Summary, Claims, and Actions sheets. Prioritize
> active claims with overdue inspections, calculate reserve gaps per active
> claim, and suggest matching available contractors for the top three.

Expected calls include `get_my_access`, `get_claims`, `get_inspections`, and
`get_contractors`. Exact call order/count can vary by host orchestration.

Show how the skill gives Cowork a repeatable process: joins, active-claim
definition, ranking, contractor matching, workbook structure, and disclaimers.
The connector supplies the tools; the skill supplies the workflow.

| Baseline measure | Expected |
| --- | --- |
| All claims | 6 |
| All claim amounts | 227,000 |
| All reserves | 187,000 |
| Active claims: Open + Under Review | 4 |
| Active claim amounts | 188,000 |
| Active reserves | 160,000 |
| Sum of positive active per-claim reserve gaps | 29,500 |
| Overdue inspections on active claims | 2 |

Important: **188,000 - 160,000 = 28,000 is not the intended gap metric**.
The sample deliberately includes an over-reserved active claim; compute
`max(amount - reserve, 0)` per active claim before summing.
The Closed claim's zero reserve is not an active gap.

| Priority | Claim | Reason | Suggested contractor |
| --- | --- | --- | --- |
| 1 | CLM-1003 | Overdue inspection; reserve gap 16,000 | South Fire Demo |
| 2 | CLM-1001 | Overdue inspection; reserve gap 7,000 | North Roof Demo |
| 3 | CLM-1006 | Inspection due on the snapshot date, not overdue; gap 6,500 | South Water Demo |

Show the workbook if the host created it. If not, report the limitation rather
than describing an imagined attachment. Host-generated reports can vary; inspect
the calculated values rather than relying on identical formatting.

## 2. Declarative agent: scope the experience

Open **Zava Claims Assistant**, without relying on general Chat's source selection.

> Review CLM-1001. What needs attention, what is the reserve gap, and which
> available contractor matches the claim's region and damage type?

Expected: North, Storm, Open; amount **42,000**, reserve **35,000**, gap **7,000**;
inspection INS-101 scheduled **2026-11-15**, overdue relative to **2026-11-18**;
North Roof Demo is available.

Show `declarativeAgent.json -> actions -> ai-plugin.json` and the
`RemoteMCPServer` runtime URL. Contrast it with
`manifest.json -> agentConnectors -> remoteMcpServer`.

Say: "The package-level connector and the agent action are different integration
models. The action is available within this agent. Both call the same endpoint;
neither package contains the running server."

## 3. Optional identity proof

Use the second test user's separately authenticated session:

> List the Zava claims I can access. Then retrieve CLM-1003.

Expected: only CLM-1001, CLM-1002, CLM-1005, total **72,500**. Direct lookup of
CLM-1003 returns "not found or not accessible", without exposing South data.

Explain: "Installing a plugin or selecting an agent doesn't grant source access.
The server uses the token's user object ID, not a region parameter supplied by
the assistant." Never display actual tokens on screen.

## Optional live-data proof

Between conversations, publish a valid edited copy of `data\claims.json` using an
atomic file replacement. Change a field that does not contradict the record's
summary, such as CLM-1002's status from Under Review to Open. Ask for Open claims
again and explicitly require a fresh tool lookup.

Expected: four Open claims, total **188,000**. No MCP restart or Graph reindex is
required. Restore the original dataset before repeating the baseline demo.
Explain that historical responses in an existing conversation can still contain
old values; "live source" does not mean every generated sentence is auto-refreshed.

## Close

"MCP gives us one tool interface. The entry point determines how people discover
it, what instructions accompany it, which scope it has, and how administrators
govern it."

Keep the boundary clear: the sample's tools are read-only; it does not demonstrate
write approvals, payments, production policy decisions, or a full claims platform.
