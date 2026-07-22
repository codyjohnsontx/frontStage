import {
  getPrisma,
  setRlsContext,
  withRlsContext,
  type DeliverableStatus,
} from "@frontstage/database";
import { createHash, randomUUID } from "node:crypto";
import { hasPermission } from "@frontstage/authorization";
import { attachmentKey } from "@frontstage/storage";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import { getStorage } from "@/server/storage";
import { enqueueOutboxEvent } from "@/server/outbox";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { resolveAccessByUserId } from "@/server/client-portal";
import {
  CLIENT_VISIBLE_DELIVERABLE_STATUSES,
  deliverableContent,
  materialContentHash,
  type AttachmentRef,
  type DeliverableContent,
} from "@/server/deliverable-view";

/** Upload constraints (§33 validation). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Allowlist by BYTES, not by the browser-supplied type. Text formats
 * (text/plain, text/csv) have no magic bytes, so they are accepted only
 * when sniffing finds no binary signature AND the content decodes as UTF-8
 * without control bytes — a renamed .exe cannot pass as .txt.
 */
export const ALLOWED_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/csv",
  "application/zip",
];

const SNIFFABLE_ALLOWED: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/zip",
];

function looksLikePlainText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 8192);
  // Reject NUL and most C0 control bytes (tab/LF/CR are fine).
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective content type from the file's actual bytes.
 * Throws ValidationError when the bytes are not an allowed type or
 * contradict a declared binary type.
 */
export async function resolveAttachmentType(bytes: Buffer, declaredType: string): Promise<string> {
  const { fileTypeFromBuffer } = await import("file-type");
  const sniffed = await fileTypeFromBuffer(bytes);

  if (sniffed) {
    if (!SNIFFABLE_ALLOWED.includes(sniffed.mime)) {
      throw new ValidationError(
        `File content is ${sniffed.mime}, which is not allowed (pdf, png, jpeg, txt, csv, zip).`,
      );
    }
    // A declared binary type must agree with the bytes.
    if (declaredType && SNIFFABLE_ALLOWED.includes(declaredType) && declaredType !== sniffed.mime) {
      throw new ValidationError(
        `File contents (${sniffed.mime}) do not match the declared type (${declaredType}).`,
      );
    }
    return sniffed.mime;
  }

  // No signature: only text is acceptable.
  if (!looksLikePlainText(bytes)) {
    throw new ValidationError("File type could not be identified and is not allowed.");
  }
  return declaredType === "text/csv" ? "text/csv" : "text/plain";
}

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

    // Freezing embeds the exact published files; unscanned or blocked files
    // must be resolved first (§33 scan gate).
    let attachmentRefs: AttachmentRef[] = [];
    if (freezes) {
      const attachments = await tx.deliverableAttachment.findMany({
        where: { organizationId, deliverableId: deliverable.id },
      });
      if (attachments.some((a) => a.scanStatus === "PENDING")) {
        throw new ValidationError("File scans are still running. Try again in a moment.");
      }
      const blocked = attachments.filter((a) => a.scanStatus === "BLOCKED");
      if (blocked.length > 0) {
        throw new ValidationError(
          `Remove blocked file(s) before sharing: ${blocked.map((a) => a.fileName).join(", ")}.`,
        );
      }
      attachmentRefs = attachments.map((a) => ({
        attachmentId: a.id,
        fileName: a.fileName,
        sha256: a.sha256,
      }));
    }

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
      const content = deliverableContent(deliverable, attachmentRefs);
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

/**
 * Upload a file onto an editable deliverable (§33): validate size + MIME,
 * hash, copy to tenant-scoped object storage, record the row, then scan
 * asynchronously through the outbox. Files are never client-reachable until
 * they are CLEAN and embedded in a frozen version.
 */
