-- DropForeignKey
ALTER TABLE "portal_memberships" DROP CONSTRAINT "portal_memberships_portal_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "portals_slug_key" ON "portals"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "portals_organization_id_id_key" ON "portals"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_organization_id_portal_id_fkey" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "portals"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

