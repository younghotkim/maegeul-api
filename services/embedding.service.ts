/**
 * OpenAI Embedding Service for Mudita Bot RAG Pipeline
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import axios from 'axios';
import prisma from '../db';

// Embedding dimension for text-embedding-3-small
export const EMBEDDING_DIMENSION = 1536;

// OpenAI API configuration
const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export interface DiarySearchResult {
  diary_id: number;
  title: string;
  content: string;
  date: Date;
  color: string;
  score: number;
}

/**
 * Creates an embedding vector for the given text using OpenAI's text-embedding-3-small model
 * @param text - The text to embed
 * @returns A 1536-dimensional embedding vector
 */
export async function createEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        OPENAI_API_URL,
        {
          model: EMBEDDING_MODEL,
          input: text,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000, // 30 second timeout
        }
      );

      const embedding = response.data.data[0].embedding;
      
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
        throw new Error(`Invalid embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${embedding?.length}`);
      }

      return embedding;
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on client errors (4xx) except rate limiting (429)
      if (error.response?.status && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
        throw new Error(`OpenAI API error: ${error.response?.data?.error?.message || error.message}`);
      }

      // Log retry attempt
      console.warn(`Embedding API attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);

      // Wait before retrying (exponential backoff)
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }
  }

  throw new Error(`Failed to create embedding after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}


/**
 * Upserts a diary embedding in the vector store
 * Creates a new embedding if one doesn't exist, or updates the existing one
 * @param diaryId - The diary ID to associate with the embedding
 * @param content - The diary content to embed
 */
export async function upsertDiaryEmbedding(diaryId: number, content: string): Promise<void> {
  const embedding = await createEmbedding(content);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Use raw SQL for pgvector operations since Prisma doesn't natively support vector types
  await prisma.$executeRaw`
    INSERT INTO diary_embeddings (diary_id, embedding, created_at, updated_at)
    VALUES (${diaryId}, ${embeddingStr}::vector, NOW(), NOW())
    ON CONFLICT (diary_id) 
    DO UPDATE SET 
      embedding = ${embeddingStr}::vector,
      updated_at = NOW()
  `;
}

/**
 * Searches for similar diaries using pgvector cosine similarity
 * Only returns diaries belonging to the specified user
 * @param userId - The authenticated user's ID (for access control)
 * @param queryEmbedding - The query embedding vector
 * @param topK - Maximum number of results to return (default: 5)
 * @returns Array of diary search results sorted by relevance score (descending)
 */
export async function searchSimilarDiaries(
  userId: number,
  queryEmbedding: number[],
  topK: number = 5
): Promise<DiarySearchResult[]> {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(`Invalid query embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${queryEmbedding?.length}`);
  }

  if (topK < 1) {
    throw new Error('topK must be at least 1');
  }

  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // Use raw SQL for pgvector cosine similarity search
  // The <=> operator computes cosine distance, so we use 1 - distance for similarity score
  const results = await prisma.$queryRaw<Array<{
    diary_id: number;
    title: string;
    content: string;
    date: Date;
    color: string;
    score: number;
  }>>`
    SELECT 
      d.diary_id,
      d.title,
      d.content,
      d.date,
      d.color,
      1 - (de.embedding <=> ${embeddingStr}::vector) as score
    FROM diary_embeddings de
    JOIN "Diary" d ON de.diary_id = d.diary_id
    WHERE d.user_id = ${userId}
    ORDER BY de.embedding <=> ${embeddingStr}::vector ASC
    LIMIT ${topK}
  `;

  return results.map(r => ({
    diary_id: r.diary_id,
    title: r.title,
    content: r.content,
    date: r.date,
    color: r.color,
    score: Number(r.score),
  }));
}

/**
 * Deletes a diary embedding from the vector store
 * Note: This is typically handled by CASCADE delete, but provided for explicit cleanup
 * @param diaryId - The diary ID whose embedding should be deleted
 */
export async function deleteDiaryEmbedding(diaryId: number): Promise<void> {
  await prisma.diaryEmbedding.delete({
    where: { diary_id: diaryId },
  }).catch(() => {
    // Ignore if embedding doesn't exist
  });
}

/**
 * Checks if a diary has an embedding
 * @param diaryId - The diary ID to check
 * @returns True if the diary has an embedding
 */
export async function hasDiaryEmbedding(diaryId: number): Promise<boolean> {
  const embedding = await prisma.diaryEmbedding.findUnique({
    where: { diary_id: diaryId },
    select: { id: true },
  });
  return embedding !== null;
}
