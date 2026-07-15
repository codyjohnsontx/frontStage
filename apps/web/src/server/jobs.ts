import type { Prisma, TransactionClient } from "@frontstage/database";

/**
 * Enqueue a background job directly (jobs is a cross-tenant infrastructure
 * table, not org-RLS'd). Payload uses the { correlationId, data } envelope
 * the worker expects. Prefer the outbox for domain events; direct enqueue is
 * for infrastructure work (webhook processing, sync requests).
 */
export async function enqueueJob(
  tx: TransactionClient,
  input: { type: string; data: Prisma.InputJsonValue; correlationId?: string | null },
): Promise<void> {
  await tx.job.create({
    data: {
      type: input.type,
      payload: {
        correlationId: input.correlationId ?? null,
        data: input.data,
      },
    },
  });
}
