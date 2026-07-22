import type { PrismaClient } from "@frontstage/database";
import type { Logger } from "@frontstage/observability";

/**
 * Scan-state seam (§33). This SIMULATED scanner stands in for a real
 * engine: it flags files whose name contains the EICAR marker and clears
 * everything else. A production scanner slots in behind the same job
 * without touching the upload or freeze flows. Idempotent — resolved
 * attachments are left alone.
 */
export async function processScanAttachment(
  prisma: PrismaClient,
  log: Logger,
  attachmentId: string,
): Promise<void> {
  const attachment = await prisma.deliverableAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) throw new Error(`Attachment ${attachmentId} not found`);
  if (attachment.scanStatus !== "PENDING") return;

  const blocked = attachment.fileName.toLowerCase().includes("eicar");
  await prisma.deliverableAttachment.update({
    where: { id: attachment.id },
    data: { scanStatus: blocked ? "BLOCKED" : "CLEAN" },
  });
  log.info("attachment_scanned", {
    attachmentId,
    verdict: blocked ? "BLOCKED" : "CLEAN",
    simulated: true,
  });
}
