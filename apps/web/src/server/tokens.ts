import { createHash, randomBytes } from "node:crypto";

/** 256-bit URL-safe secret for invitation links. Only the hash is stored. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
