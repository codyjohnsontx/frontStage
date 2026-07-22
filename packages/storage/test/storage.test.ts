import { describe, expect, it } from "vitest";
import { attachmentKey, storageConfigFromEnv } from "../src/index";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PORTAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ATT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("attachmentKey", () => {
  it("builds structurally tenant-scoped keys", () => {
    expect(attachmentKey({ organizationId: ORG, portalId: PORTAL, attachmentId: ATT })).toBe(
      `organizations/${ORG}/portals/${PORTAL}/attachments/${ATT}`,
    );
  });

  it("rejects non-UUID parts (no path traversal via ids)", () => {
    expect(() =>
      attachmentKey({ organizationId: "../evil", portalId: PORTAL, attachmentId: ATT }),
    ).toThrow(/not a UUID/);
    expect(() =>
      attachmentKey({ organizationId: ORG, portalId: PORTAL, attachmentId: "x/../../y" }),
    ).toThrow(/not a UUID/);
  });

  it("enforces canonical UUID layout, not just length and charset", () => {
    // 36 characters of hyphens passed the old length/charset check.
    expect(() =>
      attachmentKey({ organizationId: "-".repeat(36), portalId: PORTAL, attachmentId: ATT }),
    ).toThrow(/not a UUID/);
    // Right characters, wrong hyphen positions.
    expect(() =>
      attachmentKey({
        organizationId: "aaaaaaaaa-aaa-4aaa-8aaa-aaaaaaaaaaa",
        portalId: PORTAL,
        attachmentId: ATT,
      }),
    ).toThrow(/not a UUID/);
    // Canonical UUIDs still accepted, upper case included.
    expect(() =>
      attachmentKey({ organizationId: ORG.toUpperCase(), portalId: PORTAL, attachmentId: ATT }),
    ).not.toThrow();
  });
});

describe("storageConfigFromEnv", () => {
  const base = {
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_ACCESS_KEY: "k",
    STORAGE_SECRET_KEY: "s",
    STORAGE_BUCKET: "b",
  };

  it("reads config with sane defaults", () => {
    const config = storageConfigFromEnv(base);
    expect(config.region).toBe("us-east-1");
    expect(config.forcePathStyle).toBe(true);
  });

  it("fails loudly on missing required values", () => {
    expect(() => storageConfigFromEnv({ ...base, STORAGE_BUCKET: undefined })).toThrow(
      /STORAGE_BUCKET/,
    );
  });
});
