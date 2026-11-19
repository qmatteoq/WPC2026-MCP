import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { Config } from "./config.js";

export class AccessError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

export interface Principal {
  objectId: string;
  tenantId: string;
}

export function createTokenVerifier(config: Config, keys?: JWTVerifyGetKey) {
  const keySet = keys ?? createRemoteJWKSet(new URL(
    `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`
  ));
  return async (authorization: string | undefined): Promise<Principal> => {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
    if (!match?.[1]) throw new AccessError(401, "A bearer access token is required.");
    const { payload } = await jwtVerify(match[1], keySet, {
      algorithms: ["RS256"],
      issuer: [
        `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
        `https://sts.windows.net/${config.tenantId}/`
      ],
      audience: config.audiences,
      requiredClaims: ["exp", "iat", "tid", "oid", "scp"]
    });
    if (payload.tid !== config.tenantId ||
        !z.string().uuid().safeParse(payload.oid).success) {
      throw new AccessError(401, "The token does not identify a user in the configured tenant.");
    }
    if (typeof payload.scp !== "string" ||
        !payload.scp.split(" ").includes(config.requiredScope)) {
      throw new AccessError(403, "The delegated access scope is required.");
    }
    return { objectId: String(payload.oid), tenantId: config.tenantId };
  };
}
