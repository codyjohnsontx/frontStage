import { describe, expect, it } from "vitest";
import { projectClientView, type InternalWorkItemData } from "../src/server/projection-view";

const project = {
  identifier: "APEX-PRJ-001",
  name: "Credentialing Platform",
  summary: "Making credential verification faster and more reliable.",
  health: "ON_TRACK",
};

function item(overrides: Partial<InternalWorkItemData> & { id: string }): InternalWorkItemData {
  return {
    clientTitle: "Improve verification reliability",
    clientDescription: null,
    visibility: "CLIENT_VISIBLE",
    archivedFromSource: false,
    source: {
      stateType: "started",
      title: "Add transaction retry handling w/ jittered backoff (psync 502s)",
      description: "internal engineering notes — DO NOT SHARE",
      stateName: "Code Review",
      labels: ["do-not-share", "tech-debt"],
      estimate: 5,
      assigneeName: "Priya N.",
      url: "https://linear.app/northline/issue/ENG-42",
    },
    ...overrides,
  };
}

describe("projectClientView — the leak boundary", () => {
  it("excludes INTERNAL items entirely", () => {
    const view = projectClientView(project, [
      item({ id: "a" }),
      item({ id: "b", visibility: "INTERNAL", clientTitle: "secret internal thing" }),
    ]);
    expect(view.workItems.map((w) => w.id)).toEqual(["a"]);
    expect(JSON.stringify(view)).not.toContain("secret internal thing");
  });

  it("never emits internal source fields, even when present in the input", () => {
    const view = projectClientView(project, [item({ id: "a" })]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("psync");
    expect(serialized).not.toContain("DO NOT SHARE");
    expect(serialized).not.toContain("Code Review");
    expect(serialized).not.toContain("do-not-share");
    expect(serialized).not.toContain("Priya");
    expect(serialized).not.toContain("linear.app");
    expect(serialized).not.toContain("estimate");
  });

  it("uses the curated client title and mapped status, not source values", () => {
    const view = projectClientView(project, [item({ id: "a" })]);
    expect(view.workItems[0]!.title).toBe("Improve verification reliability");
    expect(view.workItems[0]!.status).toBe("In Progress");
  });

  it("applies portal status-mapping overrides but rejects invalid ones", () => {
    const ok = projectClientView(project, [item({ id: "a" })], { started: "Validation" });
    expect(ok.workItems[0]!.status).toBe("Validation");
    const bad = projectClientView(project, [item({ id: "a" })], { started: "QA (internal)" });
    expect(bad.workItems[0]!.status).toBe("In Progress");
  });

  it("marks archived-from-source items with the continuity note instead of deleting them", () => {
    const view = projectClientView(project, [item({ id: "a", archivedFromSource: true })]);
    expect(view.workItems[0]!.archivedNote).toMatch(/archived internally/);
  });

  it("unknown state types degrade to Planned rather than leaking raw state", () => {
    const view = projectClientView(project, [
      item({ id: "a", source: { stateType: "weird_internal_state" } }),
    ]);
    expect(view.workItems[0]!.status).toBe("Planned");
  });
});
