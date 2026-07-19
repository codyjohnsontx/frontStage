import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@frontstage/database";
import { createLogger } from "@frontstage/observability";
import { z } from "zod";
import { drainOutbox, runDueJobs, type JobHandler } from "./queue.js";
import { sweepExpiredInvitations } from "./sweeps.js";
import {
  invitationEmailPayload,
  notificationEmailPayload,
  sendInvitationEmail,
  sendNotificationEmail,
} from "./email.js";
import { processWebhookEvent, syncConnection } from "./sources.js";
import { processAddLinearComment, processCreateLinearIssue } from "./requests.js";

const POLL_INTERVAL_MS = 1000;
const SWEEP_INTERVAL_MS = 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const workerId = `worker-${randomUUID().slice(0, 8)}`;
const log = createLogger({ component: "worker", workerId });

/** Domain event type → job type. */
const outboxRoutes: Record<string, string> = {
  "invitation.created": "email.invitation",
  "request.created": "linear.create_issue",
  "request.message.created": "linear.add_comment",
  "notify.request_update": "email.request_update",
};

const jobHandlers: Record<string, JobHandler> = {
  "email.invitation": async (data, { correlationId }) => {
    const parsed = invitationEmailPayload.parse(data);
    await sendInvitationEmail(parsed);
    log.info("invitation_email_sent", {
      invitationId: parsed.invitationId,
      to: parsed.email,
      correlationId,
    });
  },
  "integration.sync": async (data, { correlationId }) => {
    const parsed = z.object({ connectionId: z.string().uuid() }).parse(data);
    await syncConnection(getPrisma(), log.child({ correlationId }), parsed.connectionId);
  },
  "webhook.process": async (data, { correlationId }) => {
    const parsed = z.object({ webhookEventId: z.string().uuid() }).parse(data);
    await processWebhookEvent(getPrisma(), log.child({ correlationId }), parsed.webhookEventId);
  },
  "linear.create_issue": async (data, { correlationId, isFinalAttempt }) => {
    const parsed = z.object({ requestId: z.string().uuid() }).parse(data);
    await processCreateLinearIssue(
      getPrisma(),
      log.child({ correlationId }),
      parsed.requestId,
      isFinalAttempt,
    );
  },
  "linear.add_comment": async (data, { correlationId }) => {
    const parsed = z.object({ messageId: z.string().uuid() }).parse(data);
    await processAddLinearComment(getPrisma(), log.child({ correlationId }), parsed.messageId);
  },
  "email.request_update": async (data, { correlationId }) => {
    const parsed = notificationEmailPayload.parse(data);
    await sendNotificationEmail(parsed);
    // No recipient address in logs — correlationId is the identifying context.
    log.info("request_update_email_sent", { correlationId });
  },
};

async function main(): Promise<void> {
  const prisma = getPrisma();
  log.info("worker_started");

  let running = true;
  const stop = () => {
    running = false;
    log.info("worker_stopping");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let lastSweepAt = 0;
  let lastReconcileAt = Date.now(); // first reconcile after one interval
  while (running) {
    try {
      if (Date.now() - lastSweepAt >= SWEEP_INTERVAL_MS) {
        lastSweepAt = Date.now();
        await sweepExpiredInvitations(prisma, log);
      }
      if (Date.now() - lastReconcileAt >= RECONCILE_INTERVAL_MS) {
        lastReconcileAt = Date.now();
        const connections = await prisma.integrationConnection.findMany({
          where: { status: { not: "DISCONNECTED" } },
          select: { id: true },
        });
        let scheduled = 0;
        for (const c of connections) {
          // At most one queued/running sync per connection — reconciliation
          // must never pile up behind a slow or failing sync.
          const pending = await prisma.job.findFirst({
            where: {
              type: "integration.sync",
              status: { in: ["PENDING", "RUNNING"] },
              payload: { path: ["data", "connectionId"], equals: c.id },
            },
            select: { id: true },
          });
          if (pending) continue;
          await prisma.job.create({
            data: {
              type: "integration.sync",
              payload: { correlationId: null, data: { connectionId: c.id } },
            },
          });
          scheduled += 1;
        }
        if (scheduled > 0) {
          log.info("reconciliation_scheduled", { connections: scheduled });
        }
      }
      const drained = await drainOutbox(prisma, outboxRoutes, log);
      const ran = await runDueJobs(prisma, jobHandlers, workerId, log);
      if (drained === 0 && ran === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (err) {
      log.error("worker_loop_error", {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 5));
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
