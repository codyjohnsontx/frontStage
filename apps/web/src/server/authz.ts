import {
  hasPermission,
  type AuthorizationContext,
  type Permission,
  type ResourceScope,
  type RoleAssignment,
} from "@frontstage/authorization";
import type { TransactionClient } from "@frontstage/database";

/**
 * Build an INTERNAL actor's authorization context from organization
 * membership + scoped role rows. Must run inside a transaction that already
 * has the organization RLS context set. Returns null when the user is not
 * an active internal member — a non-null result is the membership gate for
 * internal console services, so client portal memberships deliberately do
 * NOT count here. Client flows prove access via PortalMembership in
 * client-portal.ts and will get their own context builder when client
 * capability checks arrive (Phase 2.2).
 */
export async function loadAuthorizationContext(
  tx: TransactionClient,
  organizationId: string,
  userId: string,
): Promise<AuthorizationContext | null> {
  const membership = await tx.organizationMembership.findFirst({
    where: { organizationId, userId, status: "ACTIVE" },
    include: { roleAssignments: true },
  });
  if (!membership) return null;

  const assignments: RoleAssignment[] = membership.roleAssignments.map((a) => ({
    roleKey: a.roleKey,
    scopeType: a.scopeType,
    scopeId: a.scopeId,
  }));
  return { organizationId, assignments };
}

export class PermissionDeniedError extends Error {
  constructor(permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export function assertPermission(
  context: AuthorizationContext,
  permission: Permission,
  resource: ResourceScope,
): void {
  if (!hasPermission(context, permission, resource)) {
    throw new PermissionDeniedError(permission);
  }
}
