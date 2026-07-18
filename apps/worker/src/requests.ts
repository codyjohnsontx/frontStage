import type { PrismaClient } from "@frontstage/database";
import type { Logger } from "@frontstage/observability";
import { authForConnection, linearAdapter } from "./sources.js";

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
