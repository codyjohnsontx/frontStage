import { randomUUID } from "node:crypto";
import { getPrisma, withRlsContext } from "@frontstage/database";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { recordAuditEvent } from "@/server/audit";
import { slugify } from "@/server/slug";

const log = createLogger({ component: "web.organizations" });

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

/** Organizations the user belongs to (runs under identity RLS context). */
export async function listMyOrganizations(user: SessionUser): Promise<OrganizationSummary[]> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const memberships = await tx.organizationMembership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships
      .filter((m) => m.organization.deletedAt === null)
      .map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
      }));
  });
}

/** Resolve an org by slug, only if the user is a member. */
export async function getMyOrganizationBySlug(
  user: SessionUser,
  slug: string,
): Promise<OrganizationSummary | null> {
  const orgs = await listMyOrganizations(user);
  return orgs.find((o) => o.slug === slug) ?? null;
}

/**
 * Create an organization with the creator as ORGANIZATION_OWNER.
 * The org id is generated app-side so the RLS org context can be set before
 * the insert (the WITH CHECK policy requires it).
 */
export async function createOrganization(
  user: SessionUser,
  name: string,
): Promise<OrganizationSummary> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    throw new Error("Organization name must be between 2 and 80 characters.");
  }
  const baseSlug = slugify(trimmed);
  if (!baseSlug) {
    throw new Error("Organization name must contain letters or numbers.");
  }

  const organizationId = randomUUID();
  // Suffix keeps slugs unique without a pre-read (we cannot see other orgs'
  // slugs under RLS, and a global read would leak tenant names).
  const slug = `${baseSlug}-${organizationId.slice(0, 6)}`;
  const correlationId = newCorrelationId();

  return withRlsContext(
    getPrisma(),
    { userId: user.id, organizationId },
    async (tx) => {
      const org = await tx.organization.create({
        data: { id: organizationId, name: trimmed, slug },
      });
      const membership = await tx.organizationMembership.create({
        data: { organizationId, userId: user.id },
      });
      await tx.scopedRoleAssignment.create({
        data: {
          organizationId,
          membershipId: membership.id,
          roleKey: "ORGANIZATION_OWNER",
          scopeType: "ORGANIZATION",
          scopeId: null,
          grantedById: user.id,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: user.id,
        action: "organization.created",
        resourceType: "organization",
        resourceId: organizationId,
        correlationId,
        metadata: { name: trimmed, slug },
      });
      log.info("organization_created", { organizationId, slug, correlationId });
      return { id: org.id, name: org.name, slug: org.slug };
    },
  );
}
