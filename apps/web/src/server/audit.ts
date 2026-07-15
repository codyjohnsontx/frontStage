import type { Prisma, TransactionClient } from "@frontstage/database";

interface AuditInput {
  organizationId: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  correlationId?: string;
  metadata?: Prisma.InputJsonValue;
}

/** Append an audit event inside the current domain transaction. */
export async function recordAuditEvent(tx: TransactionClient, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorType: input.actorUserId ? "USER" : "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      correlationId: input.correlationId ?? null,
      metadata: input.metadata ?? {},
    },
  });
}
