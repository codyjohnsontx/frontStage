import { randomUUID } from "node:crypto";
import { getPrisma, withRlsContext } from "@frontstage/database";
import { encryptToken } from "@frontstage/integration-core";
import { buildAuthorizeUrl, exchangeCodeForToken, fetchViewerWorkspace, FIXTURE_WORKSPACE } from "@frontstage/linear-adapter";
import { createLogger, newCorrelationId } from "@frontstage/observability";
import type { SessionUser } from "@/server/session";
import { ValidationError } from "@/server/errors";
import { assertPermission, loadAuthorizationContext } from "@/server/authz";
import { recordAuditEvent } from "@/server/audit";
import { enqueueJob } from "@/server/jobs";

const log = createLogger({ component: "web.integrations" });

export const devFixtureEnabled =
  process.env.ENABLE_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

export function linearOAuthConfigured(): boolean {
  return Boolean(process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET);
}

function oauthConfig() {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return {
    clientId: process.env.LINEAR_CLIENT_ID ?? "",
    clientSecret: process.env.LINEAR_CLIENT_SECRET ?? "",
    redirectUri: `${appUrl}/api/integrations/linear/callback`,
  };
}

export async function getLinearConnection(user: SessionUser, organizationId: string) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    const connection = await tx.integrationConnection.findFirst({
      where: { organizationId, provider: "LINEAR" },
    });
    if (!connection) return null;
    const sourceCounts = await tx.sourceObject.groupBy({
      by: ["type"],
      where: { organizationId, connectionId: connection.id, archivedAt: null },
      _count: true,
    });
    return {
      id: connection.id,
      status: connection.status,
      mode: connection.mode,
      workspaceName: connection.workspaceName,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
      projectCount: sourceCounts.find((c) => c.type === "PROJECT")?._count ?? 0,
      issueCount: sourceCounts.find((c) => c.type === "ISSUE")?._count ?? 0,
    };
  });
}

/** Dev-only: connect the fixture workspace (no OAuth app registered yet). */
export async function connectFixtureWorkspace(
  user: SessionUser,
  organizationId: string,
): Promise<void> {
  if (!devFixtureEnabled) throw new ValidationError("Fixture connections are disabled.");
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "integrations.manage", { organizationId });

    const existing = await tx.integrationConnection.findFirst({
      where: { organizationId, provider: "LINEAR" },
    });
    if (existing) throw new ValidationError("A Linear connection already exists for this organization.");

    const connection = await tx.integrationConnection.create({
      data: {
        organizationId,
        provider: "LINEAR",
        mode: "fixture",
        status: "ACTIVE",
        // Per-org suffix: (provider, workspaceId) is unique so real
        // workspaces map to exactly one org; fixtures must not collide.
        workspaceId: `${FIXTURE_WORKSPACE.id}-${organizationId.slice(0, 8)}`,
        workspaceName: FIXTURE_WORKSPACE.name,
        scopes: ["read", "write"],
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "integration.connected",
      resourceType: "integration_connection",
      resourceId: connection.id,
      correlationId,
      metadata: { provider: "LINEAR", mode: "fixture" },
    });
    await enqueueJob(tx, {
      type: "integration.sync",
      data: { connectionId: connection.id, organizationId },
      correlationId,
    });
    log.info("fixture_connection_created", { organizationId, connectionId: connection.id, correlationId });
  });
}

/** Build the Linear OAuth authorize redirect (real mode). */
export async function startLinearOAuth(
  user: SessionUser,
  organizationId: string,
): Promise<{ authorizeUrl: string; state: string }> {
  if (!linearOAuthConfigured()) throw new ValidationError("LINEAR_CLIENT_ID / LINEAR_CLIENT_SECRET are not set.");
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "integrations.manage", { organizationId });
  });
  const state = `${organizationId}.${randomUUID()}`;
  return { authorizeUrl: buildAuthorizeUrl(oauthConfig(), state), state };
}

