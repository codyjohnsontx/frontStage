-- CreateEnum
CREATE TYPE "request_message_kind" AS ENUM ('PUBLIC_REPLY', 'INTERNAL_NOTE', 'CLARIFICATION_REQUEST', 'CLIENT_MESSAGE');

-- AlterTable
ALTER TABLE "client_requests" ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "decided_by_id" UUID,
ADD COLUMN     "decision_reason" TEXT,
ADD COLUMN     "duplicate_of_request_id" UUID;

-- CreateTable
CREATE TABLE "request_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" "request_message_kind" NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "linear_sync_state" "sync_state" NOT NULL DEFAULT 'PENDING',
    "linear_comment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_messages_organization_id_request_id_created_at_idx" ON "request_messages"("organization_id", "request_id", "created_at");

-- AddForeignKey
ALTER TABLE "client_requests" ADD CONSTRAINT "client_requests_duplicate_of_request_id_fkey" FOREIGN KEY ("duplicate_of_request_id") REFERENCES "client_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "client_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