export async function uploadDeliverableAttachment(
  user: SessionUser,
  organizationId: string,
  deliverableId: string,
  file: { name: string; type: string; bytes: Buffer },
): Promise<void> {
  const fileName = file.name.trim().slice(0, 200);
  if (!fileName) throw new ValidationError("The file needs a name.");
  if (file.bytes.length === 0) throw new ValidationError("The file is empty.");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Files are limited to 10 MB for the pilot.");
  }
  // Trust the bytes, not the browser-supplied type.
  const contentType = await resolveAttachmentType(file.bytes, file.type);
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const attachmentId = randomUUID();
  const correlationId = newCorrelationId();

  // Upload to storage BEFORE the DB transaction: an orphaned object on
  // rollback is harmless; a DB row without bytes is not.
  let storageKey = "";
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
      throw new ValidationError("Files can only change while the deliverable is editable.");
    }
    storageKey = attachmentKey({ organizationId, portalId: deliverable.portalId, attachmentId });
  });

  await getStorage().put(storageKey, file.bytes, contentType);

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const deliverable = await tx.deliverable.findFirst({
      where: { id: deliverableId, organizationId },
    });
    if (!deliverable || !isEditableStatus(deliverable.status)) {
      throw new ValidationError("This deliverable changed state during upload. Try again.");
    }
    await tx.deliverableAttachment.create({
      data: {
        id: attachmentId,
        organizationId,
        deliverableId,
        fileName,
        mimeType: contentType,
        sizeBytes: file.bytes.length,
        sha256,
        storageKey,
        uploadedById: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "deliverable.attachment_uploaded",
      resourceType: "deliverable_attachment",
      resourceId: attachmentId,
      correlationId,
      metadata: { identifier: deliverable.identifier, fileName, sha256, sizeBytes: file.bytes.length },
    });
    await enqueueOutboxEvent(tx, {
      organizationId,
      eventType: "attachment.uploaded",
      correlationId,
      payload: { attachmentId },
    });
  });
  log.info("attachment_uploaded", { organizationId, attachmentId, correlationId });
}

export async function deleteDeliverableAttachment(
  user: SessionUser,
  organizationId: string,
  attachmentId: string,
): Promise<void> {
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const attachment = await tx.deliverableAttachment.findFirst({
      where: { id: attachmentId, organizationId },
      include: { deliverable: true },
    });
    if (!attachment) throw new ValidationError("Attachment not found.");
    assertPermission(context, "deliverable.edit", {
      organizationId,
      portalId: attachment.deliverable.portalId,
    });
    if (!isEditableStatus(attachment.deliverable.status)) {
      throw new ValidationError("Files can only change while the deliverable is editable.");
    }
    // Row goes; the stored object stays for frozen-version history (§34 —
    // published bytes referenced by an earlier version must remain
    // downloadable). Orphan cleanup is a retention concern, not deletion.
    await tx.deliverableAttachment.delete({ where: { id: attachment.id } });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "deliverable.attachment_removed",
      resourceType: "deliverable_attachment",
      resourceId: attachment.id,
      correlationId,
      metadata: { identifier: attachment.deliverable.identifier, fileName: attachment.fileName },
    });
  });
}

/**
 * Internal download: the attachment must belong to the deliverable named in
 * the route, the caller must hold deliverable.edit on THAT portal, and the
 * file must be CLEAN. Membership alone is not enough — otherwise any member
 * could fetch any portal's file by id.
 */
export async function getInternalAttachmentUrl(
  user: SessionUser,
  organizationId: string,
  portalId: string,
  deliverableIdentifier: string,
  attachmentId: string,
): Promise<string | null> {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) return null;
    if (!hasPermission(context, "deliverable.edit", { organizationId, portalId })) return null;

    const attachment = await tx.deliverableAttachment.findFirst({
      where: {
        id: attachmentId,
        organizationId,
        scanStatus: "CLEAN",
        deliverable: { portalId, identifier: deliverableIdentifier },
      },
    });
    if (!attachment) return null;
    return getStorage().signedDownloadUrl(attachment.storageKey, {
      fileName: attachment.fileName,
    });
  });
}

/**
 * Client download: portal membership + the attachment must be embedded in
 * the LATEST frozen version of a client-visible deliverable + CLEAN scan.
 * A file uploaded after the freeze is not client-reachable until re-frozen.
 */
export async function getClientAttachmentUrl(
  user: SessionUser,
  portalSlug: string,
  deliverableIdentifier: string,
  attachmentId: string,
): Promise<string | null> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccessByUserId(tx, user.id, portalSlug);
    if (!access) return null;
    await setRlsContext(tx, { organizationId: access.organizationId });
    const deliverable = await tx.deliverable.findFirst({
      where: {
        organizationId: access.organizationId,
        portalId: access.portalId,
        identifier: deliverableIdentifier,
        archivedAt: null,
        status: { in: CLIENT_VISIBLE_DELIVERABLE_STATUSES as DeliverableStatus[] },
        currentVersion: { gt: 0 },
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!deliverable || deliverable.versions.length === 0) return null;
    const snapshot = deliverable.versions[0]!.snapshot as unknown as DeliverableContent;
    if (!snapshot.attachments?.some((a) => a.attachmentId === attachmentId)) return null;

    const attachment = await tx.deliverableAttachment.findFirst({
      where: { id: attachmentId, organizationId: access.organizationId, scanStatus: "CLEAN" },
    });
    if (!attachment) return null;
    return getStorage().signedDownloadUrl(attachment.storageKey, {
      fileName: attachment.fileName,
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
        attachments: { orderBy: { createdAt: "asc" } },
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
