-- CreateEnum
CREATE TYPE "deliverable_status" AS ENUM ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'DELIVERED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "client_organizations" ADD COLUMN     "next_deliverable_number" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "portal_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "acceptance_criteria" TEXT NOT NULL DEFAULT '',
    "target_date" TIMESTAMP(3),
    "status" "deliverable_status" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "internal_owner_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_source_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "source_object_id" UUID NOT NULL,
    "relationship" TEXT,

    CONSTRAINT "deliverable_source_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverables_organization_id_portal_id_created_at_idx" ON "deliverables"("organization_id", "portal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_organization_id_identifier_key" ON "deliverables"("organization_id", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_organization_id_id_key" ON "deliverables"("organization_id", "id");

-- CreateIndex
CREATE INDEX "deliverable_versions_organization_id_deliverable_id_idx" ON "deliverable_versions"("organization_id", "deliverable_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_versions_deliverable_id_version_key" ON "deliverable_versions"("deliverable_id", "version");

-- CreateIndex
CREATE INDEX "deliverable_source_links_organization_id_deliverable_id_idx" ON "deliverable_source_links"("organization_id", "deliverable_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_source_links_deliverable_id_source_object_id_key" ON "deliverable_source_links"("deliverable_id", "source_object_id");

-- CreateIndex

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_organization_id_portal_id_fkey" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "portals"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_internal_owner_id_fkey" FOREIGN KEY ("internal_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_organization_id_deliverable_id_fkey" FOREIGN KEY ("organization_id", "deliverable_id") REFERENCES "deliverables"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_source_links" ADD CONSTRAINT "deliverable_source_links_organization_id_deliverable_id_fkey" FOREIGN KEY ("organization_id", "deliverable_id") REFERENCES "deliverables"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_source_links" ADD CONSTRAINT "deliverable_source_links_source_object_id_fkey" FOREIGN KEY ("source_object_id") REFERENCES "source_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

