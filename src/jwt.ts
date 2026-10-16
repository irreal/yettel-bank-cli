/**
 * Minimal, dependency-free JWT payload decoder. Does NOT verify the signature —
 * it only reads claims the server already issued to us (same as the web app,
 * which uses jwt-decode purely to read `customerId` / `experienceId`).
 */
export interface AccessTokenClaims {
  /** → stored as partyId */
  customerId?: string;
  /** → stored as customerId */
  experienceId?: string;
  exp?: number;
  [key: string]: unknown;
}

export function decodeJwt(token: string): AccessTokenClaims {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Not a JWT (expected 3 dot-separated parts)");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json) as AccessTokenClaims;
}
