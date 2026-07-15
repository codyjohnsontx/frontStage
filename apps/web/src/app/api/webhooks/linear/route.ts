import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getPrisma } from "@frontstage/database";
import { createLinearAdapter } from "@frontstage/linear-adapter";
import { createLogger } from "@frontstage/observability";
import { enqueueJob } from "@/server/jobs";

const log = createLogger({ component: "web.webhooks.linear" });

/**
 * Linear webhook ingestion (§39): verify signature → dedupe → persist a
 * minimal event record → ack fast → process asynchronously in the worker
 * (which re-fetches current source state rather than trusting the body).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const adapter = createLinearAdapter(
    process.env.LINEAR_WEBHOOK_SECRET
      ? { webhookSigningSecret: process.env.LINEAR_WEBHOOK_SECRET }
      : {},
  );
  const verified = adapter.verifyWebhook(rawBody, {
    "linear-signature": request.headers.get("linear-signature"),
    "linear-delivery": request.headers.get("linear-delivery"),
  });
  if (!verified.ok) {
    log.warn("webhook_rejected", { reason: verified.reason });
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  const dedupeKey =
    verified.deliveryId ?? createHash("sha256").update(rawBody).digest("hex");
  const prisma = getPrisma();
  try {
    // webhook_events + jobs are infrastructure tables (not org-RLS'd);
    // tenant resolution happens in the worker.
    await prisma.$transaction(async (tx) => {
      const event = await tx.webhookEvent.create({
        data: {
          provider: "LINEAR",
          dedupeKey,
          eventType: verified.eventType ?? "unknown",
          payload: verified.payload as object,
        },
      });
      await enqueueJob(tx, {
        type: "webhook.process",
        data: { webhookEventId: event.id },
      });
    });
  } catch (err) {
    // Unique violation on dedupeKey = duplicate delivery: ack it quietly.
    if ((err as { code?: string }).code === "P2002") {
      log.info("webhook_duplicate_ignored", { dedupeKey });
      return NextResponse.json({ ok: true, duplicate: true });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
