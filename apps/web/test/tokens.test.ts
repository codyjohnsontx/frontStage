import { describe, expect, it } from "vitest";
import { generateInvitationToken, hashToken } from "../src/server/tokens";

describe("invitation tokens", () => {
  it("generates unique url-safe tokens with 256 bits of entropy", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = generateInvitationToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(100);
  });

  it("hashes deterministically and never equals the raw token", () => {
    const token = generateInvitationToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });
});
