import {
  getPrisma,
  setRlsContext,
  withRlsContext,
  type RequestMessageKind,
  type TransactionClient,
} from "@frontstage/database";
import { ROLE_PERMISSIONS } from "@frontstage/authorization";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { enqueueOutboxEvent } from "@/server/outbox";
import { resolveAccessByUserId } from "@/server/client-portal";
import { REQUEST_STATUS_LABELS } from "@/lib/request-labels";

const log = createLogger({ component: "web.request-communication" });

function validBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 5000) {
    throw new ValidationError("Message must be between 1 and 5000 characters.");
  }
  return trimmed;
}

/** Forward a client-visible message to Linear + notify the client by email. */
async function fanOutClientVisibleMessage(
  tx: TransactionClient,
  input: {
    organizationId: string;
    messageId: string;
    requestIdentifier: string;
    requestTitle: string;
    creatorEmail: string | null;
    notifySubject: string | null;
    notifyBody: string | null;
    correlationId: string;
  },
): Promise<void> {
  await enqueueOutboxEvent(tx, {
    organizationId: input.organizationId,
    eventType: "request.message.created",
    correlationId: input.correlationId,
    payload: { messageId: input.messageId },
  });
  if (input.creatorEmail && input.notifySubject && input.notifyBody) {
    await enqueueOutboxEvent(tx, {
      organizationId: input.organizationId,
      eventType: "notify.request_update",
      correlationId: input.correlationId,
      payload: {
        to: input.creatorEmail,
        subject: input.notifySubject,
        body: input.notifyBody,
      },
    });
  }
}

/**
 * Internal responses (§27): public reply, internal note, or request for
 * clarification. Internal notes are stored on the same thread but are
 * structurally unreachable by client roles and never forwarded to email or
 * Linear.
 */
export async function addInternalMessage(
  user: SessionUser,
  organizationId: string,
  requestId: string,
  kind: Extract<RequestMessageKind, "PUBLIC_REPLY" | "INTERNAL_NOTE" | "CLARIFICATION_REQUEST">,
  body: string,
): Promise<void> {
  const trimmed = validBody(body);
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const request = await tx.clientRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { createdBy: { select: { email: true } } },
    });
    if (!request) throw new ValidationError("Request not found.");

    const resource = { organizationId, portalId: request.portalId };
    assertPermission(context, kind === "INTERNAL_NOTE" ? "comment.internal.create" : "comment.create", resource);

    const message = await tx.requestMessage.create({
      data: {
        organizationId,
        requestId: request.id,
        kind,
        body: trimmed,
        authorId: user.id,
        // Internal notes never sync anywhere.
        ...(kind === "INTERNAL_NOTE" ? { linearSyncState: "SYNCED" as const } : {}),
      },
    });
    if (request.status === "RECEIVED" && kind !== "INTERNAL_NOTE") {
      await tx.clientRequest.update({
        where: { id: request.id },
        data: { status: "IN_REVIEW" },
      });
    }
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: `request.message.${kind.toLowerCase()}`,
      resourceType: "request_message",
      resourceId: message.id,
      correlationId,
      metadata: { requestIdentifier: request.identifier, kind },
    });

    if (kind !== "INTERNAL_NOTE") {
      const label = kind === "CLARIFICATION_REQUEST" ? "needs clarification from you" : "has a new reply";
      await fanOutClientVisibleMessage(tx, {
        organizationId,
        messageId: message.id,
        requestIdentifier: request.identifier,
        requestTitle: request.title,
        creatorEmail: request.createdBy.email,
        notifySubject: `${request.identifier} ${label}: ${request.title}`,
        notifyBody: [
          `Your request ${request.identifier} ("${request.title}") ${label}.`,
          "",
          trimmed,
          "",
          "Sign in to your Frontstage portal to respond.",
        ].join("\n"),
        correlationId,
      });
    }
    log.info("request_message_added", {
      organizationId,
      requestId: request.id,
      kind,
      correlationId,
    });
  });
}

/** Formal accept / decline (§27). Decline requires a reason. */
export async function decideRequest(
  user: SessionUser,
  organizationId: string,
  requestId: string,
  decision: "ACCEPTED" | "DECLINED",
  reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (decision === "DECLINED" && trimmedReason.length < 3) {
    throw new ValidationError("Declining a request requires a reason the client will see.");
  }
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const request = await tx.clientRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { createdBy: { select: { email: true } } },
    });
    if (!request) throw new ValidationError("Request not found.");
    if (request.status !== "RECEIVED" && request.status !== "IN_REVIEW") {
      throw new ValidationError(`This request was already ${request.status.toLowerCase()}.`);
    }
    assertPermission(context, "request.triage", { organizationId, portalId: request.portalId });

    await tx.clientRequest.update({
      where: { id: request.id },
      data: {
        status: decision,
        decisionReason: trimmedReason || null,
        decidedById: user.id,
        decidedAt: new Date(),
      },
    });
    const verb = decision === "ACCEPTED" ? "accepted" : "declined";
    const message = await tx.requestMessage.create({
      data: {
        organizationId,
        requestId: request.id,
        kind: "PUBLIC_REPLY",
        body: trimmedReason
          ? `This request was ${verb}: ${trimmedReason}`
          : `This request was ${verb}.`,
        authorId: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: `request.${verb}`,
      resourceType: "client_request",
      resourceId: request.id,
      correlationId,
      metadata: { identifier: request.identifier, reason: trimmedReason },
    });
    await fanOutClientVisibleMessage(tx, {
      organizationId,
      messageId: message.id,
      requestIdentifier: request.identifier,
      requestTitle: request.title,
      creatorEmail: request.createdBy.email,
      notifySubject: `${request.identifier} was ${verb}: ${request.title}`,
      notifyBody: [
        `Your request ${request.identifier} ("${request.title}") was ${verb}.`,
        trimmedReason ? `\nReason: ${trimmedReason}` : "",
        "",
        "Sign in to your Frontstage portal for details.",
      ].join("\n"),
      correlationId,
    });
  });
}

