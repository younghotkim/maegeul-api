-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable: diary_embeddings with vector(1536) column for OpenAI embeddings
CREATE TABLE "diary_embeddings" (
    "id" SERIAL NOT NULL,
    "diary_id" INTEGER NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diary_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: chat_sessions for conversation management
CREATE TABLE "chat_sessions" (
    "session_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(255),
    "summary" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable: chat_messages for storing conversation history
CREATE TABLE "chat_messages" (
    "message_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "related_diary_ids" INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex: unique constraint on diary_id for diary_embeddings
CREATE UNIQUE INDEX "diary_embeddings_diary_id_key" ON "diary_embeddings"("diary_id");

-- CreateIndex: IVFFlat index for cosine similarity search on embeddings
CREATE INDEX "idx_diary_embeddings_vector" ON "diary_embeddings" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- CreateIndex: index on user_id for chat_sessions
CREATE INDEX "chat_sessions_user_id_idx" ON "chat_sessions"("user_id");

-- CreateIndex: index on session_id for chat_messages
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages"("session_id");

-- AddForeignKey: diary_embeddings -> Diary
ALTER TABLE "diary_embeddings" ADD CONSTRAINT "diary_embeddings_diary_id_fkey" FOREIGN KEY ("diary_id") REFERENCES "Diary"("diary_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: chat_sessions -> User
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: chat_messages -> chat_sessions
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add check constraint for role values
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_role_check" CHECK (role IN ('user', 'assistant', 'system'));
