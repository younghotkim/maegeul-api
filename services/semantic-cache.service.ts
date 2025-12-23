/**
 * Semantic Cache Service for Mudita Bot
 * Uses pgvector to cache and retrieve similar query responses
 * Reduces API costs and improves response time for similar questions
 */

import prisma from '../db';
import { createEmbedding } from './embedding.service';

// Cache configuration
const SIMILARITY_THRESHOLD = 0.92; // 92% similarity required for cache hit
const CACHE_TTL_HOURS = 24; // Cache entries expire after 24 hours
const MAX_CACHE_ENTRIES_PER_USER = 100; // Maximum cache entries per user

export interface CacheEntry {
  id: number;
  userId: number;
  queryHash: string;
  query: string;
  response: string;
  diaryIds: number[];
  similarity: number;
  createdAt: Date;
}

export interface CacheResult {
  hit: boolean;
  entry?: CacheEntry;
  response?: string;
  diaryIds?: number[];
}

/**
 * Searches for a semantically similar cached response
 * @param userId - The user's ID
 * @param query - The user's query
 * @param queryEmbedding - Pre-computed embedding (optional, will compute if not provided)
 * @returns Cache result with hit status and cached response if found
 */
export async function searchCache(
  userId: number,
  query: string,
  queryEmbedding?: number[]
): Promise<CacheResult> {
  try {
    // Get or compute embedding
    const embedding = queryEmbedding || await createEmbedding(query);
    const embeddingStr = `[${embedding.join(',')}]`;
    
    // Calculate TTL cutoff
    const ttlCutoff = new Date();
    ttlCutoff.setHours(ttlCutoff.getHours() - CACHE_TTL_HOURS);
    
    // Search for similar cached queries using pgvector
    const results = await prisma.$queryRaw<Array<{
      id: number;
      user_id: number;
      query: string;
      response: string;
      diary_ids: number[];
      created_at: Date;
      similarity: number;
    }>>`
      SELECT 
        id,
        user_id,
        query,
        response,
        diary_ids,
        created_at,
        1 - (query_embedding <=> ${embeddingStr}::vector) as similarity
      FROM semantic_cache
      WHERE user_id = ${userId}
        AND created_at > ${ttlCutoff}
        AND 1 - (query_embedding <=> ${embeddingStr}::vector) >= ${SIMILARITY_THRESHOLD}
      ORDER BY query_embedding <=> ${embeddingStr}::vector ASC
      LIMIT 1
    `;
    
    if (results.length > 0) {
      const cached = results[0];
      console.log(`[SemanticCache] HIT for user ${userId}, similarity: ${(cached.similarity * 100).toFixed(1)}%`);
      
      return {
        hit: true,
        entry: {
          id: cached.id,
          userId: cached.user_id,
          queryHash: '',
          query: cached.query,
          response: cached.response,
          diaryIds: cached.diary_ids || [],
          similarity: cached.similarity,
          createdAt: cached.created_at,
        },
        response: cached.response,
        diaryIds: cached.diary_ids || [],
      };
    }
    
    console.log(`[SemanticCache] MISS for user ${userId}`);
    return { hit: false };
  } catch (error) {
    console.error('[SemanticCache] Search error:', error);
    return { hit: false };
  }
}

/**
 * Stores a query-response pair in the semantic cache
 * @param userId - The user's ID
 * @param query - The user's query
 * @param response - The generated response
 * @param diaryIds - Referenced diary IDs
 * @param queryEmbedding - Pre-computed embedding (optional)
 */
export async function storeInCache(
  userId: number,
  query: string,
  response: string,
  diaryIds: number[] = [],
  queryEmbedding?: number[]
): Promise<void> {
  try {
    // Skip caching very short queries or responses
    if (query.length < 5 || response.length < 20) {
      return;
    }
    
    // Get or compute embedding
    const embedding = queryEmbedding || await createEmbedding(query);
    const embeddingStr = `[${embedding.join(',')}]`;
    
    // Insert into cache
    await prisma.$executeRaw`
      INSERT INTO semantic_cache (user_id, query, query_embedding, response, diary_ids, created_at)
      VALUES (${userId}, ${query}, ${embeddingStr}::vector, ${response}, ${diaryIds}::integer[], NOW())
    `;
    
    console.log(`[SemanticCache] Stored response for user ${userId}`);
    
    // Cleanup old entries if user has too many
    await cleanupUserCache(userId);
  } catch (error) {
    // Don't fail the request if caching fails
    console.error('[SemanticCache] Store error:', error);
  }
}

/**
 * Cleans up old cache entries for a user
 * @param userId - The user's ID
 */
async function cleanupUserCache(userId: number): Promise<void> {
  try {
    // Count user's cache entries
    const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM semantic_cache WHERE user_id = ${userId}
    `;
    
    const count = Number(countResult[0].count);
    
    if (count > MAX_CACHE_ENTRIES_PER_USER) {
      // Delete oldest entries beyond the limit
      const deleteCount = count - MAX_CACHE_ENTRIES_PER_USER;
      await prisma.$executeRaw`
        DELETE FROM semantic_cache
        WHERE id IN (
          SELECT id FROM semantic_cache
          WHERE user_id = ${userId}
          ORDER BY created_at ASC
          LIMIT ${deleteCount}
        )
      `;
      console.log(`[SemanticCache] Cleaned up ${deleteCount} old entries for user ${userId}`);
    }
  } catch (error) {
    console.error('[SemanticCache] Cleanup error:', error);
  }
}

/**
 * Invalidates cache entries that reference specific diaries
 * Call this when a diary is updated or deleted
 * @param userId - The user's ID
 * @param diaryIds - Diary IDs that were modified
 */
export async function invalidateCacheByDiaries(
  userId: number,
  diaryIds: number[]
): Promise<void> {
  try {
    if (diaryIds.length === 0) return;
    
    await prisma.$executeRaw`
      DELETE FROM semantic_cache
      WHERE user_id = ${userId}
        AND diary_ids && ${diaryIds}::integer[]
    `;
    
    console.log(`[SemanticCache] Invalidated cache entries referencing diaries: ${diaryIds.join(', ')}`);
  } catch (error) {
    console.error('[SemanticCache] Invalidation error:', error);
  }
}

/**
 * Clears all cache entries for a user
 * @param userId - The user's ID
 */
export async function clearUserCache(userId: number): Promise<void> {
  try {
    await prisma.$executeRaw`
      DELETE FROM semantic_cache WHERE user_id = ${userId}
    `;
    console.log(`[SemanticCache] Cleared all cache for user ${userId}`);
  } catch (error) {
    console.error('[SemanticCache] Clear error:', error);
  }
}

/**
 * Gets cache statistics for monitoring
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  uniqueUsers: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}> {
  try {
    const stats = await prisma.$queryRaw<[{
      total_entries: bigint;
      unique_users: bigint;
      oldest_entry: Date | null;
      newest_entry: Date | null;
    }]>`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(DISTINCT user_id) as unique_users,
        MIN(created_at) as oldest_entry,
        MAX(created_at) as newest_entry
      FROM semantic_cache
    `;
    
    return {
      totalEntries: Number(stats[0].total_entries),
      uniqueUsers: Number(stats[0].unique_users),
      oldestEntry: stats[0].oldest_entry,
      newestEntry: stats[0].newest_entry,
    };
  } catch (error) {
    console.error('[SemanticCache] Stats error:', error);
    return {
      totalEntries: 0,
      uniqueUsers: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }
}
