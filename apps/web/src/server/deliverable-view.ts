import { createHash } from "node:crypto";

/**
 * Deliverable content that is frozen into an immutable version and shown to
 * clients. This is the leak boundary for deliverables: internal owner ids,
 * source links, and lifecycle bookkeeping are absent from the type, so they
 * cannot reach a client page or a version snapshot.
 */
/** A published file reference frozen into a version (§26 material field). */
export interface AttachmentRef {
  attachmentId: string;
  fileName: string;
  sha256: string;
}

export interface DeliverableContent {
  identifier: string;
  title: string;
  description: string;
  scope: string;
  acceptanceCriteria: string;
  targetDate: string | null;
  attachments: AttachmentRef[];
}

export interface InternalDeliverableData {
  identifier: string;
  title: string;
  description: string;
  scope: string;
  acceptanceCriteria: string;
  targetDate: Date | null;
  // Internal-only — deliberately absent from DeliverableContent.
  internalOwnerId?: string;
  internalOwnerName?: string | null;
  createdById?: string;
  sourceLinkCount?: number;
}

export function deliverableContent(
  d: InternalDeliverableData,
  attachments: AttachmentRef[] = [],
): DeliverableContent {
  return {
    identifier: d.identifier,
    title: d.title,
    description: d.description,
    scope: d.scope,
    acceptanceCriteria: d.acceptanceCriteria,
    targetDate: d.targetDate ? d.targetDate.toISOString().slice(0, 10) : null,
    // Deterministic order so snapshots and hashes are stable.
    attachments: [...attachments].sort((a, b) => a.attachmentId.localeCompare(b.attachmentId)),
  };
}

/**
 * Hash over the MATERIAL fields (§26 defaults: scope, acceptance criteria,
 * client-facing description, published files). Title and target date are
 * tracked in the snapshot but are not material by default — Phase 3.4 makes
 * the material field set configurable and drives reapproval from this hash.
 */
export function materialContentHash(content: DeliverableContent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        description: content.description,
        scope: content.scope,
        acceptanceCriteria: content.acceptanceCriteria,
        files: content.attachments.map((a) => a.sha256).sort(),
      }),
    )
    .digest("hex");
}

/** Client-facing lifecycle labels (§25 keeps Approved and Delivered apart). */
export const DELIVERABLE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  READY_FOR_REVIEW: "Ready for Your Review",
  CHANGES_REQUESTED: "Changes Requested",
  APPROVED: "Approved",
  DELIVERED: "Delivered",
  ARCHIVED: "Archived",
};

/** Statuses whose content clients may see (frozen versions exist by then). */
export const CLIENT_VISIBLE_DELIVERABLE_STATUSES: readonly string[] = [
  "READY_FOR_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "DELIVERED",
];
