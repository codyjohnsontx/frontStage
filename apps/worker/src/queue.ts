import { Prisma, type PrismaClient } from "@frontstage/database";
import type { Logger } from "@frontstage/observability";

/**
 * Every job payload is an envelope so the correlation id from the
 * originating domain command travels through outbox → job → side effect.
 */
export interface JobEnvelope {
  correlationId: string | null;
  data: unknown;
}

export interface ClaimedJob {
  id: string;
  queue: string;
  type: string;
  payload: JobEnvelope;
  attempts: number;
  max_attempts: number;
}

interface ClaimedOutboxEvent {
  id: string;
  organization_id: string | null;
  event_type: string;
  payload: unknown;
  attempts: number;
  correlation_id: string | null;
}

const BACKOFF_BASE_MS = 30_000;

function backoffDate(attempts: number): Date {
  return new Date(Date.now() + BACKOFF_BASE_MS * 2 ** Math.min(attempts, 6));
}

/**
 * Move due PENDING outbox events into jobs. Runs in a transaction with
 * FOR UPDATE SKIP LOCKED so multiple workers never double-process. Events
 * with no registered route are marked FAILED immediately (visible, not
 * silently dropped).
 */
export async function drainOutbox(
  prisma: PrismaClient,
  routes: Record<string, string>,
  log: Logger,
  batchSize = 20,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const events = await tx.$queryRaw<ClaimedOutboxEvent[]>`
      SELECT id, organization_id, event_type, payload, attempts, correlation_id
      FROM outbox_events
      WHERE status = 'PENDING'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    for (const event of events) {
      const jobType = routes[event.event_type];
      if (!jobType) {
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            lastError: `No route registered for event type "${event.event_type}"`,
          },
        });
        log.error("outbox_event_unroutable", {
          outboxEventId: event.id,
          eventType: event.event_type,
          correlationId: event.correlation_id,
        });
        continue;
      }
      const envelope: JobEnvelope = {
        correlationId: event.correlation_id,
        data: event.payload ?? {},
      };
      await tx.job.create({
        data: {
          type: jobType,
          payload: envelope as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      log.info("outbox_event_routed", {
        outboxEventId: event.id,
        eventType: event.event_type,
        jobType,
        organizationId: event.organization_id,
        correlationId: event.correlation_id,
      });
    }
    return events.length;
  });
}

export type JobHandler = (data: unknown, context: { correlationId: string | null }) => Promise<void>;

/**
 * Claim due jobs (SKIP LOCKED), mark them RUNNING, then execute outside the
 * claim transaction so slow handlers do not hold row locks. Failures retry
 * with exponential backoff until max_attempts, then park as FAILED.
 */
export async function runDueJobs(
  prisma: PrismaClient,
  handlers: Record<string, JobHandler>,
  workerId: string,
  log: Logger,
  batchSize = 5,
): Promise<number> {
  const claimed = await prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<ClaimedJob[]>`
      SELECT id, queue, type, payload, attempts, max_attempts
      FROM jobs
      WHERE status = 'PENDING' AND run_at <= now()
      ORDER BY priority DESC, run_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    if (jobs.length > 0) {
      await tx.$executeRaw`
        UPDATE jobs
        SET status = 'RUNNING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
        WHERE id::text IN (${Prisma.join(jobs.map((j) => j.id))})
      `;
    }
    return jobs;
  });

  for (const job of claimed) {
    const handler = handlers[job.type];
    const attempts = job.attempts + 1; // incremented at claim time
    const correlationId = job.payload?.correlationId ?? null;
    const jobLog = log.child({ jobId: job.id, jobType: job.type, correlationId, attempts });
    const startedAt = Date.now();
    try {
      if (!handler) {
        throw new Error(`No handler registered for job type "${job.type}"`);
      }
      await handler(job.payload?.data, { correlationId });
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "COMPLETED", lockedAt: null, lockedBy: null },
      });
      jobLog.info("job_completed", { durationMs: Date.now() - startedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = attempts >= job.max_attempts;
      const retryData = exhausted
        ? { status: "FAILED" as const }
        : { status: "PENDING" as const, runAt: backoffDate(attempts) };
      await prisma.job.update({
        where: { id: job.id },
        data: {
          ...retryData,
          lastError: message.slice(0, 2000),
          lockedAt: null,
          lockedBy: null,
        },
      });
      jobLog.error("job_failed", {
        exhausted,
        error: message,
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return claimed.length;
}
