-- CreateTable
CREATE TABLE "portal_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "portal_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_key" "role_key" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_memberships_organization_id_idx" ON "portal_memberships"("organization_id");

-- CreateIndex
CREATE INDEX "portal_memberships_user_id_idx" ON "portal_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_memberships_portal_id_user_id_key" ON "portal_memberships"("portal_id", "user_id");

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
