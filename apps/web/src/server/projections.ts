import { getPrisma, withRlsContext, type TransactionClient } from "@frontstage/database";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import {
  projectClientView,
  type ClientProjectView,
  type InternalWorkItemData,
} from "@/server/projection-view";

const log = createLogger({ component: "web.projections" });

export const HEALTH_VALUES = [
  "NOT_SET",
  "ON_TRACK",
  "AT_RISK",
  "OFF_TRACK",
  "PAUSED",
  "COMPLETE",
] as const;

/** Linear PROJECT sources not yet linked to a projection in this portal. */
export async function listAvailableProjectSources(
  user: SessionUser,
  organizationId: string,
  portalId: string,
) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const linked = await tx.sourceLink.findMany({
      where: { organizationId, externalProject: { portalId } },
      select: { sourceObjectId: true },
    });
    const linkedIds = linked.map((l) => l.sourceObjectId);
    return tx.sourceObject.findMany({
      where: { organizationId, type: "PROJECT", archivedAt: null, id: { notIn: linkedIds } },
      orderBy: { title: "asc" },
    });
  });
}

/**
 * Generate a draft client-safe projection from a Linear project source.
 * Every work item starts INTERNAL (§6.1): nothing becomes client-visible
 * without an explicit curation decision.
 */
export async function createDraftFromSource(
  user: SessionUser,
  organizationId: string,
  portalId: string,
  sourceObjectId: string,
): Promise<string> {
  const correlationId = newCorrelationId();

  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "project.create", { organizationId, portalId });

    const portal = await tx.portal.findFirst({
      where: { id: portalId, organizationId },
      include: { clientOrganization: true },
    });
    if (!portal) throw new ValidationError("Portal not found.");

    const source = await tx.sourceObject.findFirst({
      where: { id: sourceObjectId, organizationId, type: "PROJECT" },
    });
    if (!source) throw new ValidationError("Source project not found. Run a sync first.");

    // Atomically claim the next identifier number for this client.
    const client = await tx.clientOrganization.update({
      where: { id: portal.clientOrganizationId },
      data: { nextProjectNumber: { increment: 1 } },
    });
    const number = client.nextProjectNumber - 1;
    const identifier = `${client.identifierPrefix}-PRJ-${String(number).padStart(3, "0")}`;

    const sourceData = source.data as { description?: string };
    const project = await tx.externalProject.create({
      data: {
        organizationId,
        portalId,
        identifier,
        name: source.title,
        summary: sourceData.description ?? "",
        createdById: user.id,
      },
    });
    await tx.sourceLink.create({
      data: {
        organizationId,
        externalProjectId: project.id,
        sourceObjectId: source.id,
        isPrimary: true,
        relationship: "Implements",
      },
    });

    const issues = await tx.sourceObject.findMany({
      where: {
        organizationId,
        connectionId: source.connectionId,
        type: "ISSUE",
        parentExternalId: source.externalId,
        archivedAt: null,
      },
    });
    for (const issue of issues) {
      await tx.externalWorkItem.create({
        data: {
          organizationId,
          externalProjectId: project.id,
          sourceObjectId: issue.id,
          clientTitle: issue.title,
          visibility: "INTERNAL",
          curatedHash: issue.contentHash,
        },
      });
    }

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "projection.draft_created",
      resourceType: "external_project",
      resourceId: project.id,
      correlationId,
      metadata: { identifier, source: source.externalId, workItems: issues.length },
    });
    log.info("projection_draft_created", { organizationId, identifier, correlationId });
    return identifier;
  });
}

export async function getProjectionDetail(
  user: SessionUser,
  organizationId: string,
  identifier: string,
) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const project = await tx.externalProject.findFirst({
      where: { organizationId, identifier },
      include: {
        portal: { include: { clientOrganization: true } },
        sourceLinks: { include: { sourceObject: true } },
        workItems: {
          include: { sourceObject: true },
          orderBy: { createdAt: "asc" },
        },
        versions: { orderBy: { version: "desc" }, take: 5 },
      },
    });
    return project;
  });
}

export async function updateProjectionDraft(
  user: SessionUser,
  organizationId: string,
  identifier: string,
  fields: { name?: string; summary?: string; health?: string },
): Promise<void> {
  if (fields.health && !(HEALTH_VALUES as readonly string[]).includes(fields.health)) {
    throw new ValidationError("Invalid health value.");
  }
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const project = await tx.externalProject.findFirst({ where: { organizationId, identifier } });
    if (!project) throw new ValidationError("Projection not found.");
    assertPermission(context, "project.edit", {
      organizationId,
      portalId: project.portalId,
      projectId: project.id,
    });

    await tx.externalProject.update({
      where: { id: project.id },
      data: {
        ...(fields.name !== undefined ? { name: fields.name.trim() } : {}),
        ...(fields.summary !== undefined ? { summary: fields.summary.trim() } : {}),
        ...(fields.health !== undefined ? { health: fields.health } : {}),
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "projection.draft_edited",
      resourceType: "external_project",
      resourceId: project.id,
      correlationId,
      metadata: { fields: Object.keys(fields) },
    });
  });
}

