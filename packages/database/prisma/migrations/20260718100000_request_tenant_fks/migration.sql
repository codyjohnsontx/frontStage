-- DropForeignKey
ALTER TABLE "client_requests" DROP CONSTRAINT "client_requests_duplicate_of_request_id_fkey";

-- DropForeignKey
ALTER TABLE "request_messages" DROP CONSTRAINT "request_messages_request_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "client_requests_organization_id_id_key" ON "client_requests"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "client_requests_organization_id_portal_id_id_key" ON "client_requests"("organization_id", "portal_id", "id");

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_organization_id_portal_id_duplicate_of_req_fkey" FOREIGN KEY ("organization_id", "portal_id", "duplicate_of_request_id") REFERENCES "client_requests"("organization_id", "portal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_organization_id_request_id_fkey" FOREIGN KEY ("organization_id", "request_id") REFERENCES "client_requests"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

