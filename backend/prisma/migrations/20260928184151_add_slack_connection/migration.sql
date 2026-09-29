-- CreateTable
CREATE TABLE "slack_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" TEXT NOT NULL,
    "team_name" TEXT,
    "access_token_ciphertext" TEXT NOT NULL,
    "webhook_url_ciphertext" TEXT,
    "webhook_channel_id" TEXT,
    "webhook_channel_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slack_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slack_connections_tenant_id_team_id_idx" ON "slack_connections"("tenant_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_connections_tenant_id_user_id_key" ON "slack_connections"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
