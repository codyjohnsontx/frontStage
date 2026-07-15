import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinearAdapter, verifyLinearWebhook } from "../src/index";
import { buildAuthorizeUrl, exchangeCodeForToken } from "../src/oauth";

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

  it("resolves single entities by id, null when unknown", async () => {
    expect((await adapter.getProject(auth, "lin-prj-credentialing"))?.name).toBe(
      "Credentialing Modernization",
    );
    expect(await adapter.getProject(auth, "nope")).toBeNull();
    expect((await adapter.getWorkItem(auth, "lin-eng-42"))?.identifier).toBe("ENG-42");
    expect(await adapter.getWorkItem(auth, "nope")).toBeNull();
  });

  // Note: `{ mode: "oauth" }` without accessToken is now a COMPILE error
  // (ConnectionAuth is a discriminated union), replacing the old runtime test.
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
    if (!result.ok) throw new Error("unreachable");
    expect(result.eventType).toBe("Issue.update");
    expect(result.deliveryId).toBe("d-1");
    expect(result.payload).toBeDefined();
  });

  it("rejects a bad signature", () => {
    const body = JSON.stringify({ type: "Issue", action: "update" });
    const result = verifyLinearWebhook(body, { "linear-signature": sign("other") }, SECRET, now);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/signature/);
  });

  it("rejects a missing signature and a stale timestamp (replay)", () => {
    const body = JSON.stringify({ type: "Issue", action: "update", webhookTimestamp: now - 120_000 });
    expect(verifyLinearWebhook(body, {}, SECRET, now).ok).toBe(false);
    const stale = verifyLinearWebhook(body, { "linear-signature": sign(body) }, SECRET, now);
    if (stale.ok) throw new Error("unreachable");
    expect(stale.reason).toMatch(/replay|stale/);
  });
});

describe("oauth", () => {
  const config = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app.example/cb" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an app-actor authorize url", () => {
    const url = buildAuthorizeUrl(config, "state123");
    expect(url).toContain("https://linear.app/oauth/authorize?");
    expect(url).toContain("actor=app");
    expect(url).toContain("state=state123");
    expect(url).toContain("client_id=cid");
  });

  it("exchanges a code and maps optional expires_in/scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "lin_at_x",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "read,write",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeCodeForToken(config, "code123");
    expect(token).toEqual({
      accessToken: "lin_at_x",
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: "read,write",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.linear.app/oauth/token");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code123");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("omits optional fields the provider did not send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "t", token_type: "Bearer" }), { status: 200 }),
      ),
    );
    const token = await exchangeCodeForToken(config, "c");
    expect(token).toEqual({ accessToken: "t", tokenType: "Bearer" });
  });

  it("surfaces status and body text when the token endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid_grant", { status: 400 })),
    );
    await expect(exchangeCodeForToken(config, "bad")).rejects.toThrow(
      /token exchange failed: 400 invalid_grant/,
    );
  });
});
