import type { PrismaClient } from "@frontstage/database";
import {
  contentHashForProject,
  contentHashForWorkItem,
  decryptToken,
  type CanonicalProject,
  type CanonicalWorkItem,
  type ConnectionAuth,
} from "@frontstage/integration-core";
import { createLinearAdapter } from "@frontstage/linear-adapter";
import type { Logger } from "@frontstage/observability";

export const linearAdapter = createLinearAdapter(
  process.env.LINEAR_WEBHOOK_SECRET
    ? { webhookSigningSecret: process.env.LINEAR_WEBHOOK_SECRET }
    : {},
);

export function authForConnection(connection: {
  mode: string;
  encryptedAccessToken: string | null;
}): ConnectionAuth {
  if (connection.mode === "fixture") return { mode: "fixture" };
  const key = process.env.INTEGRATION_TOKEN_KEY;
  if (!key) throw new Error("INTEGRATION_TOKEN_KEY is not set");
  if (!connection.encryptedAccessToken) throw new Error("Connection has no access token");
  return { mode: "oauth", accessToken: decryptToken(connection.encryptedAccessToken, key) };
}

interface UpsertResult {
  created: number;
  updated: number;
  flagged: number;
}

/**
 * Upsert one canonical work item into source_objects. On content change:
 * write a snapshot and flag linked external work items as diverged
 * (curated client content is NEVER overwritten — §6.2).
 */
export async function upsertIssueSource(
  prisma: PrismaClient,
  connection: { id: string; organizationId: string },
  item: CanonicalWorkItem,
  seenAt: Date,
  counts: UpsertResult,
): Promise<void> {
  const hash = contentHashForWorkItem(item);
  const existing = await prisma.sourceObject.findUnique({
    where: { connectionId_externalId: { connectionId: connection.id, externalId: item.id } },
  });

  if (!existing) {
    await prisma.sourceObject.create({
      data: {
        organizationId: connection.organizationId,
        connectionId: connection.id,
        provider: "LINEAR",
        externalId: item.id,
        type: "ISSUE",
        parentExternalId: item.projectId ?? null,
        title: item.title,
        stateType: item.stateType,
        stateName: item.stateName,
        data: item as unknown as object,
        contentHash: hash,
        lastSeenAt: seenAt,
        snapshots: { create: { data: item as unknown as object, contentHash: hash } },
      },
    });
    counts.created += 1;
    return;
  }

  if (existing.contentHash !== hash) {
    await prisma.sourceObject.update({
      where: { id: existing.id },
      data: {
        title: item.title,
        stateType: item.stateType,
        stateName: item.stateName,
        parentExternalId: item.projectId ?? null,
        data: item as unknown as object,
        contentHash: hash,
        archivedAt: item.archived ? (existing.archivedAt ?? seenAt) : null,
        lastSeenAt: seenAt,
        snapshots: { create: { data: item as unknown as object, contentHash: hash } },
      },
    });
    const flagged = await prisma.externalWorkItem.updateMany({
      where: { sourceObjectId: existing.id, curatedHash: { not: hash } },
      data: { sourceChanged: true, ...(item.archived ? { archivedFromSource: true } : {}) },
    });
    counts.updated += 1;
    counts.flagged += flagged.count;
    return;
  }

  await prisma.sourceObject.update({
    where: { id: existing.id },
    data: { lastSeenAt: seenAt },
  });
}

export async function upsertProjectSource(
  prisma: PrismaClient,
  connection: { id: string; organizationId: string },
  project: CanonicalProject,
  seenAt: Date,
  counts: UpsertResult,
): Promise<void> {
  const hash = contentHashForProject(project);
  const existing = await prisma.sourceObject.findUnique({
    where: { connectionId_externalId: { connectionId: connection.id, externalId: project.id } },
  });
  if (!existing) {
    await prisma.sourceObject.create({
      data: {
        organizationId: connection.organizationId,
        connectionId: connection.id,
        provider: "LINEAR",
        externalId: project.id,
        type: "PROJECT",
        title: project.name,
        stateType: null,
        stateName: project.state ?? null,
        data: project as unknown as object,
        contentHash: hash,
        lastSeenAt: seenAt,
        snapshots: { create: { data: project as unknown as object, contentHash: hash } },
      },
    });
    counts.created += 1;
  } else if (existing.contentHash !== hash) {
    await prisma.sourceObject.update({
      where: { id: existing.id },
      data: {
        title: project.name,
        stateName: project.state ?? null,
        data: project as unknown as object,
        contentHash: hash,
        lastSeenAt: seenAt,
        snapshots: { create: { data: project as unknown as object, contentHash: hash } },
      },
    });
    counts.updated += 1;
  } else {
    await prisma.sourceObject.update({ where: { id: existing.id }, data: { lastSeenAt: seenAt } });
  }
}

