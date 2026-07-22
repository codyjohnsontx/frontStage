import { describe, expect, it } from "vitest";
import {
  CLIENT_VISIBLE_DELIVERABLE_STATUSES,
  deliverableContent,
  materialContentHash,
  type InternalDeliverableData,
} from "../src/server/deliverable-view";
import { allowedTransitions, isEditableStatus } from "../src/server/deliverables";

const base: InternalDeliverableData = {
  identifier: "APEX-DEL-001",
  title: "Credential status dashboard",
  description: "A dashboard showing verification status per provider.",
  scope: "Read-only dashboard for the credentialing team.",
  acceptanceCriteria: "Shows status within 5 minutes of a verification completing.",
  targetDate: new Date("2026-09-30T00:00:00.000Z"),
  // Internal-only fields present in the INPUT to prove they never leak.
  internalOwnerId: "internal-user-uuid-secret",
  internalOwnerName: "Priya N.",
  createdById: "creator-uuid-secret",
  sourceLinkCount: 4,
};

describe("deliverableContent — the deliverable leak boundary", () => {
  it("emits only client-safe fields", () => {
    const content = deliverableContent(base);
    expect(Object.keys(content).sort()).toEqual(
      ["acceptanceCriteria", "attachments", "description", "identifier", "scope", "targetDate", "title"].sort(),
    );
  });

  it("never emits internal owner ids/names or source counts", () => {
    const serialized = JSON.stringify(deliverableContent(base));
    expect(serialized).not.toContain("internal-user-uuid-secret");
    expect(serialized).not.toContain("creator-uuid-secret");
    expect(serialized).not.toContain("Priya");
    expect(serialized).not.toContain("sourceLinkCount");
  });

  it("formats target date as a plain date, null when unset", () => {
    expect(deliverableContent(base).targetDate).toBe("2026-09-30");
    expect(deliverableContent({ ...base, targetDate: null }).targetDate).toBeNull();
  });
});

describe("materialContentHash", () => {
  it("is stable for identical material content", () => {
    expect(materialContentHash(deliverableContent(base))).toBe(
      materialContentHash(deliverableContent({ ...base })),
    );
  });

  it("changes when scope, acceptance criteria, or description change (§26)", () => {
    const h = materialContentHash(deliverableContent(base));
    expect(materialContentHash(deliverableContent({ ...base, scope: "wider" }))).not.toBe(h);
    expect(
      materialContentHash(deliverableContent({ ...base, acceptanceCriteria: "different" })),
    ).not.toBe(h);
    expect(materialContentHash(deliverableContent({ ...base, description: "reworded" }))).not.toBe(h);
  });

  it("ignores non-material fields (title, target date) by default", () => {
    const h = materialContentHash(deliverableContent(base));
    expect(materialContentHash(deliverableContent({ ...base, title: "Renamed" }))).toBe(h);
    expect(
      materialContentHash(deliverableContent({ ...base, targetDate: new Date("2027-01-01") })),
    ).toBe(h);
  });

  it("published files are material: adding or changing a file changes the hash (§26)", () => {
    const fileA = { attachmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fileName: "spec.pdf", sha256: "hash-a" };
    const fileB = { attachmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fileName: "spec.pdf", sha256: "hash-b" };
    const without = materialContentHash(deliverableContent(base));
    const withA = materialContentHash(deliverableContent(base, [fileA]));
    expect(withA).not.toBe(without);
    expect(materialContentHash(deliverableContent(base, [fileB]))).not.toBe(withA);
    // Renaming a file without changing bytes is NOT material.
    expect(
      materialContentHash(deliverableContent(base, [{ ...fileA, fileName: "renamed.pdf" }])),
    ).toBe(withA);
  });

  it("attachment order in snapshots is deterministic", () => {
    const a = { attachmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fileName: "a", sha256: "1" };
    const b = { attachmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fileName: "b", sha256: "2" };
    expect(deliverableContent(base, [b, a]).attachments).toEqual(
      deliverableContent(base, [a, b]).attachments,
    );
  });
});

describe("lifecycle rules (§25)", () => {
  it("keeps Approved and Delivered separate — approval does not deliver", () => {
    expect(allowedTransitions("APPROVED")).toContain("DELIVERED");
    expect(allowedTransitions("IN_PROGRESS")).not.toContain("DELIVERED");
    expect(allowedTransitions("READY_FOR_REVIEW")).not.toContain("DELIVERED");
  });

  it("does not let internal users self-approve (client action, Phase 3.3)", () => {
    for (const status of Object.keys({
      DRAFT: 1, PLANNED: 1, IN_PROGRESS: 1, READY_FOR_REVIEW: 1, CHANGES_REQUESTED: 1,
    })) {
      expect(allowedTransitions(status)).not.toContain("APPROVED");
    }
  });

  it("archived is terminal", () => {
    expect(allowedTransitions("ARCHIVED")).toHaveLength(0);
  });

  it("content is editable only before/after review, never while frozen for review", () => {
    expect(isEditableStatus("DRAFT")).toBe(true);
    expect(isEditableStatus("IN_PROGRESS")).toBe(true);
    expect(isEditableStatus("CHANGES_REQUESTED")).toBe(true);
    expect(isEditableStatus("READY_FOR_REVIEW")).toBe(false);
    expect(isEditableStatus("APPROVED")).toBe(false);
    expect(isEditableStatus("DELIVERED")).toBe(false);
  });

  it("clients only ever see statuses that have a frozen version", () => {
    expect(CLIENT_VISIBLE_DELIVERABLE_STATUSES).not.toContain("DRAFT");
    expect(CLIENT_VISIBLE_DELIVERABLE_STATUSES).not.toContain("PLANNED");
    expect(CLIENT_VISIBLE_DELIVERABLE_STATUSES).not.toContain("IN_PROGRESS");
    expect(CLIENT_VISIBLE_DELIVERABLE_STATUSES).toContain("READY_FOR_REVIEW");
  });
});
