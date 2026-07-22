import {
  getPrisma,
  setRlsContext,
  withRlsContext,
  type DeliverableStatus,
} from "@frontstage/database";
import { hasPermission } from "@frontstage/authorization";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { resolveAccessByUserId } from "@/server/client-portal";
import {
  CLIENT_VISIBLE_DELIVERABLE_STATUSES,
  deliverableContent,
  materialContentHash,
  type DeliverableContent,
} from "@/server/deliverable-view";

const log = createLogger({ component: "web.deliverables" });

/**
 * Allowed lifecycle moves (§25). Approved -> Delivered is deliberately a
 * separate, internal step: acceptance and contractual delivery are not the
 * same event. Client-driven approve / request-changes arrive in Phase 3.3;
 * until then APPROVED is reachable only through that future flow, so it is
 * absent from the internal transition table.
 */
const TRANSITIONS: Record<string, readonly DeliverableStatus[]> = {
  DRAFT: ["PLANNED", "ARCHIVED"],
  PLANNED: ["IN_PROGRESS", "DRAFT", "ARCHIVED"],
  IN_PROGRESS: ["READY_FOR_REVIEW", "PLANNED", "ARCHIVED"],
  READY_FOR_REVIEW: ["CHANGES_REQUESTED", "IN_PROGRESS", "ARCHIVED"],
  CHANGES_REQUESTED: ["READY_FOR_REVIEW", "IN_PROGRESS", "ARCHIVED"],
  APPROVED: ["DELIVERED", "ARCHIVED"],
  DELIVERED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Statuses whose editable content is still open to internal editing. */
const EDITABLE_STATUSES: readonly string[] = [
  "DRAFT",
  "PLANNED",
  "IN_PROGRESS",
  "CHANGES_REQUESTED",
];

export function allowedTransitions(status: string): readonly DeliverableStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function isEditableStatus(status: string): boolean {
  return EDITABLE_STATUSES.includes(status);
}

function validateContent(input: {
  title: string;
  description: string;
  scope: string;
  acceptanceCriteria: string;
  targetDate: string;
}) {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 140) {
    throw new ValidationError("Title must be between 3 and 140 characters.");
  }
  let targetDate: Date | null = null;
  if (input.targetDate.trim()) {
    const parsed = new Date(`${input.targetDate.trim()}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new ValidationError("Target date is not a valid date.");
    targetDate = parsed;
  }
  return {
    title,
    description: input.description.trim(),
    scope: input.scope.trim(),
    acceptanceCriteria: input.acceptanceCriteria.trim(),
    targetDate,
  };
}

export async function createDeliverable(
  user: SessionUser,
  organizationId: string,
  portalId: string,
  input: { title: string; description: string; scope: string; acceptanceCriteria: string; targetDate: string },
): Promise<string> {
  const content = validateContent(input);
  const correlationId = newCorrelationId();

  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "deliverable.create", { organizationId, portalId });

    const portal = await tx.portal.findFirst({ where: { id: portalId, organizationId } });
    if (!portal) throw new ValidationError("Portal not found.");

    const client = await tx.clientOrganization.update({
      where: { id: portal.clientOrganizationId },
      data: { nextDeliverableNumber: { increment: 1 } },
    });
    const identifier = `${client.identifierPrefix}-DEL-${String(client.nextDeliverableNumber - 1).padStart(3, "0")}`;

    const deliverable = await tx.deliverable.create({
      data: {
        organizationId,
        portalId,
        identifier,
        ...content,
        internalOwnerId: user.id,
        createdById: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "deliverable.created",
      resourceType: "deliverable",
      resourceId: deliverable.id,
      correlationId,
      metadata: { identifier, portalId },
    });
    log.info("deliverable_created", { organizationId, identifier, correlationId });
    return identifier;
  });
}

export async function updateDeliverableDraft(
  user: SessionUser,
  organizationId: string,
  deliverableId: string,
  input: { title: string; description: string; scope: string; acceptanceCriteria: string; targetDate: string },
): Promise<void> {
  const content = validateContent(input);
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const deliverable = await tx.deliverable.findFirst({
      where: { id: deliverableId, organizationId },
    });
    if (!deliverable) throw new ValidationError("Deliverable not found.");
    assertPermission(context, "deliverable.edit", {
      organizationId,
      portalId: deliverable.portalId,
    });
    if (!isEditableStatus(deliverable.status)) {
      throw new ValidationError(
        `A deliverable that is ${deliverable.status.toLowerCase().replace(/_/g, " ")} cannot be edited. Move it back to In Progress first.`,
      );
    }

    // Guarded on the editable status set: a concurrent ready-for-review must
    // not have its frozen content edited out from under it.
    const updated = await tx.deliverable.updateMany({
      where: { id: deliverable.id, status: { in: EDITABLE_STATUSES as DeliverableStatus[] } },
      data: content,
    });
    if (updated.count !== 1) {
      throw new ValidationError("This deliverable changed state just now. Reload and try again.");
    }
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "deliverable.updated",
      resourceType: "deliverable",
      resourceId: deliverable.id,
      correlationId,
      metadata: { identifier: deliverable.identifier, fields: Object.keys(content) },
    });
  });
}

/**
 * Lifecycle transition. Moving INTO Ready for Review freezes the current
 * content as an immutable version — that exact version is what a client
 * approves in Phase 3.3.
 */
export async function transitionDeliverable(
  user: SessionUser,
  organizationId: string,
  deliverableId: string,
  target: DeliverableStatus,
): Promise<void> {
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const deliverable = await tx.deliverable.findFirst({
      where: { id: deliverableId, organizationId },
    });
    if (!deliverable) throw new ValidationError("Deliverable not found.");

    // Publishing content to the client (ready for review) is a stronger
    // capability than routine editing.
    const permission = target === "READY_FOR_REVIEW" ? "deliverable.publish" : "deliverable.edit";
    assertPermission(context, permission, { organizationId, portalId: deliverable.portalId });

    if (!allowedTransitions(deliverable.status).includes(target)) {
      throw new ValidationError(
        `Cannot move a ${deliverable.status.toLowerCase().replace(/_/g, " ")} deliverable to ${target.toLowerCase().replace(/_/g, " ")}.`,
      );
    }

    const freezes = target === "READY_FOR_REVIEW";
    const nextVersion = freezes ? deliverable.currentVersion + 1 : deliverable.currentVersion;

    // Conditional transition on the observed status.
    const moved = await tx.deliverable.updateMany({
      where: { id: deliverable.id, status: deliverable.status },
      data: {
        status: target,
        ...(freezes ? { currentVersion: nextVersion } : {}),
        ...(target === "ARCHIVED" ? { archivedAt: new Date() } : {}),
      },
    });
    if (moved.count !== 1) {
      throw new ValidationError("This deliverable changed state just now. Reload and try again.");
    }

    if (freezes) {
      const content = deliverableContent(deliverable);
      await tx.deliverableVersion.create({
        data: {
          organizationId,
          deliverableId: deliverable.id,
          version: nextVersion,
          snapshot: content as unknown as object,
          contentHash: materialContentHash(content),
          createdById: user.id,
        },
      });
    }

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: `deliverable.${target.toLowerCase()}`,
      resourceType: "deliverable",
      resourceId: deliverable.id,
      correlationId,
      metadata: {
        identifier: deliverable.identifier,
        from: deliverable.status,
        to: target,
        ...(freezes ? { version: nextVersion } : {}),
      },
    });
    log.info("deliverable_transitioned", {
      organizationId,
      identifier: deliverable.identifier,
      from: deliverable.status,
      to: target,
      correlationId,
    });
  });
}

export async function setDeliverableSourceLink(
  user: SessionUser,
  organizationId: string,
  deliverableId: string,
  sourceObjectId: string,
  relationship: string,
): Promise<void> {
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const deliverable = await tx.deliverable.findFirst({
      where: { id: deliverableId, organizationId },
    });
    if (!deliverable) throw new ValidationError("Deliverable not found.");
    assertPermission(context, "deliverable.edit", {
      organizationId,
      portalId: deliverable.portalId,
    });
    const source = await tx.sourceObject.findFirst({
      where: { id: sourceObjectId, organizationId },
    });
    if (!source) throw new ValidationError("Source work item not found.");

    const existing = await tx.deliverableSourceLink.findFirst({
      where: { deliverableId: deliverable.id, sourceObjectId },
    });
    if (existing) {
      await tx.deliverableSourceLink.delete({ where: { id: existing.id } });
    } else {
      await tx.deliverableSourceLink.create({
        data: {
          organizationId,
          deliverableId: deliverable.id,
          sourceObjectId,
          relationship: relationship.trim() || null,
        },
      });
    }
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: existing ? "deliverable.source_unlinked" : "deliverable.source_linked",
      resourceType: "deliverable",
      resourceId: deliverable.id,
      correlationId,
      metadata: { identifier: deliverable.identifier, source: source.externalId },
    });
  });
}

export interface DeliverablePermissions {
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
}

/** The acting user's deliverable capabilities on a portal (for UI gating —
 * every action re-asserts server-side). */
export async function getMyDeliverablePermissions(
  user: SessionUser,
  organizationId: string,
  portalId: string,
): Promise<DeliverablePermissions> {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) return { canCreate: false, canEdit: false, canPublish: false };
    const resource = { organizationId, portalId };
    return {
      canCreate: hasPermission(context, "deliverable.create", resource),
      canEdit: hasPermission(context, "deliverable.edit", resource),
      canPublish: hasPermission(context, "deliverable.publish", resource),
    };
  });
}

export async function listPortalDeliverables(
  user: SessionUser,
  organizationId: string,
  portalId: string,
) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    return tx.deliverable.findMany({
      where: { organizationId, portalId, archivedAt: null },
      include: { internalOwner: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  });
}

export async function getDeliverableInternal(
  user: SessionUser,
  organizationId: string,
  portalId: string,
  identifier: string,
) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const deliverable = await tx.deliverable.findFirst({
      where: { organizationId, portalId, identifier },
      include: {
        internalOwner: { select: { name: true, email: true } },
        versions: { orderBy: { version: "desc" } },
        sourceLinks: { include: { sourceObject: true } },
      },
    });
    if (!deliverable) return null;
    const availableSources = await tx.sourceObject.findMany({
      where: { organizationId, type: "ISSUE", archivedAt: null },
      orderBy: { title: "asc" },
      take: 50,
      select: { id: true, externalId: true, title: true, stateName: true },
    });
    return { deliverable, availableSources };
  });
}

/** Client-side: deliverables whose content has been frozen for review. */
export async function listClientDeliverables(
  user: SessionUser,
  portalSlug: string,
): Promise<{ identifier: string; title: string; status: string; version: number; targetDate: string | null }[] | null> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccessByUserId(tx, user.id, portalSlug);
    if (!access) return null;
    await setRlsContext(tx, { organizationId: access.organizationId });
    const deliverables = await tx.deliverable.findMany({
      where: {
        organizationId: access.organizationId,
        portalId: access.portalId,
        archivedAt: null,
        status: { in: CLIENT_VISIBLE_DELIVERABLE_STATUSES as DeliverableStatus[] },
        currentVersion: { gt: 0 },
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    });
    return deliverables
      .filter((d) => d.versions.length > 0)
      .map((d) => {
        const snapshot = d.versions[0]!.snapshot as unknown as DeliverableContent;
        return {
          identifier: snapshot.identifier,
          title: snapshot.title,
          status: d.status,
          version: d.versions[0]!.version,
          targetDate: snapshot.targetDate,
        };
      });
  });
}

/** Client-side detail rendered PURELY from the frozen version snapshot. */
export async function getClientDeliverable(
  user: SessionUser,
  portalSlug: string,
  identifier: string,
): Promise<{ content: DeliverableContent; status: string; version: number; frozenAt: Date } | null> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccessByUserId(tx, user.id, portalSlug);
    if (!access) return null;
    await setRlsContext(tx, { organizationId: access.organizationId });
    const deliverable = await tx.deliverable.findFirst({
      where: {
        organizationId: access.organizationId,
        portalId: access.portalId,
        identifier,
        archivedAt: null,
        status: { in: CLIENT_VISIBLE_DELIVERABLE_STATUSES as DeliverableStatus[] },
        currentVersion: { gt: 0 },
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!deliverable || deliverable.versions.length === 0) return null;
    const latest = deliverable.versions[0]!;
    return {
      content: latest.snapshot as unknown as DeliverableContent,
      status: deliverable.status,
      version: latest.version,
      frozenAt: latest.createdAt,
    };
  });
}
