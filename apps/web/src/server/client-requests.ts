import { createHash } from "node:crypto";
import {
  getPrisma,
  setRlsContext,
  withRlsContext,
  type ClientPriority,
  type RequestType,
} from "@frontstage/database";
import { ROLE_PERMISSIONS } from "@frontstage/authorization";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { enqueueOutboxEvent } from "@/server/outbox";
import { resolveAccessByUserId } from "@/server/client-portal";
import { requestClientView, type ClientRequestView } from "@/server/request-view";

const log = createLogger({ component: "web.client-requests" });

const REQUEST_TYPES: readonly RequestType[] = [
  "FEATURE",
  "BUG",
  "CHANGE",
  "QUESTION",
  "SUPPORT",
  "OTHER",
];
const PRIORITIES: readonly ClientPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

export interface SubmitRequestInput {
  type: string;
  title: string;
  description: string;
  clientPriority: string;
  idempotencyKey: string;
}

/**
 * Client request submission (§27). The request is recorded in Frontstage
 * immediately (it cannot be lost); the Linear Triage issue is created
 * asynchronously through the outbox. Duplicate submissions with the same
 * idempotency key return the original identifier.
 */
export async function submitClientRequest(
  user: SessionUser,
  portalSlug: string,
  input: SubmitRequestInput,
): Promise<string> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 3 || title.length > 140) {
    throw new ValidationError("Title must be between 3 and 140 characters.");
  }
  if (description.length < 1 || description.length > 5000) {
    throw new ValidationError("Description must be between 1 and 5000 characters.");
  }
  if (!(REQUEST_TYPES as readonly string[]).includes(input.type)) {
    throw new ValidationError("Unknown request type.");
  }
  if (!(PRIORITIES as readonly string[]).includes(input.clientPriority)) {
    throw new ValidationError("Unknown priority.");
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.idempotencyKey)) {
    throw new ValidationError("Invalid idempotency key.");
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ type: input.type, title, description, p: input.clientPriority }))
    .digest("hex");
  const correlationId = newCorrelationId();

  // Concurrent submissions with the same idempotency key race to insert the
  // idempotency record; the loser's transaction rolls back with P2002 and a
  // retry finds the winner's record, returning the original identifier.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await submitOnce(user, portalSlug, { ...input, title, description }, requestHash, correlationId);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002" && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function submitOnce(
  user: SessionUser,
  portalSlug: string,
  input: SubmitRequestInput,
  requestHash: string,
  correlationId: string,
): Promise<string> {
  const title = input.title;
  const description = input.description;
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccessByUserId(tx, user.id, portalSlug);
    if (!access) throw new ValidationError("You do not have access to this portal.");
    if (!ROLE_PERMISSIONS[access.roleKey].includes("request.submit")) {
      throw new ValidationError("Your role cannot submit requests on this portal.");
    }

    await setRlsContext(tx, { organizationId: access.organizationId });

    // Idempotency: same key + same content returns the original result;
    // same key + different content is rejected (§44).
    const operation = "request.submit";
    const existing = await tx.idempotencyRecord.findUnique({
      where: {
        organizationId_operation_key: {
          organizationId: access.organizationId,
          operation,
          key: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ValidationError("This form was already submitted with different content.");
      }
      return existing.resultId ?? "";
    }

    const client = await tx.clientOrganization.update({
      where: { id: access.clientOrganizationId },
      data: { nextRequestNumber: { increment: 1 } },
    });
    const number = client.nextRequestNumber - 1;
    const identifier = `${client.identifierPrefix}-REQ-${String(number).padStart(3, "0")}`;

    const request = await tx.clientRequest.create({
      data: {
        organizationId: access.organizationId,
        portalId: access.portalId,
        identifier,
        type: input.type as RequestType,
        title,
        description,
        clientPriority: input.clientPriority as ClientPriority,
        createdById: user.id,
      },
    });
    await recordAuditEvent(tx, {
      organizationId: access.organizationId,
      actorUserId: user.id,
      action: "request.submitted",
      resourceType: "client_request",
      resourceId: request.id,
      correlationId,
      metadata: { identifier, type: input.type, portalId: access.portalId },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: access.organizationId,
      eventType: "request.created",
      correlationId,
      payload: { requestId: request.id, organizationId: access.organizationId },
    });
    await tx.idempotencyRecord.create({
      data: {
        organizationId: access.organizationId,
        actorUserId: user.id,
        operation,
        key: input.idempotencyKey,
        requestHash,
        resultType: "client_request",
        resultId: identifier,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    log.info("client_request_submitted", {
      organizationId: access.organizationId,
      identifier,
      correlationId,
    });
    return identifier;
  });
}

/** Client-safe request list for a portal (leak boundary applied). */
export async function listClientRequests(
  user: SessionUser,
  portalSlug: string,
): Promise<{ requests: ClientRequestView[]; canSubmit: boolean } | null> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccessByUserId(tx, user.id, portalSlug);
    if (!access) return null;
    await setRlsContext(tx, { organizationId: access.organizationId });
    const requests = await tx.clientRequest.findMany({
      where: { organizationId: access.organizationId, portalId: access.portalId },
      orderBy: { createdAt: "desc" },
    });
    return {
      requests: requests.map(requestClientView),
      canSubmit: ROLE_PERMISSIONS[access.roleKey].includes("request.submit"),
    };
  });
}

/** Client-safe request detail. */
export async function getClientRequest(
  user: SessionUser,
  portalSlug: string,
  identifier: string,
): Promise<ClientRequestView | null> {
  return withRlsContext(getPrisma(), { userId: user.id }, async (tx) => {
    const access = await resolveAccessByUserId(tx, user.id, portalSlug);
    if (!access) return null;
    await setRlsContext(tx, { organizationId: access.organizationId });
    const request = await tx.clientRequest.findFirst({
      where: { organizationId: access.organizationId, portalId: access.portalId, identifier },
    });
    return request ? requestClientView(request) : null;
  });
}

/** Internal view: full rows including triage fields (membership-gated). */
export async function listPortalRequestsInternal(
  user: SessionUser,
  organizationId: string,
  portalId: string,
) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    return tx.clientRequest.findMany({
      where: { organizationId, portalId },
      include: { createdBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
  });
}

/** Internal delivery priority — separate from client urgency (§27). */
export async function setInternalPriority(
  user: SessionUser,
  organizationId: string,
  requestId: string,
  internalPriority: string,
): Promise<void> {
  if (!(PRIORITIES as readonly string[]).includes(internalPriority)) {
    throw new ValidationError("Unknown priority.");
  }
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const request = await tx.clientRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new ValidationError("Request not found.");
    assertPermission(context, "request.triage", { organizationId, portalId: request.portalId });

    await tx.clientRequest.update({
      where: { id: request.id },
      data: { internalPriority: internalPriority as ClientPriority },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "request.internal_priority_set",
      resourceType: "client_request",
      resourceId: request.id,
      correlationId,
      metadata: { identifier: request.identifier, internalPriority },
    });
  });
}
