import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUS_MAPPING,
  contentHashForWorkItem,
  decryptToken,
  encryptToken,
  mapStatus,
} from "../src/index";

describe("status mapping", () => {
  it("maps every canonical state type by default", () => {
    expect(mapStatus("triage")).toBe("Under Review");
    expect(mapStatus("backlog")).toBe("Planned");
    expect(mapStatus("unstarted")).toBe("Planned");
    expect(mapStatus("started")).toBe("In Progress");
    expect(mapStatus("completed")).toBe("Complete");
    expect(mapStatus("canceled")).toBe("Closed");
  });

  it("applies a valid portal override", () => {
    expect(mapStatus("started", { started: "Validation" })).toBe("Validation");
  });

  it("falls back to defaults on invalid override values (no raw state leaks)", () => {
    expect(mapStatus("started", { started: "Code Review (internal!)" })).toBe("In Progress");
    expect(mapStatus("triage", { triage: "" })).toBe("Under Review");
  });

  it("default mapping is total over the six state types", () => {
    expect(Object.keys(DEFAULT_STATUS_MAPPING).sort()).toEqual(
      ["backlog", "canceled", "completed", "started", "triage", "unstarted"].sort(),
    );
  });
});

describe("content hashing", () => {
  const base = {
    title: "Add retry",
    description: "details",
    stateType: "started",
    stateName: "In Progress",
  };

  it("is stable for identical curation-relevant content", () => {
    expect(contentHashForWorkItem(base)).toBe(contentHashForWorkItem({ ...base }));
  });

  it("changes when title, state, or archived changes", () => {
    const h = contentHashForWorkItem(base);
    expect(contentHashForWorkItem({ ...base, title: "x" })).not.toBe(h);
    expect(contentHashForWorkItem({ ...base, stateType: "completed" })).not.toBe(h);
    expect(contentHashForWorkItem({ ...base, archived: true })).not.toBe(h);
  });
});

describe("token crypto", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips and never stores plaintext", () => {
    const encrypted = encryptToken("lin_oauth_secret_token", key);
    expect(encrypted).not.toContain("lin_oauth_secret_token");
    expect(decryptToken(encrypted, key)).toBe("lin_oauth_secret_token");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptToken("secret", key);
    const parts = encrypted.split(".");
    const tampered = `${parts[0]}.${Buffer.from("hacked!").toString("base64")}.${parts[2]}`;
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it("rejects wrong-size keys", () => {
    expect(() => encryptToken("x", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });
});
