import { describe, expect, it } from "vitest";
import {
  messagesClientView,
  requestClientView,
  type InternalMessageData,
  type InternalRequestData,
} from "../src/server/request-view";

const base: InternalRequestData = {
  identifier: "APEX-REQ-001",
  type: "BUG",
  title: "Verification page times out",
  description: "It spins forever on large batches.",
  status: "RECEIVED",
  clientPriority: "HIGH",
  createdAt: new Date("2026-07-16T00:00:00Z"),
  // Internal-only fields present in the INPUT to prove they never leak.
  internalPriority: "LOW",
  linearIssueId: "lin-secret-uuid-123",
  linearIssueIdentifier: "TRI-9F2A",
  linearSyncState: "FAILED",
  linearSyncError: "Linear rate limit hit (429) — internal infrastructure detail",
};

describe("requestClientView — the leak boundary for requests", () => {
  it("never emits internal triage or Linear fields", () => {
    const view = requestClientView(base);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("TRI-9F2A");
    expect(serialized).not.toContain("lin-secret");
    expect(serialized).not.toContain("rate limit");
    expect(serialized).not.toContain("FAILED");
    expect(serialized).not.toContain("internalPriority");
    // The client's own priority is theirs to see; the internal one is not.
    expect(view.clientPriority).toBe("HIGH");
    expect(serialized).not.toContain("LOW");
  });

  it("maps RECEIVED to the no-commitment label", () => {
    expect(requestClientView(base).statusLabel).toBe("Received — Not Yet Committed");
  });

  it("passes unknown statuses through as-is rather than crashing", () => {
    expect(requestClientView({ ...base, status: "SOMETHING_NEW" }).statusLabel).toBe(
      "SOMETHING_NEW",
    );
  });

  it("exposes the decision reason ONLY once formally decided", () => {
    const withReason = { ...base, decisionReason: "Out of scope for this phase." };
    expect(requestClientView(withReason).decisionReason).toBeNull(); // still RECEIVED
    expect(requestClientView({ ...withReason, status: "DECLINED" }).decisionReason).toBe(
      "Out of scope for this phase.",
    );
    expect(requestClientView({ ...withReason, status: "ACCEPTED" }).decisionReason).toBe(
      "Out of scope for this phase.",
    );
  });
});

describe("messagesClientView — the thread leak boundary", () => {
  const thread: InternalMessageData[] = [
    {
      id: "m1",
      kind: "PUBLIC_REPLY",
      body: "We are looking into the timeout.",
      authorName: "Priya N.",
      createdAt: new Date(),
      linearSyncState: "FAILED",
      linearCommentId: "lin-comment-secret-1",
    },
    {
      id: "m2",
      kind: "INTERNAL_NOTE",
      body: "SECRET: client is on the legacy psync path, do not mention until legal signs off",
      authorName: "Marcus T.",
      createdAt: new Date(),
    },
    {
      id: "m3",
      kind: "CLIENT_MESSAGE",
      body: "Any update?",
      authorName: "Dana Osei",
      createdAt: new Date(),
    },
  ];

  it("drops INTERNAL_NOTE rows entirely — body, author, existence", () => {
    const view = messagesClientView(thread);
    expect(view.map((m) => m.id)).toEqual(["m1", "m3"]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("psync");
    expect(serialized).not.toContain("Marcus");
  });

  it("strips Linear sync fields from client-visible messages", () => {
    const serialized = JSON.stringify(messagesClientView(thread));
    expect(serialized).not.toContain("lin-comment-secret-1");
    expect(serialized).not.toContain("FAILED");
    expect(serialized).not.toContain("linearSyncState");
  });
});
