import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Principal } from "./auth.js";
import { ClaimsStore, regionSchema, statusSchema } from "./store.js";

const definitions = {
  get_my_access: {
    description: "Get the signed-in user's authorized Zava regions and the synthetic dataset snapshot date. Read-only.",
    schema: z.object({}).strict()
  },
  get_claims: {
    description: "Search live synthetic Zava insurance claims visible to the signed-in user. Filter by region, status, or text. Includes complete totals for all matches before limiting returned rows; amounts are USD. Read-only.",
    schema: z.object({
      region: regionSchema.optional(),
      status: statusSchema.optional(),
      query: z.string().trim().min(1).max(200).optional(),
      limit: z.number().int().min(1).max(100).default(100)
    }).strict()
  },
  get_claim: {
    description: "Read a Zava insurance claim and its inspection by exact claim ID, for example CLM-1001. Restricted to the signed-in user's regions. Read-only.",
    schema: z.object({ claimId: z.string().regex(/^CLM-\d{4}$/) }).strict()
  },
  get_inspections: {
    description: "List inspections for the signed-in user's visible Zava claims, optionally by claim ID. Returns overdue status relative to the explicit dataset snapshot date, not today's date. Read-only.",
    schema: z.object({ claimId: z.string().regex(/^CLM-\d{4}$/).optional() }).strict()
  },
  get_contractors: {
    description: "Find synthetic Zava contractors in the signed-in user's authorized regions. Optionally filter by region, damage specialty, and availability. Does not book contractors. Read-only.",
    schema: z.object({
      region: regionSchema.optional(),
      specialty: z.enum(["Storm", "Water", "Fire"]).optional(),
      availableOnly: z.boolean().default(true)
    }).strict()
  }
};

export const toolDescriptions = {
  tools: Object.entries(definitions).map(([name, definition]) => ({
    name,
    description: definition.description,
    inputSchema: zodToJsonSchema(definition.schema, { $refStrategy: "none" }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }))
};

type ToolName = keyof typeof definitions;
type Arguments = { [K in ToolName]: z.infer<(typeof definitions)[K]["schema"]> };

export async function executeTool<K extends ToolName>(
  name: K, input: unknown, principal: Principal, store: ClaimsStore
): Promise<object> {
  const args = definitions[name].schema.parse(input);
  const data = await store.load(principal);
  const context = { synthetic: true, asOf: data.asOf, currency: data.currency };
  switch (name) {
    case "get_my_access":
      return { ...context, regions: data.regions };
    case "get_claims": {
      const filters = args as Arguments["get_claims"];
      const query = filters.query?.toLowerCase();
      const matches = data.claims.filter(claim =>
        (!filters.region || claim.region === filters.region) &&
        (!filters.status || claim.status === filters.status) &&
        (!query || `${claim.id} ${claim.policyholder} ${claim.type} ${claim.summary}`
          .toLowerCase().includes(query))
      );
      return {
        ...context,
        matchedCount: matches.length,
        returnedCount: Math.min(matches.length, filters.limit),
        truncated: matches.length > filters.limit,
        totalAmount: matches.reduce((sum, claim) => sum + claim.amount, 0),
        totalReserve: matches.reduce((sum, claim) => sum + claim.reserve, 0),
        claims: matches.slice(0, filters.limit)
      };
    }
    case "get_claim": {
      const { claimId } = args as Arguments["get_claim"];
      const claim = data.claims.find(item => item.id === claimId);
      if (!claim) throw new Error("Claim not found or not accessible.");
      return {
        ...context, claim,
        inspection: data.inspections.find(item => item.id === claim.inspectionId) ?? null
      };
    }
    case "get_inspections": {
      const { claimId } = args as Arguments["get_inspections"];
      if (claimId && !data.claims.some(claim => claim.id === claimId)) {
        throw new Error("Claim not found or not accessible.");
      }
      return {
        ...context,
        inspections: data.inspections.filter(item => !claimId || item.claimId === claimId)
          .map(item => ({
            ...item, overdue: item.status !== "Completed" && item.scheduledDate < data.asOf
          }))
      };
    }
    case "get_contractors": {
      const filters = args as Arguments["get_contractors"];
      return {
        ...context,
        contractors: data.contractors.filter(item =>
          (!filters.region || item.region === filters.region) &&
          (!filters.specialty || item.specialty === filters.specialty) &&
          (!filters.availableOnly || item.available)
        )
      };
    }
    default:
      throw new Error("Unknown tool.");
  }
}

export function createClaimsMcp(principal: Principal, store: ClaimsStore) {
  const server = new McpServer({ name: "zava-claims", version: "1.0.0" });
  function register<K extends ToolName>(name: K) {
    const definition = definitions[name];
    server.registerTool(name, {
      description: definition.description,
      inputSchema: definition.schema,
      annotations: {
        readOnlyHint: true, destructiveHint: false,
        idempotentHint: true, openWorldHint: false
      }
    }, async (args: unknown): Promise<CallToolResult> => {
      try {
        const result = await executeTool(name, args, principal, store);
        console.info(JSON.stringify({ event: "tool_call", tool: name, outcome: "success" }));
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        console.error(JSON.stringify({ event: "tool_call", tool: name, outcome: "error" }));
        // Only expected caller errors are safe to return; filesystem/config details stay server-side.
        const message = error instanceof Error &&
          error.message === "Claim not found or not accessible."
          ? error.message : "The Zava tool failed. Check the server logs and configuration.";
        if (!(error instanceof Error) || message !== error.message) console.error(error);
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    });
  }
  for (const name of Object.keys(definitions) as ToolName[]) register(name);
  return server;
}
