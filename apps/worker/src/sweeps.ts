import type { PrismaClient } from "@frontstage/database";
import type { Logger } from "@frontstage/observability";

/**
 * Expire overdue PENDING invitations and record a SYSTEM audit event per
 * invitation, atomically. Requires the worker's BYPASSRLS role because it
 * sweeps across all organizations. Idempotent — safe to run on an interval.
 */
export async function sweepExpiredInvitations(
  prisma: PrismaClient,
  log: Logger,
): Promise<number> {
  const expiredCount = await prisma.$executeRaw`
    WITH expired AS (
      UPDATE invitations
      SET status = 'EXPIRED'
      WHERE status = 'PENDING' AND expires_at < now()
      RETURNING id, organization_id, email
    )
    INSERT INTO audit_events
      (id, organization_id, actor_type, action, resource_type, resource_id, metadata)
    SELECT gen_random_uuid(), organization_id, 'SYSTEM', 'invitation.expired',
           'invitation', id::text, jsonb_build_object('email', email)
    FROM expired
  `;
  if (expiredCount > 0) {
    log.info("invitations_expired", { count: expiredCount });
  }
  return expiredCount;
}