/** OAuth callback: exchange code, encrypt tokens at rest, enqueue first sync. */
export async function completeLinearOAuth(
  user: SessionUser,
  organizationId: string,
  code: string,
): Promise<void> {
  const key = process.env.INTEGRATION_TOKEN_KEY;
  if (!key) throw new ValidationError("INTEGRATION_TOKEN_KEY is not set.");
  const token = await exchangeCodeForToken(oauthConfig(), code);
  const workspace = await fetchViewerWorkspace(token.accessToken);
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "integrations.manage", { organizationId });

    const data = {
      organizationId,
      provider: "LINEAR" as const,
      mode: "oauth",
      status: "ACTIVE" as const,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      encryptedAccessToken: encryptToken(token.accessToken, key),
      tokenExpiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null,
      scopes: token.scope?.split(/[ ,]/).filter(Boolean) ?? ["read", "write"],
      lastError: null,
    };
    const existing = await tx.integrationConnection.findFirst({
      where: { organizationId, provider: "LINEAR" },
    });
    const connection = existing
      ? await tx.integrationConnection.update({ where: { id: existing.id }, data })
      : await tx.integrationConnection.create({ data });

    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: existing ? "integration.reauthorized" : "integration.connected",
      resourceType: "integration_connection",
      resourceId: connection.id,
      correlationId,
      metadata: { provider: "LINEAR", mode: "oauth", workspace: workspace.name },
    });
    await enqueueJob(tx, {
      type: "integration.sync",
      data: { connectionId: connection.id, organizationId },
      correlationId,
    });
  });
}

export async function requestSync(user: SessionUser, organizationId: string): Promise<void> {
  const correlationId = newCorrelationId();
  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "integrations.manage", { organizationId });
    const connection = await tx.integrationConnection.findFirst({
      where: { organizationId, provider: "LINEAR" },
    });
    if (!connection) throw new ValidationError("No Linear connection to sync.");
    await enqueueJob(tx, {
      type: "integration.sync",
      data: { connectionId: connection.id, organizationId },
      correlationId,
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "integration.sync_requested",
      resourceType: "integration_connection",
      resourceId: connection.id,
      correlationId,
    });
  });
}

/**
 * Dev-only: simulate a Linear webhook for a source issue — flows through the
 * same webhook_events + job path as a real delivery.
 */
export async function simulateSourceChange(
  user: SessionUser,
  organizationId: string,
  sourceObjectId: string,
): Promise<void> {
  if (!devFixtureEnabled) throw new ValidationError("Simulation is disabled.");
  const correlationId = newCorrelationId();

  await withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    assertPermission(context, "integrations.manage", { organizationId });

    const source = await tx.sourceObject.findFirst({
      where: { id: sourceObjectId, organizationId, type: "ISSUE" },
    });
    if (!source) throw new ValidationError("Source issue not found.");

    const current = source.data as Record<string, unknown>;
    const nextState =
      source.stateType === "completed"
        ? { stateType: "started", stateName: "In Progress" }
        : { stateType: "completed", stateName: "Done" };
    const updated = {
      ...current,
      title: `${source.title} [scope revised]`,
      ...nextState,
      updatedAt: new Date().toISOString(),
    };

    const webhookEvent = await tx.webhookEvent.create({
      data: {
        organizationId,
        provider: "LINEAR",
        dedupeKey: `sim-${randomUUID()}`,
        eventType: "Issue.update",
        payload: { simulated: true, connectionId: source.connectionId, workItem: updated },
      },
    });
    await enqueueJob(tx, {
      type: "webhook.process",
      data: { webhookEventId: webhookEvent.id },
      correlationId,
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      action: "integration.change_simulated",
      resourceType: "source_object",
      resourceId: source.id,
      correlationId,
      metadata: { externalId: source.externalId },
    });
    log.info("source_change_simulated", { organizationId, sourceObjectId, correlationId });
  });
}

export async function listSourceIssues(user: SessionUser, organizationId: string) {
  return withRlsContext(getPrisma(), { organizationId }, async (tx) => {
    const context = await loadAuthorizationContext(tx, organizationId, user.id);
    if (!context) throw new ValidationError("Not a member of this organization.");
    return tx.sourceObject.findMany({
      where: { organizationId, type: "ISSUE", archivedAt: null },
      orderBy: { title: "asc" },
      select: { id: true, externalId: true, title: true, stateName: true },
    });
  });
}
