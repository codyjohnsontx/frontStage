import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  CLIENT_ROLES,
  INTERNAL_ONLY_PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  type AuthorizationContext,
  type ResourceScope,
} from "../src/index.js";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const PORTAL_APEX = "33333333-3333-3333-3333-333333333333";
const PORTAL_SUMMIT = "44444444-4444-4444-4444-444444444444";
const PROJECT_CRED = "55555555-5555-5555-5555-555555555555";

const apexResource: ResourceScope = {
  organizationId: ORG_A,
  portalId: PORTAL_APEX,
  projectId: PROJECT_CRED,
};

function ctx(assignments: AuthorizationContext["assignments"]): AuthorizationContext {
  return { organizationId: ORG_A, assignments };
}

describe("hasPermission — scope resolution", () => {
  it("org-wide admin can manage any portal in the organization", () => {
    const c = ctx([{ roleKey: "ORGANIZATION_ADMIN", scopeType: "ORGANIZATION", scopeId: null }]);
    expect(hasPermission(c, "portal.manage", apexResource)).toBe(true);
    expect(
      hasPermission(c, "portal.manage", { organizationId: ORG_A, portalId: PORTAL_SUMMIT }),
    ).toBe(true);
  });

  it("portal admin scoped to one portal cannot manage another portal", () => {
    const c = ctx([{ roleKey: "PORTAL_ADMIN", scopeType: "PORTAL", scopeId: PORTAL_APEX }]);
    expect(hasPermission(c, "portal.manage", apexResource)).toBe(true);
    expect(
      hasPermission(c, "portal.manage", { organizationId: ORG_A, portalId: PORTAL_SUMMIT }),
    ).toBe(false);
  });

  it("project-scoped lead can publish only their project", () => {
    const c = ctx([{ roleKey: "PROJECT_LEAD", scopeType: "PROJECT", scopeId: PROJECT_CRED }]);
    expect(hasPermission(c, "project.publish", apexResource)).toBe(true);
    expect(
      hasPermission(c, "project.publish", {
        organizationId: ORG_A,
        portalId: PORTAL_APEX,
        projectId: "66666666-6666-6666-6666-666666666666",
      }),
    ).toBe(false);
  });

  it("client approver can approve deliverables on their portal only", () => {
    const c = ctx([{ roleKey: "CLIENT_APPROVER", scopeType: "PORTAL", scopeId: PORTAL_APEX }]);
    expect(hasPermission(c, "deliverable.approve", apexResource)).toBe(true);
    expect(
      hasPermission(c, "deliverable.approve", { organizationId: ORG_A, portalId: PORTAL_SUMMIT }),
    ).toBe(false);
  });
});

describe("hasPermission — tenant isolation", () => {
  it("denies everything when the resource belongs to a different organization", () => {
    const c = ctx([{ roleKey: "ORGANIZATION_OWNER", scopeType: "ORGANIZATION", scopeId: null }]);
    const foreign: ResourceScope = { organizationId: ORG_B, portalId: PORTAL_APEX };
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission(c, permission, foreign)).toBe(false);
    }
  });

  it("a scoped assignment with a null scopeId never matches scoped resources", () => {
    const c = ctx([{ roleKey: "PORTAL_ADMIN", scopeType: "PORTAL", scopeId: null }]);
    expect(hasPermission(c, "portal.manage", apexResource)).toBe(false);
  });
});

describe("hasPermission — capability boundaries", () => {
  it("contributor can draft but not publish updates", () => {
    const c = ctx([{ roleKey: "CONTRIBUTOR", scopeType: "PORTAL", scopeId: PORTAL_APEX }]);
    expect(hasPermission(c, "update.draft", apexResource)).toBe(true);
    expect(hasPermission(c, "update.publish", apexResource)).toBe(false);
  });

  it("client contributor can submit requests and comment, nothing internal", () => {
    const c = ctx([{ roleKey: "CLIENT_CONTRIBUTOR", scopeType: "PORTAL", scopeId: PORTAL_APEX }]);
    expect(hasPermission(c, "request.submit", apexResource)).toBe(true);
    expect(hasPermission(c, "comment.create", apexResource)).toBe(true);
    expect(hasPermission(c, "comment.internal.create", apexResource)).toBe(false);
    expect(hasPermission(c, "request.triage", apexResource)).toBe(false);
  });
});

describe("role bundle invariants", () => {
  it("every role has a defined bundle", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect(Array.isArray(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS])).toBe(true);
    }
  });

  it("no client role ever includes an internal-only permission", () => {
    for (const role of CLIENT_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(INTERNAL_ONLY_PERMISSIONS).not.toContain(permission);
      }
    }
  });

  it("client viewer has no write capabilities at all", () => {
    expect(ROLE_PERMISSIONS.CLIENT_VIEWER).toHaveLength(0);
  });
});
