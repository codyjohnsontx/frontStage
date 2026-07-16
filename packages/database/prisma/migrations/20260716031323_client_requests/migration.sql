-- CreateEnum
CREATE TYPE "request_type" AS ENUM ('FEATURE', 'BUG', 'CHANGE', 'QUESTION', 'SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "request_status" AS ENUM ('RECEIVED', 'IN_REVIEW', 'ACCEPTED', 'DECLINED', 'CLOSED');

-- CreateEnum
CREATE TYPE "client_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "sync_state" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- AlterTable
ALTER TABLE "client_organizations" ADD COLUMN     "next_request_number" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "integration_connections" ADD COLUMN     "default_team_id" TEXT;

-- CreateTable
CREATE TABLE "client_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "portal_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "type" "request_type" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "request_status" NOT NULL DEFAULT 'RECEIVED',
    "client_priority" "client_priority" NOT NULL DEFAULT 'NORMAL',
    "internal_priority" "client_priority",
    "created_by_id" UUID NOT NULL,
    "linear_issue_id" TEXT,
    "linear_issue_identifier" TEXT,
    "linear_sync_state" "sync_state" NOT NULL DEFAULT 'PENDING',
    "linear_sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_requests_organization_id_portal_id_created_at_idx" ON "client_requests"("organization_id", "portal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_requests_organization_id_identifier_key" ON "client_requests"("organization_id", "identifier");

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_organization_id_portal_id_fkey" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "portals"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
