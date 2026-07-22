-- DropForeignKey
ALTER TABLE "deliverable_source_links" DROP CONSTRAINT "deliverable_source_links_source_object_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "source_objects_organization_id_id_key" ON "source_objects"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "deliverable_source_links" ADD CONSTRAINT "deliverable_source_links_organization_id_source_object_id_fkey" FOREIGN KEY ("organization_id", "source_object_id") REFERENCES "source_objects"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

