import { getPrisma, setRlsContext, withRlsContext, type RoleKey } from "@frontstage/database";
import { INTERNAL_ROLES, type RoleKey as AuthzRoleKey } from "@frontstage/authorization";
import type { SessionUser } from "@/server/session";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { enqueueOutboxEvent } from "@/server/outbox";
import { generateInvitationToken, hashToken } from "@/server/tokens";

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** Org-level roles that can be granted through the Phase 0 invite flow. */
const INVITABLE_ROLES: readonly RoleKey[] = [
  "ORGANIZATION_ADMIN",
  "CONTRIBUTOR",
  "INTERNAL_VIEWER",
];

export function isInvitableRole(role: string): role is RoleKey {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

export async function listMembersAndInvitations(user: SessionUser, organizationId: string) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new Error("Not a member of this organization.");

    const members = await tx.organizationMembership.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: { user: true, roleAssignments: true },
      orderBy: { createdAt: "asc" },
    });
    const invitations = await tx.invitation.findMany({
      where: { organizationId, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return {
      members: members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        roles: m.roleAssignments.map((r) => r.roleKey),
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
 * Invite an internal member at organization scope. Requires
 * organization.manage. Commits invitation + audit + outbox email atomically;
 * the worker sends the email.
 */
export async function inviteMember(
  user: SessionUser,
  organizationId: string,
  organizationName: string,
  email: string,
  roleKey: RoleKey,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }
  if (!isInvitableRole(roleKey)) {
    throw new Error("This role cannot be granted through the invite flow.");
  }
  // Internal-role sanity check against the authorization package's list.
  if (!(INTERNAL_ROLES as readonly string[]).includes(roleKey satisfies AuthzRoleKey)) {
    throw new Error("Client roles are invited through portals (Phase 2).");
  }

  const token = generateInvitationToken();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const acceptUrl = `${appUrl}/invitations/accept?token=${token}`;

  await withRlsContext(getPrisma(), { userId: user.id, organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new Error("Not a member of this organization.");
    assertPermission(context, "organization.manage", { organizationId });

    const invitation = await tx.invitation.create({
      data: {
        organizationId,
        email: normalizedEmail,
        roleKey,
        scopeType: "ORGANIZATION",
        scopeId: null,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        invitedById: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "invitation.created",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { email: normalizedEmail, roleKey },
    });
    // The raw accept URL is carried only in the outbox payload so the worker
    // can send it; rows are short-lived (processed then pruned by retention).
    await enqueueOutboxEvent(tx, {
      organizationId,
      eventType: "invitation.created",
      payload: {
        invitationId: invitation.id,
        email: normalizedEmail,
        organizationName,
        invitedByName: user.name ?? user.email,
        roleKey,
        acceptUrl,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
  });
}

export async function revokeInvitation(
  user: SessionUser,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new Error("Not a member of this organization.");
    assertPermission(context, "organization.manage", { organizationId });

    const invitation = await tx.invitation.findFirst({
      where: { id: invitationId, organizationId, status: "PENDING" },
    });
    if (!invitation) throw new Error("Invitation not found or already resolved.");

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "invitation.revoked",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { email: invitation.email },
    });
  });
}

export type InvitationPreview =
  | { ok: true; organizationName: string; roleKey: RoleKey; email: string }
  | { ok: false; reason: string };

/**
 * Read-only invitation lookup for the accept screen. No state changes —
 * acceptance itself must be an explicit POST so that email-link scanners and
 * prefetchers cannot accept on the invitee's behalf.
 */
export async function previewInvitation(
  user: SessionUser,
  token: string,
): Promise<InvitationPreview> {
  const tokenHash = hashToken(token);
  return withRlsContext(getPrisma(), { userId: user.id, userEmail: user.email }, async (tx) => {
    const invitation = await tx.invitation.findFirst({ where: { tokenHash } });
    if (!invitation) {
      return {
        ok: false,
        reason:
          "This invitation does not exist, was revoked, or is addressed to a different email than the one you signed in with.",
      };
    }
    if (invitation.status !== "PENDING") {
      return { ok: false, reason: `This invitation was already ${invitation.status.toLowerCase()}.` };
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: "This invitation has expired. Ask for a new one." };
    }
    await setRlsContext(tx, { organizationId: invitation.organizationId });
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: invitation.organizationId },
    });
    return {
      ok: true,
      organizationName: org.name,
      roleKey: invitation.roleKey,
      email: invitation.email,
    };
  });
}

export type AcceptResult =
  | { ok: true; organizationSlug: string; organizationName: string }
  | { ok: false; reason: string };

/**
 * Accept an invitation. Email binding is enforced twice: the RLS policy only
 * exposes invitations whose email matches the authenticated identity, and we
 * re-check in application code.
 */
export async function acceptInvitation(user: SessionUser, token: string): Promise<AcceptResult> {
  const tokenHash = hashToken(token);

  return withRlsContext(getPrisma(), { userId: user.id, userEmail: user.email }, async (tx) => {
    const invitation = await tx.invitation.findFirst({ where: { tokenHash } });
    if (!invitation) {
      return {
        ok: false,
        reason:
          "This invitation does not exist, was revoked, or is addressed to a different email than the one you signed in with.",
      };
    }
    if (invitation.email.toLowerCase() !== user.email) {
      // Unreachable if RLS is intact — defense in depth.
      return { ok: false, reason: "This invitation is addressed to a different email." };
    }
    if (invitation.status !== "PENDING") {
      return { ok: false, reason: `This invitation was already ${invitation.status.toLowerCase()}.` };
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      return { ok: false, reason: "This invitation has expired. Ask for a new one." };
    }

    // Enter the invitation's organization context for the membership writes.
    await setRlsContext(tx, { organizationId: invitation.organizationId });

    let membership = await tx.organizationMembership.findFirst({
      where: { organizationId: invitation.organizationId, userId: user.id },
    });
    if (membership) {
      membership = await tx.organizationMembership.update({
        where: { id: membership.id },
        data: { status: "ACTIVE" },
      });
    } else {
      membership = await tx.organizationMembership.create({
        data: { organizationId: invitation.organizationId, userId: user.id },
      });
    }

    // find-then-create (not upsert): compound uniques never match a NULL
    // scopeId in Postgres, so org-scope duplicates must be checked manually.
    const existingAssignment = await tx.scopedRoleAssignment.findFirst({
      where: {
        membershipId: membership.id,
        roleKey: invitation.roleKey,
        scopeType: invitation.scopeType,
        scopeId: invitation.scopeId,
      },
    });
    if (!existingAssignment) {
      await tx.scopedRoleAssignment.create({
        data: {
          organizationId: invitation.organizationId,
          membershipId: membership.id,
          roleKey: invitation.roleKey,
          scopeType: invitation.scopeType,
          scopeId: invitation.scopeId,
          grantedById: invitation.invitedById,
        },
      });
    }
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedById: user.id, acceptedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      action: "invitation.accepted",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { email: invitation.email, roleKey: invitation.roleKey },
    });

    const org = await tx.organization.findUniqueOrThrow({
      where: { id: invitation.organizationId },
    });
    return { ok: true, organizationSlug: org.slug, organizationName: org.name };
  });
}
