CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS learnings_embedding_idx ON learnings USING hnsw (embedding vector_cosine_ops);
