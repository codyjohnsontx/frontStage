import { getPrisma, withRlsContext } from "@frontstage/database";
import { newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { slugify } from "@/server/slug";

export async function listClientsWithPortals(user: SessionUser, organizationId: string) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    return tx.clientOrganization.findMany({
      where: { organizationId },
      include: {
        portals: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { externalProjects: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  });
}

export async function createClientOrganization(
  user: SessionUser,
  organizationId: string,
  name: string,
  identifierPrefix: string,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    throw new ValidationError("Client name must be between 2 and 80 characters.");
  }
  const prefix = identifierPrefix.trim().toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(prefix)) {
    throw new ValidationError("Identifier prefix must be 2–8 letters (e.g. APEX).");
  }
  const slug = slugify(trimmed);
  if (!slug) throw new ValidationError("Client name must contain letters or numbers.");
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "portal.create", { organizationId });

    const client = await tx.clientOrganization.create({
      data: { organizationId, name: trimmed, slug, identifierPrefix: prefix },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "client_organization.created",
      resourceType: "client_organization",
      resourceId: client.id,
      correlationId,
      metadata: { name: trimmed, prefix },
    });
  });
}

export async function createPortal(
  user: SessionUser,
  organizationId: string,
  clientOrganizationId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    throw new ValidationError("Portal name must be between 2 and 80 characters.");
  }
  const portalSlugPart = slugify(trimmed);
  if (!portalSlugPart) {
    throw new ValidationError("Portal name must contain letters or numbers.");
  }
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "portal.create", { organizationId });

    const client = await tx.clientOrganization.findFirst({
      where: { id: clientOrganizationId, organizationId },
    });
    if (!client) throw new ValidationError("Client organization not found.");

    const slug = `${client.slug}-${portalSlugPart}`;
    const portal = await tx.portal.create({
      data: { organizationId, clientOrganizationId, name: trimmed, slug },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "portal.created",
      resourceType: "portal",
      resourceId: portal.id,
      correlationId,
      metadata: { name: trimmed, client: client.name },
    });
  });
}

export async function getPortalBySlug(user: SessionUser, organizationId: string, portalSlug: string) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    return tx.portal.findFirst({
      where: { organizationId, slug: portalSlug },
      include: {
        clientOrganization: true,
        externalProjects: { orderBy: { createdAt: "asc" } },
      },
    });
  });
}
