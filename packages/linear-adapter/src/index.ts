import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AdapterCapabilities,
  CanonicalProject,
  CanonicalWorkItem,
  ConnectionAuth,
  VerifiedWebhookEvent,
  WorkSystemAdapter,
} from "@frontstage/integration-core";
import { randomUUID } from "node:crypto";
import { createComment, createIssue, fetchAllIssues, fetchAllProjects, fetchIssueById, fetchProjectById } from "./graphql";
import { FIXTURE_ISSUES, FIXTURE_PROJECTS } from "./fixtures";

export { buildAuthorizeUrl, exchangeCodeForToken, type LinearOAuthConfig } from "./oauth";
export { fetchViewerWorkspace } from "./graphql";
export { FIXTURE_ISSUES, FIXTURE_PROJECTS, FIXTURE_WORKSPACE } from "./fixtures";

/**
 * Verify a Linear webhook delivery: HMAC-SHA256 of the raw body with the
 * webhook signing secret, hex-encoded in the `linear-signature` header.
 * Replay control: reject payloads whose webhookTimestamp is older than 60s.
 */
export function verifyLinearWebhook(
  rawBody: string,
  headers: Record<string, string | null>,
  signingSecret: string,
  now: number = Date.now(),
): VerifiedWebhookEvent {
  const signature = headers["linear-signature"];
  if (!signature) return { ok: false, reason: "missing linear-signature header" };

  const expected = createHmac("sha256", signingSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "signature mismatch" };
  }

  let payload: { type?: string; action?: string; webhookTimestamp?: number };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return { ok: false, reason: "invalid JSON body" };
  }

  if (
    typeof payload.webhookTimestamp === "number" &&
    Math.abs(now - payload.webhookTimestamp) > 60_000
  ) {
    return { ok: false, reason: "stale webhook timestamp (possible replay)" };
  }

  const result: VerifiedWebhookEvent = { ok: true, payload };
  if (payload.type) result.eventType = `${payload.type}.${payload.action ?? "unknown"}`;
  const deliveryId = headers["linear-delivery"];
  if (deliveryId) result.deliveryId = deliveryId;
  return result;
}

export function createLinearAdapter(options: { webhookSigningSecret?: string } = {}): WorkSystemAdapter {
  return {
    provider: "linear",

    capabilities(): AdapterCapabilities {
      return {
        projects: { read: true, write: false },
        workItems: { read: true, create: true, update: true },
        comments: { read: true, create: true, edit: false },
        webhooks: true,
        attachments: true,
      };
    },

    async listProjects(auth): Promise<CanonicalProject[]> {
      if (auth.mode === "fixture") return structuredClone(FIXTURE_PROJECTS);
      return fetchAllProjects(auth.accessToken);
    },

    async listWorkItems(auth, projectId): Promise<CanonicalWorkItem[]> {
      if (auth.mode === "fixture") {
        const all = structuredClone(FIXTURE_ISSUES);
        return projectId ? all.filter((i) => i.projectId === projectId) : all;
      }
      return fetchAllIssues(auth.accessToken, projectId);
    },

    async getProject(auth, id): Promise<CanonicalProject | null> {
      if (auth.mode === "fixture") {
        return structuredClone(FIXTURE_PROJECTS.find((p) => p.id === id) ?? null);
      }
      return fetchProjectById(auth.accessToken, id);
    },

    async getWorkItem(auth, id): Promise<CanonicalWorkItem | null> {
      if (auth.mode === "fixture") {
        return structuredClone(FIXTURE_ISSUES.find((i) => i.id === id) ?? null);
      }
      return fetchIssueById(auth.accessToken, id);
    },

    async createWorkItem(auth, input) {
      if (auth.mode === "fixture") {
        // Simulated intake: official-shaped reference without a live call.
        const suffix = randomUUID().slice(0, 8);
        return {
          id: `fixture-created-${suffix}`,
          identifier: `TRI-${suffix.slice(0, 4).toUpperCase()}`,
          url: `https://linear.app/northline/issue/TRI-${suffix.slice(0, 4).toUpperCase()}`,
        };
      }
      if (!input.teamId) {
        throw new Error(
          "Linear issue creation requires a destination team (set defaultTeamId on the connection)",
        );
      }
      return createIssue(auth.accessToken, {
        teamId: input.teamId,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.stateId ? { stateId: input.stateId } : {}),
      });
    },

    async addComment(auth, input) {
      if (auth.mode === "fixture") {
        return { id: `fixture-comment-${randomUUID().slice(0, 8)}` };
      }
      return createComment(auth.accessToken, {
        issueId: input.workItemId,
        body: input.body,
      });
    },

    verifyWebhook(rawBody, headers): VerifiedWebhookEvent {
      if (!options.webhookSigningSecret) {
        return { ok: false, reason: "LINEAR_WEBHOOK_SECRET is not configured" };
      }
      return verifyLinearWebhook(rawBody, headers, options.webhookSigningSecret);
    },
  };
}
