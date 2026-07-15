import type { Permission } from "./permissions";
import type { RoleKey } from "./roles";
import { ROLE_PERMISSIONS } from "./roles";

export type ScopeType = "ORGANIZATION" | "CLIENT_ORGANIZATION" | "PORTAL" | "PROJECT";

export interface RoleAssignment {
  roleKey: RoleKey;
  scopeType: ScopeType;
  /** Null for ORGANIZATION scope; otherwise the id of the scoped resource. */
  scopeId: string | null;
}

/** The authenticated actor's effective grants within ONE organization. */
export interface AuthorizationContext {
  organizationId: string;
  assignments: readonly RoleAssignment[];
}

/** Ownership coordinates of the resource being acted on. */
export interface ResourceScope {
  organizationId: string;
  clientOrganizationId?: string;
  portalId?: string;
  projectId?: string;
}

function assignmentCoversResource(a: RoleAssignment, resource: ResourceScope): boolean {
  switch (a.scopeType) {
    case "ORGANIZATION":
      // Org-wide grant covers everything inside the organization.
      return true;
    case "CLIENT_ORGANIZATION":
      return a.scopeId !== null && a.scopeId === resource.clientOrganizationId;
    case "PORTAL":
      return a.scopeId !== null && a.scopeId === resource.portalId;
    case "PROJECT":
      return a.scopeId !== null && a.scopeId === resource.projectId;
  }
}

/**
 * Server-side permission check. Returns true only when:
 *  1. the resource belongs to the context's organization (hard tenant check),
 *  2. some role assignment's scope covers the resource, and
 *  3. that role's bundle includes the permission.
 *
 * Never derive `context` from client-supplied ids — build it from the
 * authenticated session and the membership/role rows in the database.
 */
export function hasPermission(
  context: AuthorizationContext,
  permission: Permission,
  resource: ResourceScope,
): boolean {
  if (resource.organizationId !== context.organizationId) {
    return false;
  }
  return context.assignments.some(
    (a) =>
      assignmentCoversResource(a, resource) &&
      ROLE_PERMISSIONS[a.roleKey].includes(permission),
  );
}
