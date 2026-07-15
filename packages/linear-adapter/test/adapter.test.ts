import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLinearAdapter, verifyLinearWebhook } from "../src/index";
import { buildAuthorizeUrl } from "../src/oauth";

const SECRET = "whsec_test_secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("fixture mode", () => {
  const adapter = createLinearAdapter();
  const auth = { mode: "fixture" as const };

  it("lists official-shaped canonical projects and issues", async () => {
    const projects = await adapter.listProjects(auth);
    expect(projects.length).toBeGreaterThanOrEqual(2);
    for (const p of projects) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(typeof p.updatedAt).toBe("string");
    }

    const issues = await adapter.listWorkItems(auth, "lin-prj-credentialing");
    expect(issues.length).toBeGreaterThanOrEqual(5);
    expect(issues.every((i) => i.projectId === "lin-prj-credentialing")).toBe(true);
    expect(issues.every((i) => Array.isArray(i.labels))).toBe(true);
  });

  it("returns copies, not shared references (callers cannot mutate fixtures)", async () => {
    const a = await adapter.listProjects(auth);
    a[0]!.name = "MUTATED";
    const b = await adapter.listProjects(auth);
    expect(b[0]!.name).not.toBe("MUTATED");
  });

  it("oauth mode without a token throws instead of silently returning fixtures", async () => {
    await expect(adapter.listProjects({ mode: "oauth" })).rejects.toThrow(/no access token/);
  });
});

describe("webhook verification", () => {
  const now = 1_800_000_000_000;

  it("accepts a correctly signed, fresh delivery", () => {
    const body = JSON.stringify({ type: "Issue", action: "update", webhookTimestamp: now - 5_000 });
    const result = verifyLinearWebhook(
      body,
      { "linear-signature": sign(body), "linear-delivery": "d-1" },
      SECRET,
      now,
    );
    expect(result.ok).toBe(true);
    expect(result.eventType).toBe("Issue.update");
    expect(result.deliveryId).toBe("d-1");
  });

  it("rejects a bad signature", () => {
    const body = JSON.stringify({ type: "Issue", action: "update" });
    const result = verifyLinearWebhook(body, { "linear-signature": sign("other") }, SECRET, now);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/signature/);
  });

  it("rejects a missing signature and a stale timestamp (replay)", () => {
    const body = JSON.stringify({ type: "Issue", action: "update", webhookTimestamp: now - 120_000 });
    expect(verifyLinearWebhook(body, {}, SECRET, now).ok).toBe(false);
    expect(
      verifyLinearWebhook(body, { "linear-signature": sign(body) }, SECRET, now).reason,
    ).toMatch(/replay|stale/);
  });
});

describe("oauth", () => {
  it("builds an app-actor authorize url", () => {
    const url = buildAuthorizeUrl(
      { clientId: "cid", clientSecret: "s", redirectUri: "https://app.example/cb" },
      "state123",
    );
    expect(url).toContain("https://linear.app/oauth/authorize?");
    expect(url).toContain("actor=app");
    expect(url).toContain("state=state123");
    expect(url).toContain("client_id=cid");
  });
});
