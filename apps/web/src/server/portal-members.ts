import { getPrisma, withRlsContext, type RoleKey } from "@frontstage/database";
import { isClientRole } from "@frontstage/authorization";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { enqueueOutboxEvent } from "@/server/outbox";
import { generateInvitationToken, hashToken } from "@/server/tokens";

const log = createLogger({ component: "web.portal-members" });

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** Client roles grantable through the portal invite flow. */
const CLIENT_INVITABLE_ROLES: readonly RoleKey[] = [
  "CLIENT_ADMIN",
  "CLIENT_APPROVER",
  "CLIENT_CONTRIBUTOR",
  "CLIENT_VIEWER",
];

export function isClientInvitableRole(role: string): role is RoleKey {
  return (CLIENT_INVITABLE_ROLES as readonly string[]).includes(role);
}

export async function listPortalClientAccess(
  user: SessionUser,
  organizationId: string,
  portalId: string,
) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");

    const members = await tx.portalMembership.findMany({
      where: { organizationId, portalId, status: "ACTIVE" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    const invitations = await tx.invitation.findMany({
      where: {
        organizationId,
        scopeType: "PORTAL",
        scopeId: portalId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      members: members.map((m) => ({
        membershipId: m.id,
        name: m.user.name,
        email: m.user.email,
        roleKey: m.roleKey,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        roleKey: i.roleKey,
        expiresAt: i.expiresAt,
      })),
    };
  });
}

/**
 * Invite a client user to a portal. Client roles only; the invitation is
 * email-bound and portal-scoped, and acceptance creates a PortalMembership
 * (never an organization membership).
 */
export async function invitePortalMember(
  user: SessionUser,
  organizationId: string,
  portal: { id: string; name: string },
  organizationName: string,
  email: string,
  roleKey: RoleKey,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new ValidationError("Enter a valid email address.");
  }
  if (!isClientInvitableRole(roleKey) || !isClientRole(roleKey)) {
    throw new ValidationError("Only client roles can be granted through portal invitations.");
  }

  const token = generateInvitationToken();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const acceptUrl = `${appUrl}/invitations/accept?token=${token}`;
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "portal.members.manage", { organizationId, portalId: portal.id });

    const invitation = await tx.invitation.create({
      data: {
        organizationId,
        email: normalizedEmail,
        roleKey,
        scopeType: "PORTAL",
        scopeId: portal.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        invitedById: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "portal.invitation.created",
      resourceType: "invitation",
      resourceId: invitation.id,
      correlationId,
      metadata: { email: normalizedEmail, roleKey, portalId: portal.id },
    });
    await enqueueOutboxEvent(tx, {
      organizationId,
      eventType: "invitation.created",
      correlationId,
      payload: {
        invitationId: invitation.id,
        email: normalizedEmail,
        organizationName: `the ${portal.name} client portal (${organizationName})`,
        invitedByName: user.name ?? user.email,
        roleKey,
        acceptUrl,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
    log.info("portal_invitation_created", {
      organizationId,
      portalId: portal.id,
      invitationId: invitation.id,
      correlationId,
    });
  });
}

export async function removePortalMember(
  user: SessionUser,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");

    const membership = await tx.portalMembership.findFirst({
      where: { id: membershipId, organizationId },
      include: { user: true },
    });
    if (!membership) throw new ValidationError("Portal member not found.");
    assertPermission(context, "portal.members.manage", {
      organizationId,
      portalId: membership.portalId,
    });

    await tx.portalMembership.delete({ where: { id: membership.id } });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "portal.member.removed",
      resourceType: "portal_membership",
      resourceId: membership.id,
      correlationId,
      metadata: { email: membership.user.email, portalId: membership.portalId },
    });
  });
}
