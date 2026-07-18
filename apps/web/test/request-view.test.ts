import { describe, expect, it } from "vitest";
import { requestClientView, type InternalRequestData } from "../src/server/request-view";

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
});
