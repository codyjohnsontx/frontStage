import {
  hasPermission,
  type AuthorizationContext,
  type Permission,
  type ResourceScope,
  type RoleAssignment,
} from "@frontstage/authorization";
import type { TransactionClient } from "@frontstage/database";

/**
 * Build the actor's authorization context from membership + role rows.
 * Must run inside a transaction that already has the organization RLS
 * context set. Returns null when the user is not an active member.
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
