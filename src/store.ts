import { readFile } from "node:fs/promises";
import { z } from "zod";
import { AccessError, type Principal } from "./auth.js";

export const regionSchema = z.enum(["North", "South"]);
export const statusSchema = z.enum(["Open", "Under Review", "Approved", "Closed"]);
const claimSchema = z.object({
  id: z.string().regex(/^CLM-\d{4}$/),
  policyholder: z.string().min(1),
  region: regionSchema,
  type: z.enum(["Storm", "Water", "Fire"]),
  status: statusSchema,
  amount: z.number().nonnegative().finite(),
  reserve: z.number().nonnegative().finite(),
  filedDate: z.string().date(),
  summary: z.string().min(1),
  inspectionId: z.string().nullable()
});
const dataSchema = z.object({
  synthetic: z.literal(true),
  asOf: z.string().date(),
  currency: z.literal("USD"),
  claims: z.array(claimSchema),
  inspections: z.array(z.object({
    id: z.string(),
    claimId: z.string(),
    scheduledDate: z.string().date(),
    status: z.enum(["Scheduled", "Completed"]),
    inspector: z.string()
  })),
  contractors: z.array(z.object({
    id: z.string(),
    name: z.string(),
    region: regionSchema,
    specialty: z.enum(["Storm", "Water", "Fire"]),
    available: z.boolean()
  }))
}).superRefine((data, ctx) => {
  const claimIds = new Set(data.claims.map(claim => claim.id));
  const inspections = new Map(data.inspections.map(item => [item.id, item]));
  if (claimIds.size !== data.claims.length || inspections.size !== data.inspections.length ||
      new Set(data.contractors.map(item => item.id)).size !== data.contractors.length) {
    ctx.addIssue({ code: "custom", message: "Record identifiers must be unique." });
  }
  for (const claim of data.claims) {
    if (claim.inspectionId !== null &&
        inspections.get(claim.inspectionId)?.claimId !== claim.id) {
      ctx.addIssue({ code: "custom", message: `Invalid inspection link for ${claim.id}.` });
    }
  }
  for (const inspection of data.inspections) {
    if (!claimIds.has(inspection.claimId) ||
        data.claims.find(claim => claim.id === inspection.claimId)?.inspectionId !== inspection.id) {
      ctx.addIssue({ code: "custom", message: `Invalid claim link for ${inspection.id}.` });
    }
  }
});
const accessSchema = z.object({
  users: z.record(z.string().uuid(), z.array(regionSchema).nonempty())
});

export type ClaimData = z.infer<typeof dataSchema>;
export type Region = z.infer<typeof regionSchema>;

export class ClaimsStore {
  constructor(private readonly dataFile: string, private readonly accessFile: string) {}

  async load(principal: Principal) {
    const [dataText, accessText] = await Promise.all([
      readFile(this.dataFile, "utf8"), readFile(this.accessFile, "utf8")
    ]);
    const data = dataSchema.parse(JSON.parse(dataText));
    const access = accessSchema.parse(JSON.parse(accessText));
    const regions = access.users[principal.objectId];
    if (!regions) throw new AccessError(403, "This user has no Zava region assignments.");
    const claims = data.claims.filter(claim => regions.includes(claim.region));
    const ids = new Set(claims.map(claim => claim.id));
    return {
      synthetic: data.synthetic,
      asOf: data.asOf,
      currency: data.currency,
      regions,
      claims,
      inspections: data.inspections.filter(item => ids.has(item.claimId)),
      contractors: data.contractors.filter(item => regions.includes(item.region))
    };
  }
}
