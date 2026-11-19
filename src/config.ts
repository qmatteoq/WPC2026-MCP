import { z } from "zod";

const configSchema = z.object({
  tenantId: z.string().uuid(),
  audiences: z.array(z.string().trim().min(1)).min(1),
  publicBaseUrl: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/" &&
      !url.username && !url.password && !url.search && !url.hash;
  }, "PUBLIC_BASE_URL must be an HTTPS origin without a path or credentials."),
  requiredScope: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  host: z.enum(["127.0.0.1", "0.0.0.0"]),
  port: z.coerce.number().int().min(1).max(65535),
  dataFile: z.string().min(1),
  accessFile: z.string().min(1)
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = configSchema.parse({
    tenantId: env.TENANT_ID,
    audiences: env.TOKEN_AUDIENCES?.split(",").map(value => value.trim()),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    requiredScope: env.REQUIRED_SCOPE ?? "access_as_user",
    host: env.HOST ?? "127.0.0.1",
    port: env.PORT ?? 3001,
    dataFile: env.DATA_FILE ?? "data/claims.json",
    accessFile: env.ACCESS_FILE ?? "config/access.json"
  });
  config.publicBaseUrl = new URL(config.publicBaseUrl).origin;
  return config;
}
