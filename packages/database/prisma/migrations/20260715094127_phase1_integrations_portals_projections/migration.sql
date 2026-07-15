-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('LINEAR');

-- CreateEnum
CREATE TYPE "connection_status" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "source_object_type" AS ENUM ('PROJECT', 'ISSUE');

-- CreateEnum
CREATE TYPE "webhook_status" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "projection_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "work_item_visibility" AS ENUM ('INTERNAL', 'CLIENT_VISIBLE');

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "status" "connection_status" NOT NULL DEFAULT 'ACTIVE',
    "mode" TEXT NOT NULL DEFAULT 'oauth',
    "workspace_id" TEXT,
    "workspace_name" TEXT,
    "encrypted_access_token" TEXT,
    "encrypted_refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_objects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "type" "source_object_type" NOT NULL,
    "parent_external_id" TEXT,
    "title" TEXT NOT NULL,
    "state_type" TEXT,
    "state_name" TEXT,
    "data" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_object_snapshots" (
    "id" UUID NOT NULL,
    "source_object_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_object_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "provider" "integration_provider" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "webhook_status" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_organizations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "identifier_prefix" TEXT NOT NULL,
    "next_project_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status_mapping" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "portal_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "health" TEXT NOT NULL DEFAULT 'NOT_SET',
    "status" "projection_status" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_project_id" UUID NOT NULL,
    "source_object_id" UUID NOT NULL,
    "relationship" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "source_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_work_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_project_id" UUID NOT NULL,
    "source_object_id" UUID NOT NULL,
    "client_title" TEXT NOT NULL,
    "client_description" TEXT,
    "visibility" "work_item_visibility" NOT NULL DEFAULT 'INTERNAL',
    "curated_hash" TEXT NOT NULL,
    "source_changed" BOOLEAN NOT NULL DEFAULT false,
    "archived_from_source" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_project_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "published_by_id" UUID NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_project_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_organization_id_provider_key" ON "integration_connections"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "source_objects_organization_id_type_idx" ON "source_objects"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "source_objects_connection_id_external_id_key" ON "source_objects"("connection_id", "external_id");

-- CreateIndex
CREATE INDEX "source_object_snapshots_source_object_id_created_at_idx" ON "source_object_snapshots"("source_object_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_dedupe_key_key" ON "webhook_events"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "client_organizations_organization_id_slug_key" ON "client_organizations"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "portals_organization_id_slug_key" ON "portals"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "external_projects_organization_id_identifier_key" ON "external_projects"("organization_id", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "source_links_external_project_id_source_object_id_key" ON "source_links"("external_project_id", "source_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_work_items_external_project_id_source_object_id_key" ON "external_work_items"("external_project_id", "source_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_project_versions_external_project_id_version_key" ON "external_project_versions"("external_project_id", "version");

-- AddForeignKey
ALTER TABLE "source_objects" ADD CONSTRAINT "source_objects_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_object_snapshots" ADD CONSTRAINT "source_object_snapshots_source_object_id_fkey" FOREIGN KEY ("source_object_id") REFERENCES "source_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portals" ADD CONSTRAINT "portals_client_organization_id_fkey" FOREIGN KEY ("client_organization_id") REFERENCES "client_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_projects" ADD CONSTRAINT "external_projects_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_external_project_id_fkey" FOREIGN KEY ("external_project_id") REFERENCES "external_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_source_object_id_fkey" FOREIGN KEY ("source_object_id") REFERENCES "source_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_work_items" ADD CONSTRAINT "external_work_items_external_project_id_fkey" FOREIGN KEY ("external_project_id") REFERENCES "external_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_work_items" ADD CONSTRAINT "external_work_items_source_object_id_fkey" FOREIGN KEY ("source_object_id") REFERENCES "source_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_project_versions" ADD CONSTRAINT "external_project_versions_external_project_id_fkey" FOREIGN KEY ("external_project_id") REFERENCES "external_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
