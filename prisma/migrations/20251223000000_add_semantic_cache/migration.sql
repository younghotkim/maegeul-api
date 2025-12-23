-- Semantic Cache table for storing query-response pairs with vector embeddings
-- Used to reduce API costs by returning cached responses for similar queries

CREATE TABLE IF NOT EXISTS semantic_cache (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    query_embedding vector(1536) NOT NULL,
    response TEXT NOT NULL,
    diary_ids INTEGER[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Index for user lookups
    CONSTRAINT fk_semantic_cache_user FOREIGN KEY (user_id) REFERENCES "User"(user_id) ON DELETE CASCADE
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding ON semantic_cache 
USING ivfflat (query_embedding vector_cosine_ops) WITH (lists = 100);

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_semantic_cache_user_id ON semantic_cache(user_id);

-- Create index for created_at for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_semantic_cache_created_at ON semantic_cache(created_at);

-- Create GIN index for diary_ids array for invalidation queries
CREATE INDEX IF NOT EXISTS idx_semantic_cache_diary_ids ON semantic_cache USING GIN(diary_ids);
