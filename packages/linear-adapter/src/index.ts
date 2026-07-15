import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AdapterCapabilities,
  CanonicalProject,
  CanonicalWorkItem,
  ConnectionAuth,
  VerifiedWebhookEvent,
  WorkSystemAdapter,
} from "@frontstage/integration-core";
import { fetchAllIssues, fetchAllProjects } from "./graphql";
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

function requireToken(auth: ConnectionAuth): string {
  if (!auth.accessToken) throw new Error("Linear connection has no access token");
  return auth.accessToken;
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
      return fetchAllProjects(requireToken(auth));
    },

    async listWorkItems(auth, projectId): Promise<CanonicalWorkItem[]> {
      if (auth.mode === "fixture") {
        const all = structuredClone(FIXTURE_ISSUES);
        return projectId ? all.filter((i) => i.projectId === projectId) : all;
      }
      return fetchAllIssues(requireToken(auth), projectId);
    },

    async getProject(auth, id): Promise<CanonicalProject | null> {
      const projects = await this.listProjects(auth);
      return projects.find((p) => p.id === id) ?? null;
    },

    async getWorkItem(auth, id): Promise<CanonicalWorkItem | null> {
      const items = await this.listWorkItems(auth);
      return items.find((i) => i.id === id) ?? null;
    },

    verifyWebhook(rawBody, headers): VerifiedWebhookEvent {
      if (!options.webhookSigningSecret) {
        return { ok: false, reason: "LINEAR_WEBHOOK_SECRET is not configured" };
      }
      return verifyLinearWebhook(rawBody, headers, options.webhookSigningSecret);
    },
  };
}
