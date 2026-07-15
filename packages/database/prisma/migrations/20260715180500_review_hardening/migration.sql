-- DropForeignKey
ALTER TABLE "external_project_versions" DROP CONSTRAINT "external_project_versions_external_project_id_fkey";

-- CreateIndex
CREATE INDEX "external_project_versions_organization_id_idx" ON "external_project_versions"("organization_id");

-- CreateIndex
CREATE INDEX "external_work_items_organization_id_idx" ON "external_work_items"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_provider_workspace_id_key" ON "integration_connections"("provider", "workspace_id");

-- CreateIndex
CREATE INDEX "source_links_organization_id_idx" ON "source_links"("organization_id");

-- AddForeignKey
ALTER TABLE "external_project_versions" ADD CONSTRAINT "external_project_versions_external_project_id_fkey" FOREIGN KEY ("external_project_id") REFERENCES "external_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