/**
 * Full sync + reconciliation for a connection: pull all projects and issues,
 * upsert, then archive sources the provider no longer returns. Serves both
 * "sync now" and the scheduled reconciliation sweep — webhooks are not the
 * only reliability mechanism (§39).
 */
export async function syncConnection(
  prisma: PrismaClient,
  log: Logger,
  connectionId: string,
): Promise<void> {
  const connection = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new Error(`Connection ${connectionId} not found`);

  const syncStart = new Date();
  try {
    const auth = authForConnection(connection);
    const [projects, issues] = [
      await linearAdapter.listProjects(auth),
      await linearAdapter.listWorkItems(auth),
    ];

    const counts = { created: 0, updated: 0, flagged: 0 };
    for (const project of projects) {
      await upsertProjectSource(prisma, connection, project, syncStart, counts);
    }
    for (const issue of issues) {
      await upsertIssueSource(prisma, connection, issue, syncStart, counts);
    }

    // Reconciliation: anything not seen this pass is archived at the source.
    const stale = await prisma.sourceObject.findMany({
      where: { connectionId: connection.id, lastSeenAt: { lt: syncStart }, archivedAt: null },
      select: { id: true },
    });
    for (const s of stale) {
      await prisma.sourceObject.update({
        where: { id: s.id },
        data: { archivedAt: syncStart },
      });
      await prisma.externalWorkItem.updateMany({
        where: { sourceObjectId: s.id },
        data: { archivedFromSource: true, sourceChanged: true },
      });
    }

    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: syncStart, status: "ACTIVE", lastError: null },
    });
    log.info("sync_completed", {
      connectionId: connection.id,
      organizationId: connection.organizationId,
      projects: projects.length,
      issues: issues.length,
      ...counts,
      archived: stale.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastError: message.slice(0, 1000) },
    });
    throw err;
  }
}

/**
 * Process one persisted webhook event. Simulated (fixture) deliveries carry
 * the canonical work item in the payload; real deliveries are re-fetched
 * from the provider so we never trust webhook bodies as source of truth.
 */
export async function processWebhookEvent(
  prisma: PrismaClient,
  log: Logger,
  webhookEventId: string,
): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) throw new Error(`Webhook event ${webhookEventId} not found`);
  if (event.status === "PROCESSED") return;

  try {
    const payload = event.payload as {
      simulated?: boolean;
      connectionId?: string;
      workItem?: CanonicalWorkItem;
      organizationId?: string;
      data?: { id?: string };
    };

    const counts = { created: 0, updated: 0, flagged: 0 };
    if (payload.simulated && payload.connectionId && payload.workItem) {
      const connection = await prisma.integrationConnection.findUnique({
        where: { id: payload.connectionId },
      });
      if (!connection) throw new Error("Connection for simulated event not found");
      await upsertIssueSource(prisma, connection, payload.workItem, new Date(), counts);
    } else {
      // Real delivery: resolve the connection by Linear workspace id and
      // re-fetch current state from the API.
      if (!payload.organizationId) throw new Error("Webhook payload has no workspace id");
      const connection = await prisma.integrationConnection.findFirst({
        where: { provider: "LINEAR", workspaceId: payload.organizationId },
      });
      if (!connection) throw new Error("No connection matches webhook workspace");
      const externalId = payload.data?.id;
      if (!externalId) throw new Error("Webhook payload has no object id");
      const item = await linearAdapter.getWorkItem(authForConnection(connection), externalId);
      if (item) {
        await upsertIssueSource(prisma, connection, item, new Date(), counts);
      }
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    log.info("webhook_processed", { webhookEventId, eventType: event.eventType, ...counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", lastError: message.slice(0, 1000) },
    });
    throw err;
  }
}
