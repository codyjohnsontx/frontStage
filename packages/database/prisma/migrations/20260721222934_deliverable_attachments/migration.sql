-- CreateEnum
CREATE TYPE "scan_status" AS ENUM ('PENDING', 'CLEAN', 'BLOCKED');

-- CreateTable
CREATE TABLE "deliverable_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "scan_status" "scan_status" NOT NULL DEFAULT 'PENDING',
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverable_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverable_attachments_organization_id_deliverable_id_idx" ON "deliverable_attachments"("organization_id", "deliverable_id");

-- AddForeignKey
ALTER TABLE "deliverable_attachments" ADD CONSTRAINT "deliverable_attachments_organization_id_deliverable_id_fkey" FOREIGN KEY ("organization_id", "deliverable_id") REFERENCES "deliverables"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_attachments" ADD CONSTRAINT "deliverable_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tenant isolation (same posture as deliverables).
ALTER TABLE deliverable_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverable_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deliverable_attachments
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
