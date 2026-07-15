import {
  getPrisma,
  setRlsContext,
  withRlsContext,
  type RoleKey,
  type TransactionClient,
} from "@frontstage/database";
import type { SessionUser } from "@/server/session";
import type { ClientProjectView } from "@/server/projection-view";

/**
 * Client-side portal reads. Everything here renders from PUBLISHED
 * immutable snapshots only — never from drafts or source objects. Access is
 * proven via PortalMembership under the identity RLS context before any
 * organization context is entered.
 */

export interface ClientPortalSummary {
  portalId: string;
  portalSlug: string;
  portalName: string;
  roleKey: RoleKey;
}

/** Portals the signed-in user can access as a client. */
export async function listMyClientPortals(user: SessionUser): Promise<ClientPortalSummary[]> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const memberships = await tx.portalMembership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { portal: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({
      portalId: m.portalId,
      portalSlug: m.portal.slug,
      portalName: m.portal.name,
      roleKey: m.roleKey,
    }));
  });
}

interface PortalAccess {
  portalId: string;
  organizationId: string;
  clientOrganizationId: string;
  portalName: string;
  roleKey: RoleKey;
}

/** Resolve the user's active membership for a portal slug, or null. */
async function resolveAccess(
  tx: TransactionClient,
  user: SessionUser,
  portalSlug: string,
): Promise<PortalAccess | null> {
  const membership = await tx.portalMembership.findFirst({
    where: { userId: user.id, status: "ACTIVE", portal: { slug: portalSlug } },
    include: { portal: true },
  });
  if (!membership) return null;
  return {
    portalId: membership.portalId,
    organizationId: membership.organizationId,
    clientOrganizationId: membership.portal.clientOrganizationId,
    portalName: membership.portal.name,
    roleKey: membership.roleKey,
  };
}

export interface ClientPortalOverview {
  portalName: string;
  portalSlug: string;
  clientOrganizationName: string;
  hostOrganizationName: string;
  roleKey: RoleKey;
  projects: {
    identifier: string;
    name: string;
    summary: string;
    health: string;
    version: number;
    publishedAt: Date;
    workItemCount: number;
  }[];
}

export async function getClientPortalOverview(
  user: SessionUser,
  portalSlug: string,
): Promise<ClientPortalOverview | null> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccess(tx, user, portalSlug);
    if (!access) return null;

    // Membership proven — enter the host org context for published reads.
    await setRlsContext(tx, { organizationId: access.organizationId });

    const [clientOrg, hostOrg, projects] = [
      await tx.clientOrganization.findUnique({ where: { id: access.clientOrganizationId } }),
      await tx.organization.findUnique({ where: { id: access.organizationId } }),
      await tx.externalProject.findMany({
        where: {
          portalId: access.portalId,
          status: "PUBLISHED",
          currentVersion: { gt: 0 },
          archivedAt: null,
        },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        orderBy: { createdAt: "asc" },
      }),
    ];

    return {
      portalName: access.portalName,
      portalSlug,
      clientOrganizationName: clientOrg?.name ?? "",
      hostOrganizationName: hostOrg?.name ?? "",
      roleKey: access.roleKey,
      projects: projects
        .filter((p) => p.versions.length > 0)
        .map((p) => {
          const latest = p.versions[0]!;
          const snapshot = latest.snapshot as unknown as ClientProjectView;
          return {
            identifier: snapshot.identifier,
            name: snapshot.name,
            summary: snapshot.summary,
            health: snapshot.health,
            version: latest.version,
            publishedAt: latest.publishedAt,
            workItemCount: snapshot.workItems.length,
          };
        }),
    };
  });
}

export interface ClientPublishedProject {
  portalName: string;
  roleKey: RoleKey;
  version: number;
  publishedAt: Date;
  snapshot: ClientProjectView;
  history: { version: number; publishedAt: Date }[];
}

export async function getClientPublishedProject(
  user: SessionUser,
  portalSlug: string,
  identifier: string,
): Promise<ClientPublishedProject | null> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccess(tx, user, portalSlug);
    if (!access) return null;

    await setRlsContext(tx, { organizationId: access.organizationId });

    const project = await tx.externalProject.findFirst({
      where: {
        organizationId: access.organizationId,
        portalId: access.portalId,
        identifier,
        status: "PUBLISHED",
        currentVersion: { gt: 0 },
      },
      include: { versions: { orderBy: { version: "desc" } } },
    });
    if (!project || project.versions.length === 0) return null;

    const latest = project.versions[0]!;
    return {
      portalName: access.portalName,
      roleKey: access.roleKey,
      version: latest.version,
      publishedAt: latest.publishedAt,
      snapshot: latest.snapshot as unknown as ClientProjectView,
      history: project.versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt })),
    };
  });
}