/** Close as a duplicate of another request on the same portal (§27). */
export async function closeAsDuplicate(
  user: SessionUser,
  organizationId: string,
  requestId: string,
  duplicateOfIdentifier: string,
): Promise<void> {
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const request = await tx.clientRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { createdBy: { select: { email: true } } },
    });
    if (!request) throw new ValidationError("Request not found.");
    if (request.status === "CLOSED") throw new ValidationError("This request is already closed.");
    assertPermission(context, "request.triage", { organizationId, portalId: request.portalId });

    const target = await tx.clientRequest.findFirst({
      where: { organizationId, portalId: request.portalId, identifier: duplicateOfIdentifier },
    });
    if (!target || target.id === request.id) {
      throw new ValidationError("Pick another request on this portal as the duplicate target.");
    }

    await tx.clientRequest.update({
      where: { id: request.id },
      data: { status: "CLOSED", duplicateOfRequestId: target.id },
    });
    const message = await tx.requestMessage.create({
      data: {
        organizationId,
        requestId: request.id,
        kind: "PUBLIC_REPLY",
        body: `This request was closed as a duplicate of ${target.identifier} ("${target.title}"). Updates will continue there.`,
        authorId: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "request.closed_duplicate",
      resourceType: "client_request",
      resourceId: request.id,
      correlationId,
      metadata: { identifier: request.identifier, duplicateOf: target.identifier },
    });
    await fanOutClientVisibleMessage(tx, {
      organizationId,
      messageId: message.id,
      requestIdentifier: request.identifier,
      requestTitle: request.title,
      creatorEmail: request.createdBy.email,
      notifySubject: `${request.identifier} was merged into ${target.identifier}`,
      notifyBody: `Your request ${request.identifier} ("${request.title}") was closed as a duplicate of ${target.identifier}. Updates will continue on ${target.identifier}.`,
      correlationId,
    });
  });
}

/** Link the request to an existing Linear issue instead of the created one (§27). */
export async function linkLinearIssue(
  user: SessionUser,
  organizationId: string,
  requestId: string,
  externalId: string,
  externalIdentifier: string,
): Promise<void> {
  const id = externalId.trim();
  const identifier = externalIdentifier.trim();
  if (!id) throw new ValidationError("Enter the Linear issue id.");
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const request = await tx.clientRequest.findFirst({ where: { id: requestId, organizationId } });
    if (!request) throw new ValidationError("Request not found.");
    assertPermission(context, "request.triage", { organizationId, portalId: request.portalId });

    await tx.clientRequest.update({
      where: { id: request.id },
      data: {
        linearIssueId: id,
        linearIssueIdentifier: identifier || null,
        linearSyncState: "SYNCED",
        linearSyncError: null,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "request.linear_issue_linked",
      resourceType: "client_request",
      resourceId: request.id,
      correlationId,
      metadata: { identifier: request.identifier, linearIssue: identifier || id },
    });
  });
}

/** Client reply on their own request thread (comment.create roles). */
export async function addClientMessage(
  user: SessionUser,
  portalSlug: string,
  requestIdentifier: string,
  body: string,
): Promise<void> {
  const trimmed = validBody(body);
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccessByUserId(tx, user.id, portalSlug);
    if (!access) throw new ValidationError("You do not have access to this portal.");
    if (!ROLE_PERMISSIONS[access.roleKey].includes("comment.create")) {
      throw new ValidationError("Your role cannot reply on this portal.");
    }

    await setRlsContext(tx, { organizationId: access.organizationId });
    const request = await tx.clientRequest.findFirst({
      where: {
        organizationId: access.organizationId,
        portalId: access.portalId,
        identifier: requestIdentifier,
      },
    });
    if (!request) throw new ValidationError("Request not found.");

    const message = await tx.requestMessage.create({
      data: {
        organizationId: access.organizationId,
        requestId: request.id,
        kind: "CLIENT_MESSAGE",
        body: trimmed,
        authorId: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId: access.organizationId,
      actorUserId: user.id,
      action: "request.message.client_message",
      resourceType: "request_message",
      resourceId: message.id,
      correlationId,
      metadata: { requestIdentifier: request.identifier },
    });
    // Forward to the linked Linear issue; no self-notification email.
    await enqueueOutboxEvent(tx, {
      organizationId: access.organizationId,
      eventType: "request.message.created",
      correlationId,
      payload: { messageId: message.id },
    });
  });
}

/** Full internal thread + triage context for the detail page. */
export async function getRequestThreadInternal(
  user: SessionUser,
  organizationId: string,
  portalId: string,
  requestIdentifier: string,
) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const request = await tx.clientRequest.findFirst({
      where: { organizationId, portalId, identifier: requestIdentifier },
      include: {
        createdBy: { select: { name: true, email: true } },
        duplicateOf: { select: { identifier: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { name: true, email: true } } },
        },
      },
    });
    if (!request) return null;
    const others = await tx.clientRequest.findMany({
      where: { organizationId, portalId, id: { not: request.id }, status: { not: "CLOSED" } },
      select: { identifier: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    return { request, otherRequests: others, statusLabel: REQUEST_STATUS_LABELS[request.status] ?? request.status };
  });
}