export async function setWorkItemCuration(
  user: SessionUser,
  organizationId: string,
  workItemId: string,
  fields: { visibility?: "INTERNAL" | "CLIENT_VISIBLE"; clientTitle?: string; clientDescription?: string },
): Promise<void> {
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const item = await tx.externalWorkItem.findFirst({
      where: { id: workItemId, organizationId },
      include: { externalProject: true },
    });
    if (!item) throw new ValidationError("Work item not found.");
    assertPermission(context, "project.edit", {
      organizationId,
      portalId: item.externalProject.portalId,
      projectId: item.externalProjectId,
    });

    await tx.externalWorkItem.update({
      where: { id: item.id },
      data: {
        ...(fields.visibility !== undefined ? { visibility: fields.visibility } : {}),
        ...(fields.clientTitle !== undefined ? { clientTitle: fields.clientTitle.trim() } : {}),
        ...(fields.clientDescription !== undefined
          ? { clientDescription: fields.clientDescription.trim() || null }
          : {}),
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "projection.work_item_curated",
      resourceType: "external_work_item",
      resourceId: item.id,
      correlationId,
      metadata: { fields: Object.keys(fields) },
    });
  });
}

/**
 * Resolve a flagged source divergence. "apply" copies the new source title
 * into the client draft; "ignore" keeps the curated content. Either way the
 * decision is recorded and the flag clears — nothing is ever auto-merged.
 */
export async function resolveSourceChange(
  user: SessionUser,
  organizationId: string,
  workItemId: string,
  decision: "apply" | "ignore",
): Promise<void> {
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const item = await tx.externalWorkItem.findFirst({
      where: { id: workItemId, organizationId },
      include: { externalProject: true, sourceObject: true },
    });
    if (!item) throw new ValidationError("Work item not found.");
    assertPermission(context, "project.edit", {
      organizationId,
      portalId: item.externalProject.portalId,
      projectId: item.externalProjectId,
    });

    await tx.externalWorkItem.update({
      where: { id: item.id },
      data: {
        ...(decision === "apply" ? { clientTitle: item.sourceObject.title } : {}),
        curatedHash: item.sourceObject.contentHash,
        sourceChanged: false,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: `projection.source_change_${decision === "apply" ? "applied" : "ignored"}`,
      resourceType: "external_work_item",
      resourceId: item.id,
      correlationId,
      metadata: { source: item.sourceObject.externalId },
    });
  });
}

async function buildClientView(
  tx: TransactionClient,
  organizationId: string,
  identifier: string,
): Promise<ClientProjectView> {
  const project = await tx.externalProject.findFirst({
    where: { organizationId, identifier },
    include: {
      portal: true,
      workItems: { include: { sourceObject: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) throw new ValidationError("Projection not found.");

  const items: InternalWorkItemData[] = project.workItems.map((w) => ({
    id: w.id,
    clientTitle: w.clientTitle,
    clientDescription: w.clientDescription,
    visibility: w.visibility,
    archivedFromSource: w.archivedFromSource,
    source: { stateType: w.sourceObject.stateType ?? "backlog" },
  }));
  return projectClientView(
    { identifier: project.identifier, name: project.name, summary: project.summary, health: project.health },
    items,
    (project.portal.statusMapping as Record<string, string> | null) ?? null,
  );
}

/** Draft preview — what a client WOULD see if published right now. */
export async function previewClientView(
  user: SessionUser,
  organizationId: string,
  identifier: string,
): Promise<ClientProjectView> {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    return buildClientView(tx, organizationId, identifier);
  });
}

/**
 * Publish: freeze the current client view into an immutable version
 * snapshot. Publishing is the explicit approval step for the pilot
 * (publication_requests policy engine is future work — documented).
 */
export async function publishProjection(
  user: SessionUser,
  organizationId: string,
  identifier: string,
): Promise<number> {
  const correlationId = newCorrelationId();
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const project = await tx.externalProject.findFirst({ where: { organizationId, identifier } });
    if (!project) throw new ValidationError("Projection not found.");
    assertPermission(context, "project.publish", {
      organizationId,
      portalId: project.portalId,
      projectId: project.id,
    });

    const view = await buildClientView(tx, organizationId, identifier);
    const version = project.currentVersion + 1;
    await tx.externalProjectVersion.create({
      data: {
        organizationId,
        externalProjectId: project.id,
        version,
        snapshot: view as object,
        publishedById: user.id,
      },
    });
    await tx.externalProject.update({
      where: { id: project.id },
      data: { status: "PUBLISHED", currentVersion: version },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "projection.published",
      resourceType: "external_project",
      resourceId: project.id,
      correlationId,
      metadata: { identifier, version, visibleWorkItems: view.workItems.length },
    });
    log.info("projection_published", { organizationId, identifier, version, correlationId });
    return version;
  });
}

/** The latest immutable published snapshot (what clients actually see). */
export async function getPublishedSnapshot(
  user: SessionUser,
  organizationId: string,
  identifier: string,
): Promise<{ version: number; publishedAt: Date; snapshot: ClientProjectView } | null> {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const project = await tx.externalProject.findFirst({ where: { organizationId, identifier } });
    if (!project || project.currentVersion === 0) return null;
    const version = await tx.externalProjectVersion.findFirst({
      where: { externalProjectId: project.id, version: project.currentVersion },
    });
    if (!version) return null;
    return {
      version: version.version,
      publishedAt: version.publishedAt,
      snapshot: version.snapshot as unknown as ClientProjectView,
    };
  });
}
