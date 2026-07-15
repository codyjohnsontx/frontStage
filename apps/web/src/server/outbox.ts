import type { Prisma, TransactionClient } from "@frontstage/database";

/**
 * Write a domain event to the transactional outbox. Committed atomically
 * with the surrounding state change; the worker performs the side effect.
 */
export async function enqueueOutboxEvent(
  tx: TransactionClient,
  input: {
    organizationId: string;
    eventType: string;
    payload: Prisma.InputJsonValue;
    correlationId?: string;
  },
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
    },
  });
}
