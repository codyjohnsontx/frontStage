import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@frontstage/database";
import { drainOutbox, runDueJobs, type JobHandler } from "./queue.js";
import { invitationEmailPayload, sendInvitationEmail } from "./email.js";

const POLL_INTERVAL_MS = 1000;
const workerId = `worker-${randomUUID().slice(0, 8)}`;

/** Domain event type → job type. */
const outboxRoutes: Record<string, string> = {
  "invitation.created": "email.invitation",
};

const jobHandlers: Record<string, JobHandler> = {
  "email.invitation": async (payload) => {
    const parsed = invitationEmailPayload.parse(payload);
    await sendInvitationEmail(parsed);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "invitation_email_sent",
        invitationId: parsed.invitationId,
        to: parsed.email,
      }),
    );
  },
};

async function main(): Promise<void> {
  const prisma = getPrisma();
  console.log(JSON.stringify({ level: "info", msg: "worker_started", workerId }));

  let running = true;
  const stop = () => {
    running = false;
    console.log(JSON.stringify({ level: "info", msg: "worker_stopping", workerId }));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    try {
      const drained = await drainOutbox(prisma, outboxRoutes);
      const ran = await runDueJobs(prisma, jobHandlers, workerId);
      if (drained === 0 && ran === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "worker_loop_error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 5));
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
