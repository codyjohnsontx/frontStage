import type { PrismaClient } from "@frontstage/database";
import type { Logger } from "@frontstage/observability";
import { authForConnection, linearAdapter } from "./sources.js";

const KIND_PREFIX: Record<string, string> = {
  PUBLIC_REPLY: "Reply to client",
  CLARIFICATION_REQUEST: "Clarification requested from client",
  CLIENT_MESSAGE: "Client message",
};

/**
 * Forward a client-visible request message to the linked Linear issue as a
 * comment (§28 default routing for client requests). Internal notes never
 * reach this handler — they get no outbox event. Retries cover the race
 * where the message lands before the issue-creation job has run.
 */
export async function processAddLinearComment(
  prisma: PrismaClient,
  log: Logger,
  messageId: string,
): Promise<void> {
  const message = await prisma.requestMessage.findUnique({
    where: { id: messageId },
    include: {
      request: true,
      author: { select: { name: true, email: true } },
    },
  });
  if (!message) throw new Error(`Request message ${messageId} not found`);
  if (message.kind === "INTERNAL_NOTE") return; // defense in depth
  if (message.linearCommentId) return; // idempotent

  const request = message.request;
  if (!request.linearIssueId) {
    if (request.linearSyncState === "FAILED") {
      // The issue will never exist; park the comment visibly.
      await prisma.requestMessage.update({
        where: { id: message.id },
        data: { linearSyncState: "FAILED" },
      });
      log.error("request_comment_no_issue", { messageId, requestId: request.id });
      return;
    }
    // Issue creation may simply not have run yet — retry with backoff.
    throw new Error(`Request ${request.identifier} has no Linear issue yet; retrying comment`);
  }

  const connection = await prisma.integrationConnection.findFirst({
    where: { organizationId: request.organizationId, provider: "LINEAR", status: { not: "DISCONNECTED" } },
  });
  if (!connection) {
    await prisma.requestMessage.update({
      where: { id: message.id },
      data: { linearSyncState: "FAILED" },
    });
    log.error("request_comment_no_connection", { messageId, requestId: request.id });
    return;
  }

  const prefix = KIND_PREFIX[message.kind] ?? "Message";
  const created = await linearAdapter.addComment(authForConnection(connection), {
    workItemId: request.linearIssueId,
    body: [
      `**${prefix}** — ${message.author.name ?? message.author.email} via Frontstage (${request.identifier})`,
      "",
      message.body,
    ].join("\n"),
  });
  await prisma.requestMessage.update({
    where: { id: message.id },
    data: { linearSyncState: "SYNCED", linearCommentId: created.id },
  });
  log.info("request_comment_forwarded", {
    messageId,
    requestId: request.id,
    linearCommentId: created.id,
  });
}

/**
 * Create the Linear Triage issue for a submitted client request (§27).
 * The Frontstage request is already committed — this side effect retries
 * via the job queue and its state is visible internally, never to clients.
 * Idempotent: a request that already has a linearIssueId is left alone.
 */
export async function processCreateLinearIssue(
  prisma: PrismaClient,
  log: Logger,
  requestId: string,
): Promise<void> {
  const request = await prisma.clientRequest.findUnique({
    where: { id: requestId },
    include: { createdBy: { select: { name: true, email: true } } },
  });
  if (!request) throw new Error(`Client request ${requestId} not found`);
  if (request.linearIssueId) return;

  const connection = await prisma.integrationConnection.findFirst({
    where: { organizationId: request.organizationId, provider: "LINEAR", status: { not: "DISCONNECTED" } },
  });
  if (!connection) {
    // No connection will ever succeed — park visibly instead of retrying.
    await prisma.clientRequest.update({
      where: { id: request.id },
      data: {
        linearSyncState: "FAILED",
        linearSyncError: "No active Linear connection for this organization",
      },
    });
    log.error("request_sync_no_connection", {
      requestId: request.id,
      organizationId: request.organizationId,
    });
    return;
  }

  // Configuration errors do not self-heal — park visibly instead of
  // burning retries. Fixture mode needs no destination team.
  if (connection.mode !== "fixture" && !connection.defaultTeamId) {
    await prisma.clientRequest.update({
      where: { id: request.id },
      data: {
        linearSyncState: "FAILED",
        linearSyncError:
          "Linear connection has no destination team configured (defaultTeamId) for issue creation",
      },
    });
    log.error("request_sync_no_default_team", {
      requestId: request.id,
      connectionId: connection.id,
    });
    return;
  }

  try {
    const created = await linearAdapter.createWorkItem(authForConnection(connection), {
      ...(connection.defaultTeamId ? { teamId: connection.defaultTeamId } : {}),
      title: `[${request.identifier}] ${request.title}`,
      description: [
        request.description,
        "",
        "---",
        `Submitted via Frontstage by ${request.createdBy.name ?? request.createdBy.email} (${request.identifier}, ${request.type.toLowerCase()}, client priority: ${request.clientPriority.toLowerCase()}).`,
      ].join("\n"),
    });
    await prisma.clientRequest.update({
      where: { id: request.id },
      data: {
        linearIssueId: created.id,
        linearIssueIdentifier: created.identifier ?? null,
        linearSyncState: "SYNCED",
        linearSyncError: null,
      },
    });
    log.info("request_linear_issue_created", {
      requestId: request.id,
      identifier: request.identifier,
      linearIssue: created.identifier ?? created.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.clientRequest.update({
      where: { id: request.id },
      data: { linearSyncError: message.slice(0, 1000) },
    });
    // Rethrow so the job retries with backoff; state stays PENDING and the
    // failure is visible internally.
    throw err;
  }
}
