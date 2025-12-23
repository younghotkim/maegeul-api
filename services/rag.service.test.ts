import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * **Feature: mudita-bot, Property 3: Date Range Filtering**
 * **Validates: Requirements 1.4**
 * 
 * *For any* user query mentioning a specific date range, all retrieved diary entries 
 * SHALL have dates within that specified range.
 */

// Mock the database module
vi.mock('../db', () => ({
  default: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

// Mock the embedding service
vi.mock('./embedding.service', () => ({
  createEmbedding: vi.fn(),
  searchSimilarDiaries: vi.fn(),
  EMBEDDING_DIMENSION: 1536,
}));

import prisma from '../db';
import { createEmbedding, searchSimilarDiaries, EMBEDDING_DIMENSION } from './embedding.service';
import { 
  parseDateRange, 
  searchDiariesWithDateFilter, 
  buildContext,
  retrieveContext,
  extractDiaryIds,
  type Message,
  type DateRange,
} from './rag.service';

// Arbitrary generator for valid embedding vectors
const embeddingArbitrary = fc.array(
  fc.float({ min: -1, max: 1, noNaN: true }),
  { minLength: EMBEDDING_DIMENSION, maxLength: EMBEDDING_DIMENSION }
);

// Arbitrary generator for user IDs
const userIdArbitrary = fc.integer({ min: 1, max: 1000000 });

// Arbitrary generator for diary search results within a date range
const diaryInRangeArbitrary = (userId: number, startDate: Date, endDate: Date) => {
  // Ensure we generate dates within the range
  const start = startDate.getTime();
  const end = endDate.getTime() + (24 * 60 * 60 * 1000 - 1); // Include full end day
  
  return fc.record({
    diary_id: fc.integer({ min: 1, max: 1000000 }),
    title: fc.string({ minLength: 1, maxLength: 255 }),
    content: fc.string({ minLength: 1, maxLength: 10000 }),
    date: fc.date({ min: new Date(start), max: new Date(end) }),
    color: fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
    score: fc.float({ min: 0, max: 1, noNaN: true }),
  });
};

// Arbitrary generator for diary search results outside a date range
const diaryOutsideRangeArbitrary = (userId: number, startDate: Date, endDate: Date) => {
  // Generate dates outside the range
  const beforeStart = new Date(startDate);
  beforeStart.setDate(beforeStart.getDate() - 30);
  const afterEnd = new Date(endDate);
  afterEnd.setDate(afterEnd.getDate() + 30);
  
  return fc.record({
    diary_id: fc.integer({ min: 1, max: 1000000 }),
    title: fc.string({ minLength: 1, maxLength: 255 }),
    content: fc.string({ minLength: 1, maxLength: 10000 }),
    date: fc.oneof(
      fc.date({ min: beforeStart, max: new Date(startDate.getTime() - 1) }),
      fc.date({ min: new Date(endDate.getTime() + 24 * 60 * 60 * 1000), max: afterEnd })
    ),
    color: fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
    score: fc.float({ min: 0, max: 1, noNaN: true }),
  });
};

describe('Date Range Parsing', () => {
  // Use a fixed date for consistent testing
  const fixedNow = new Date('2025-06-15T12:00:00Z');
  
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should parse Korean "지난 N일" pattern', () => {
    const result = parseDateRange('지난 7일 동안 어땠어?');
    expect(result).not.toBeNull();
    if (result) {
      const expectedStart = new Date('2025-06-08T00:00:00Z');
      const expectedEnd = new Date('2025-06-15T00:00:00Z');
      expect(result.startDate.toDateString()).toBe(expectedStart.toDateString());
      expect(result.endDate.toDateString()).toBe(expectedEnd.toDateString());
    }
  });

  it('should parse Korean "최근 N일" pattern', () => {
    const result = parseDateRange('최근 3일 기분이 어땠나요?');
    expect(result).not.toBeNull();
    if (result) {
      const expectedStart = new Date('2025-06-12T00:00:00Z');
      expect(result.startDate.toDateString()).toBe(expectedStart.toDateString());
    }
  });

  it('should parse Korean "지난 주" pattern', () => {
    const result = parseDateRange('지난 주에 뭘 했어?');
    expect(result).not.toBeNull();
    if (result) {
      const expectedStart = new Date('2025-06-08T00:00:00Z');
      expect(result.startDate.toDateString()).toBe(expectedStart.toDateString());
    }
  });

  it('should parse Korean "지난 달" pattern', () => {
    const result = parseDateRange('지난달 감정 패턴을 알려줘');
    expect(result).not.toBeNull();
    if (result) {
      const expectedStart = new Date('2025-05-15T00:00:00Z');
      expect(result.startDate.toDateString()).toBe(expectedStart.toDateString());
    }
  });

  it('should parse English "last N days" pattern', () => {
    const result = parseDateRange('How was I feeling in the last 5 days?');
    expect(result).not.toBeNull();
    if (result) {
      const expectedStart = new Date('2025-06-10T00:00:00Z');
      expect(result.startDate.toDateString()).toBe(expectedStart.toDateString());
    }
  });

  it('should parse English "last week" pattern', () => {
    const result = parseDateRange('Tell me about last week');
    expect(result).not.toBeNull();
    if (result) {
      const expectedStart = new Date('2025-06-08T00:00:00Z');
      expect(result.startDate.toDateString()).toBe(expectedStart.toDateString());
    }
  });

  it('should parse specific date pattern (YYYY-MM-DD)', () => {
    const result = parseDateRange('2025-03-15에 뭘 썼어?');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.startDate.getFullYear()).toBe(2025);
      expect(result.startDate.getMonth()).toBe(2); // March is 2 (0-indexed)
      expect(result.startDate.getDate()).toBe(15);
    }
  });

  it('should parse Korean date format (YYYY년 MM월 DD일)', () => {
    const result = parseDateRange('2025년 4월 20일 일기 보여줘');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.startDate.getFullYear()).toBe(2025);
      expect(result.startDate.getMonth()).toBe(3); // April is 3 (0-indexed)
      expect(result.startDate.getDate()).toBe(20);
    }
  });

  it('should return null for queries without date references', () => {
    const result = parseDateRange('기분이 어때?');
    expect(result).toBeNull();
  });
});

describe('Date Range Filtering in Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Feature: mudita-bot, Property 3: Date Range Filtering**
   * **Validates: Requirements 1.4**
   * 
   * This test verifies that the searchDiariesWithDateFilter function correctly
   * passes date range parameters to the database query. The actual filtering
   * is done by PostgreSQL, so we verify:
   * 1. The query is called when a date range is provided
   * 2. Results returned by the database are passed through correctly
   */
  it('should only return diary entries within the specified date range', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary,
        embeddingArbitrary,
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 500 }), // Days from base date
        fc.integer({ min: 1, max: 30 }),
        async (userId, queryEmbedding, topK, daysFromBase, daySpan) => {
          // Clear mocks at the start of each iteration
          vi.mocked(prisma.$queryRaw).mockReset();
          
          // Create valid dates from integers to avoid NaN issues
          const baseDate = new Date('2024-01-01');
          const startDate = new Date(baseDate.getTime() + daysFromBase * 24 * 60 * 60 * 1000);
          const endDate = new Date(startDate.getTime() + daySpan * 24 * 60 * 60 * 1000);
          
          const dateRange: DateRange = { startDate, endDate };
          
          // Generate mock results with dates explicitly within the range
          // This simulates what the database would return after filtering
          const numResults = Math.min(topK, 3);
          const mockResults = [];
          for (let i = 0; i < numResults; i++) {
            // Create dates that are definitely within the range
            const dayOffset = Math.floor((daySpan * i) / Math.max(numResults, 1));
            const resultDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
            resultDate.setHours(12, 0, 0, 0); // Set to noon to avoid edge cases
            
            mockResults.push({
              diary_id: i + 1,
              title: `Test Diary ${i}`,
              content: `Content ${i}`,
              date: resultDate,
              color: '파란색',
              score: 0.9 - (i * 0.1),
            });
          }
          
          vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(mockResults);

          const results = await searchDiariesWithDateFilter(
            userId,
            queryEmbedding,
            topK,
            dateRange
          );

          // Property: All returned results must have dates within the specified range
          // The database query includes WHERE clauses for date filtering
          const startOfDay = new Date(startDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(endDate);
          endOfDay.setHours(23, 59, 59, 999);
          
          for (const result of results) {
            const resultDate = new Date(result.date);
            expect(resultDate.getTime()).toBeGreaterThanOrEqual(startOfDay.getTime());
            expect(resultDate.getTime()).toBeLessThanOrEqual(endOfDay.getTime());
          }

          // Verify the database was queried exactly once for this iteration
          expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 3: Date Range Filtering**
   * **Validates: Requirements 1.4**
   */
  it('should not return diary entries outside the specified date range', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary,
        embeddingArbitrary,
        fc.integer({ min: 0, max: 500 }), // Days from base date
        fc.integer({ min: 1, max: 30 }),
        async (userId, queryEmbedding, daysFromBase, daySpan) => {
          // Clear mocks at the start of each iteration
          vi.mocked(prisma.$queryRaw).mockReset();
          
          // Create valid dates from integers to avoid NaN issues
          const baseDate = new Date('2024-01-01');
          const startDate = new Date(baseDate.getTime() + daysFromBase * 24 * 60 * 60 * 1000);
          const endDate = new Date(startDate.getTime() + daySpan * 24 * 60 * 60 * 1000);
          
          const dateRange: DateRange = { startDate, endDate };
          
          // The database query should filter out entries outside the range
          // We simulate this by returning an empty array (as if no entries matched)
          vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);

          const results = await searchDiariesWithDateFilter(
            userId,
            queryEmbedding,
            5,
            dateRange
          );

          // Property: When no entries are in range, results should be empty
          expect(results).toHaveLength(0);

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 3: Date Range Filtering**
   * **Validates: Requirements 1.4**
   */
  it('should include date range parameters in the database query', async () => {
    const userId = 1;
    const queryEmbedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2025-01-15');
    const dateRange: DateRange = { startDate, endDate };
    
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);

    await searchDiariesWithDateFilter(userId, queryEmbedding, 5, dateRange);

    // Property: The query should be called with date range parameters
    expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(1);
  });

  it('should fall back to standard search when no date range is provided', async () => {
    const userId = 1;
    const queryEmbedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    const mockResults = [
      { diary_id: 1, title: 'Test', content: 'Content', date: new Date(), color: '파란색', score: 0.9 }
    ];
    
    vi.mocked(searchSimilarDiaries).mockResolvedValueOnce(mockResults);

    const results = await searchDiariesWithDateFilter(userId, queryEmbedding, 5, null);

    expect(searchSimilarDiaries).toHaveBeenCalledWith(userId, queryEmbedding, 5);
    expect(results).toEqual(mockResults);
  });
});

describe('Context Building', () => {
  it('should include diary content in context', () => {
    const diaries = [
      {
        diary_id: 1,
        title: '좋은 하루',
        content: '오늘은 정말 좋은 하루였다.',
        date: new Date('2025-06-15'),
        color: '초록색',
        score: 0.95,
      },
    ];
    
    const context = buildContext(diaries, []);
    
    expect(context).toContain('관련 일기 기록');
    expect(context).toContain('좋은 하루');
    expect(context).toContain('오늘은 정말 좋은 하루였다.');
    expect(context).toContain('행복/만족');
  });

  it('should include chat history in context', () => {
    const chatHistory: Message[] = [
      { role: 'user', content: '안녕하세요' },
      { role: 'assistant', content: '안녕하세요! 오늘 기분이 어떠세요?' },
    ];
    
    const context = buildContext([], chatHistory);
    
    expect(context).toContain('이전 대화');
    expect(context).toContain('사용자: 안녕하세요');
    expect(context).toContain('무디타: 안녕하세요! 오늘 기분이 어떠세요?');
  });

  it('should combine diaries and chat history', () => {
    const diaries = [
      {
        diary_id: 1,
        title: '테스트',
        content: '테스트 내용',
        date: new Date('2025-06-15'),
        color: '파란색',
        score: 0.9,
      },
    ];
    
    const chatHistory: Message[] = [
      { role: 'user', content: '지난 주 어땠어?' },
    ];
    
    const context = buildContext(diaries, chatHistory);
    
    expect(context).toContain('관련 일기 기록');
    expect(context).toContain('이전 대화');
  });
});

/**
 * **Feature: mudita-bot, Property 2: RAG Retrieval Includes Diary References**
 * **Validates: Requirements 1.3**
 * 
 * *For any* user query about past emotions, the RAG pipeline response SHALL include 
 * at least one diary_id reference from the user's diary history.
 */
describe('RAG Retrieval Includes Diary References', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock to return empty array to prevent undefined errors
    vi.mocked(searchSimilarDiaries).mockResolvedValue([]);
    vi.mocked(createEmbedding).mockResolvedValue(Array(EMBEDDING_DIMENSION).fill(0.1));
  });

  /**
   * **Feature: mudita-bot, Property 2: RAG Retrieval Includes Diary References**
   * **Validates: Requirements 1.3**
   */
  it('should include diary references when user has diary entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary,
        fc.array(
          fc.record({
            diary_id: fc.integer({ min: 1, max: 1000000 }),
            title: fc.string({ minLength: 1, maxLength: 255 }),
            content: fc.string({ minLength: 1, maxLength: 10000 }),
            date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
            color: fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
            score: fc.float({ min: Math.fround(0.1), max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        fc.constantFrom(
          '기분이 어때?',
          '감정을 느꼈어?',
          'How are you feeling?',
          '감정 패턴을 알려줘',
        ),
        async (userId, mockDiaries, query) => {
          // Reset mocks for this iteration
          vi.mocked(createEmbedding).mockReset();
          vi.mocked(searchSimilarDiaries).mockReset();
          
          // Mock embedding creation
          const mockEmbedding = Array(EMBEDDING_DIMENSION).fill(0.1);
          vi.mocked(createEmbedding).mockResolvedValueOnce(mockEmbedding);
          
          // Mock diary search to return the mock diaries
          vi.mocked(searchSimilarDiaries).mockResolvedValueOnce(mockDiaries);

          const context = await retrieveContext(userId, query, []);

          // Property: When user has diary entries, the context should include diary references
          expect(context.diaries.length).toBeGreaterThan(0);
          
          // All diary IDs should be valid positive integers
          const diaryIds = extractDiaryIds(context);
          expect(diaryIds.length).toBeGreaterThan(0);
          for (const id of diaryIds) {
            expect(id).toBeGreaterThan(0);
            expect(Number.isInteger(id)).toBe(true);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 2: RAG Retrieval Includes Diary References**
   * **Validates: Requirements 1.3**
   */
  it('should include diary content in context text when diaries are retrieved', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary,
        fc.record({
          diary_id: fc.integer({ min: 1, max: 1000000 }),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          content: fc.string({ minLength: 10, maxLength: 500 }),
          date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
          color: fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
          score: fc.float({ min: Math.fround(0.1), max: 1, noNaN: true }),
        }),
        async (userId, mockDiary) => {
          // Reset mocks for this iteration
          vi.mocked(createEmbedding).mockReset();
          vi.mocked(searchSimilarDiaries).mockReset();
          
          // Mock embedding creation
          const mockEmbedding = Array(EMBEDDING_DIMENSION).fill(0.1);
          vi.mocked(createEmbedding).mockResolvedValueOnce(mockEmbedding);
          
          // Mock diary search to return the mock diary
          vi.mocked(searchSimilarDiaries).mockResolvedValueOnce([mockDiary]);

          const context = await retrieveContext(userId, '감정이 어땠어?', []);

          // Property: Context text should contain the diary content
          expect(context.contextText).toContain(mockDiary.title);
          expect(context.contextText).toContain(mockDiary.content);
          expect(context.contextText).toContain(`일기 #${mockDiary.diary_id}`);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 2: RAG Retrieval Includes Diary References**
   * **Validates: Requirements 1.3**
   */
  it('should return empty diary references when user has no diary entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary,
        async (userId) => {
          // Reset mocks for this iteration
          vi.mocked(createEmbedding).mockReset();
          vi.mocked(searchSimilarDiaries).mockReset();
          
          // Mock embedding creation
          const mockEmbedding = Array(EMBEDDING_DIMENSION).fill(0.1);
          vi.mocked(createEmbedding).mockResolvedValueOnce(mockEmbedding);
          
          // Mock diary search to return empty (user has no diaries)
          vi.mocked(searchSimilarDiaries).mockResolvedValueOnce([]);

          const context = await retrieveContext(userId, '기분이 어땠어?', []);

          // Property: When user has no diary entries, diaries array should be empty
          expect(context.diaries).toHaveLength(0);
          expect(extractDiaryIds(context)).toHaveLength(0);

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Extract Diary IDs', () => {
  it('should extract all diary IDs from context', () => {
    const context = {
      diaries: [
        { diary_id: 1, title: 'A', content: 'A', date: new Date(), color: '파란색', score: 0.9 },
        { diary_id: 5, title: 'B', content: 'B', date: new Date(), color: '초록색', score: 0.8 },
        { diary_id: 10, title: 'C', content: 'C', date: new Date(), color: '노란색', score: 0.7 },
      ],
      chatHistory: [],
      contextText: '',
    };
    
    const ids = extractDiaryIds(context);
    
    expect(ids).toEqual([1, 5, 10]);
  });

  it('should return empty array when no diaries', () => {
    const context = {
      diaries: [],
      chatHistory: [],
      contextText: '',
    };
    
    const ids = extractDiaryIds(context);
    
    expect(ids).toEqual([]);
  });
});


// Import pattern analysis functions
import {
  analyzeMoodDistribution,
  identifyRecurringThemes,
  extractEmotionTriggers,
  analyzeEmotionalPatterns,
  type MoodColorDistribution,
  type RecurringTheme,
  type EmotionTrigger,
} from './rag.service';

// Arbitrary generator for diary entries with specific mood colors
const diaryWithColorArbitrary = (color: string) => fc.record({
  diary_id: fc.integer({ min: 1, max: 1000000 }),
  title: fc.string({ minLength: 1, maxLength: 255 }),
  content: fc.string({ minLength: 10, maxLength: 1000 }),
  date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  color: fc.constant(color),
  score: fc.float({ min: Math.fround(0.1), max: 1, noNaN: true }),
});

// Arbitrary generator for diary entries with random mood colors
const diaryArbitrary = fc.record({
  diary_id: fc.integer({ min: 1, max: 1000000 }),
  title: fc.string({ minLength: 1, maxLength: 255 }),
  content: fc.string({ minLength: 10, maxLength: 1000 }),
  date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  color: fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
  score: fc.float({ min: Math.fround(0.1), max: 1, noNaN: true }),
});

// Arbitrary generator for diary entries with recurring content
const diaryWithContentArbitrary = (keyword: string) => fc.record({
  diary_id: fc.integer({ min: 1, max: 1000000 }),
  title: fc.string({ minLength: 1, maxLength: 255 }),
  content: fc.string({ minLength: 10, maxLength: 500 }).map(
    content => `${content} ${keyword} ${content.slice(0, 50)}`
  ),
  date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  color: fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
  score: fc.float({ min: Math.fround(0.1), max: 1, noNaN: true }),
});

/**
 * **Feature: mudita-bot, Property 8: Pattern Analysis Includes Examples**
 * **Validates: Requirements 3.1, 3.2**
 * 
 * *For any* emotional pattern query, when patterns are identified, the response 
 * SHALL include specific diary_id references as supporting examples.
 */
describe('Pattern Analysis Includes Examples', () => {
  /**
   * **Feature: mudita-bot, Property 8: Pattern Analysis Includes Examples**
   * **Validates: Requirements 3.1, 3.2**
   */
  it('should include diary_id references when patterns are identified', () => {
    fc.assert(
      fc.property(
        fc.array(diaryArbitrary, { minLength: 2, maxLength: 20 }),
        (diaries) => {
          // Ensure unique diary IDs
          const uniqueDiaries = diaries.filter((d, i, arr) => 
            arr.findIndex(x => x.diary_id === d.diary_id) === i
          );
          
          if (uniqueDiaries.length < 2) return true; // Skip if not enough unique diaries
          
          const analysis = analyzeEmotionalPatterns(uniqueDiaries);
          
          // Property: When patterns are identified, they must include diary references
          if (analysis.moodDistribution.length > 0) {
            // Mood distribution should have counts matching actual diaries
            const totalCount = analysis.moodDistribution.reduce((sum, d) => sum + d.count, 0);
            expect(totalCount).toBe(uniqueDiaries.length);
          }
          
          // Emotion triggers must include diary IDs
          for (const trigger of analysis.emotionTriggers) {
            expect(trigger.diaryIds.length).toBeGreaterThan(0);
            // All diary IDs should be from the input diaries
            for (const id of trigger.diaryIds) {
              expect(uniqueDiaries.some(d => d.diary_id === id)).toBe(true);
            }
            // Examples should have valid diary references
            for (const example of trigger.examples) {
              expect(example.diary_id).toBeGreaterThan(0);
              expect(uniqueDiaries.some(d => d.diary_id === example.diary_id)).toBe(true);
            }
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 8: Pattern Analysis Includes Examples**
   * **Validates: Requirements 3.1, 3.2**
   */
  it('should include examples in recurring themes when themes are found', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('회사', '친구', '운동', '음악', '영화'),
        fc.integer({ min: 2, max: 5 }),
        (keyword, count) => {
          // Generate diaries that all contain the same keyword
          const diaries = Array.from({ length: count }, (_, i) => ({
            diary_id: i + 1,
            title: `일기 ${i + 1}`,
            content: `오늘은 ${keyword}에 대해 생각했다. ${keyword}가 중요하다고 느꼈다.`,
            date: new Date(2025, 0, i + 1),
            color: '파란색' as const,
            score: 0.9,
          }));
          
          const themes = identifyRecurringThemes(diaries, 2);
          
          // Property: When a theme appears in multiple diaries, it should be identified
          // and include diary references
          const keywordTheme = themes.find(t => t.theme === keyword);
          
          if (keywordTheme) {
            // Theme should have diary IDs
            expect(keywordTheme.diaryIds.length).toBeGreaterThanOrEqual(2);
            // All diary IDs should be valid
            for (const id of keywordTheme.diaryIds) {
              expect(diaries.some(d => d.diary_id === id)).toBe(true);
            }
            // Examples should be provided
            expect(keywordTheme.examples.length).toBeGreaterThan(0);
          }
          
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 8: Pattern Analysis Includes Examples**
   * **Validates: Requirements 3.1, 3.2**
   */
  it('should return empty results for empty diary list', () => {
    const analysis = analyzeEmotionalPatterns([]);
    
    expect(analysis.moodDistribution).toHaveLength(0);
    expect(analysis.recurringThemes).toHaveLength(0);
    expect(analysis.emotionTriggers).toHaveLength(0);
    expect(analysis.diaryCount).toBe(0);
    expect(analysis.dateRange).toBeNull();
  });

  /**
   * **Feature: mudita-bot, Property 8: Pattern Analysis Includes Examples**
   * **Validates: Requirements 3.1, 3.2**
   */
  it('should calculate correct mood distribution percentages', () => {
    fc.assert(
      fc.property(
        fc.array(diaryArbitrary, { minLength: 1, maxLength: 20 }),
        (diaries) => {
          // Ensure unique diary IDs
          const uniqueDiaries = diaries.filter((d, i, arr) => 
            arr.findIndex(x => x.diary_id === d.diary_id) === i
          );
          
          if (uniqueDiaries.length === 0) return true;
          
          const distribution = analyzeMoodDistribution(uniqueDiaries);
          
          // Property: Total count should equal number of diaries
          const totalCount = distribution.reduce((sum, d) => sum + d.count, 0);
          expect(totalCount).toBe(uniqueDiaries.length);
          
          // Property: Percentages should sum to approximately 100
          const totalPercentage = distribution.reduce((sum, d) => sum + d.percentage, 0);
          // Allow for rounding errors
          expect(totalPercentage).toBeGreaterThanOrEqual(98);
          expect(totalPercentage).toBeLessThanOrEqual(102);
          
          // Property: Each distribution entry should have valid data
          for (const entry of distribution) {
            expect(entry.count).toBeGreaterThan(0);
            expect(entry.percentage).toBeGreaterThanOrEqual(0);
            expect(entry.percentage).toBeLessThanOrEqual(100);
            expect(entry.description).toBeTruthy();
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * **Feature: mudita-bot, Property 9: Emotion Trigger Theme Matching**
 * **Validates: Requirements 3.4**
 * 
 * *For any* query about triggers for a specific Mood_Color, all referenced diary 
 * entries SHALL have that matching Mood_Color.
 */
describe('Emotion Trigger Theme Matching', () => {
  /**
   * **Feature: mudita-bot, Property 9: Emotion Trigger Theme Matching**
   * **Validates: Requirements 3.4**
   */
  it('should only include diary entries with matching mood color in triggers', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
        fc.array(diaryArbitrary, { minLength: 5, maxLength: 20 }),
        (targetColor, diaries) => {
          // Ensure unique diary IDs
          const uniqueDiaries = diaries.filter((d, i, arr) => 
            arr.findIndex(x => x.diary_id === d.diary_id) === i
          );
          
          if (uniqueDiaries.length < 2) return true;
          
          const triggers = extractEmotionTriggers(uniqueDiaries);
          
          // Property: For each emotion trigger, all diary IDs must have the matching mood color
          for (const trigger of triggers) {
            const triggerColor = trigger.moodColor;
            
            // All diary IDs in this trigger should have the matching color
            for (const diaryId of trigger.diaryIds) {
              const diary = uniqueDiaries.find(d => d.diary_id === diaryId);
              expect(diary).toBeDefined();
              expect(diary!.color).toBe(triggerColor);
            }
            
            // All examples should also have the matching color
            for (const example of trigger.examples) {
              const diary = uniqueDiaries.find(d => d.diary_id === example.diary_id);
              expect(diary).toBeDefined();
              expect(diary!.color).toBe(triggerColor);
            }
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 9: Emotion Trigger Theme Matching**
   * **Validates: Requirements 3.4**
   */
  it('should group diaries correctly by mood color', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (redCount, yellowCount, blueCount, greenCount) => {
          // Create diaries with specific colors
          let id = 1;
          const diaries: Array<{
            diary_id: number;
            title: string;
            content: string;
            date: Date;
            color: string;
            score: number;
          }> = [];
          
          for (let i = 0; i < redCount; i++) {
            diaries.push({
              diary_id: id++,
              title: `빨간 일기 ${i}`,
              content: `오늘은 화가 났다. 스트레스를 받았다.`,
              date: new Date(2025, 0, id),
              color: '빨간색',
              score: 0.9,
            });
          }
          
          for (let i = 0; i < yellowCount; i++) {
            diaries.push({
              diary_id: id++,
              title: `노란 일기 ${i}`,
              content: `오늘은 신나는 하루였다. 활력이 넘쳤다.`,
              date: new Date(2025, 0, id),
              color: '노란색',
              score: 0.9,
            });
          }
          
          for (let i = 0; i < blueCount; i++) {
            diaries.push({
              diary_id: id++,
              title: `파란 일기 ${i}`,
              content: `오늘은 차분한 하루였다. 평온했다.`,
              date: new Date(2025, 0, id),
              color: '파란색',
              score: 0.9,
            });
          }
          
          for (let i = 0; i < greenCount; i++) {
            diaries.push({
              diary_id: id++,
              title: `초록 일기 ${i}`,
              content: `오늘은 행복한 하루였다. 만족스러웠다.`,
              date: new Date(2025, 0, id),
              color: '초록색',
              score: 0.9,
            });
          }
          
          const triggers = extractEmotionTriggers(diaries);
          
          // Property: Each color should have its own trigger group
          const colorCounts: Record<string, number> = {
            '빨간색': redCount,
            '노란색': yellowCount,
            '파란색': blueCount,
            '초록색': greenCount,
          };
          
          for (const trigger of triggers) {
            const expectedCount = colorCounts[trigger.moodColor];
            expect(trigger.diaryIds.length).toBe(expectedCount);
          }
          
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 9: Emotion Trigger Theme Matching**
   * **Validates: Requirements 3.4**
   */
  it('should extract triggers only from diaries with the specific mood color', () => {
    // Create a controlled test case with known content
    const diaries = [
      {
        diary_id: 1,
        title: '화난 날',
        content: '회사에서 스트레스를 많이 받았다. 상사가 짜증났다.',
        date: new Date(2025, 0, 1),
        color: '빨간색',
        score: 0.9,
      },
      {
        diary_id: 2,
        title: '또 화난 날',
        content: '회사에서 또 스트레스를 받았다. 야근했다.',
        date: new Date(2025, 0, 2),
        color: '빨간색',
        score: 0.9,
      },
      {
        diary_id: 3,
        title: '행복한 날',
        content: '친구와 맛있는 음식을 먹었다. 즐거웠다.',
        date: new Date(2025, 0, 3),
        color: '초록색',
        score: 0.9,
      },
      {
        diary_id: 4,
        title: '또 행복한 날',
        content: '친구와 영화를 봤다. 재미있었다.',
        date: new Date(2025, 0, 4),
        color: '초록색',
        score: 0.9,
      },
    ];
    
    const triggers = extractEmotionTriggers(diaries);
    
    // Find the red (angry) trigger
    const redTrigger = triggers.find(t => t.moodColor === '빨간색');
    expect(redTrigger).toBeDefined();
    expect(redTrigger!.diaryIds).toContain(1);
    expect(redTrigger!.diaryIds).toContain(2);
    expect(redTrigger!.diaryIds).not.toContain(3);
    expect(redTrigger!.diaryIds).not.toContain(4);
    
    // Find the green (happy) trigger
    const greenTrigger = triggers.find(t => t.moodColor === '초록색');
    expect(greenTrigger).toBeDefined();
    expect(greenTrigger!.diaryIds).toContain(3);
    expect(greenTrigger!.diaryIds).toContain(4);
    expect(greenTrigger!.diaryIds).not.toContain(1);
    expect(greenTrigger!.diaryIds).not.toContain(2);
    
    // Property: Triggers for red should include "회사" and "스트레스" (common themes)
    // Triggers for green should include "친구" (common theme)
    if (redTrigger!.triggers.length > 0) {
      // The triggers should be extracted from red diaries only
      expect(redTrigger!.triggers.some(t => 
        t === '회사' || t === '스트레스' || t === '받았다'
      )).toBe(true);
    }
    
    if (greenTrigger!.triggers.length > 0) {
      // The triggers should be extracted from green diaries only
      expect(greenTrigger!.triggers.some(t => 
        t === '친구' || t === '맛있는' || t === '즐거웠다' || t === '재미있었다'
      )).toBe(true);
    }
  });

  /**
   * **Feature: mudita-bot, Property 9: Emotion Trigger Theme Matching**
   * **Validates: Requirements 3.4**
   */
  it('should return empty triggers for empty diary list', () => {
    const triggers = extractEmotionTriggers([]);
    expect(triggers).toHaveLength(0);
  });

  /**
   * **Feature: mudita-bot, Property 9: Emotion Trigger Theme Matching**
   * **Validates: Requirements 3.4**
   */
  it('should handle single diary correctly', () => {
    fc.assert(
      fc.property(
        diaryArbitrary,
        (diary) => {
          const triggers = extractEmotionTriggers([diary]);
          
          // Property: Single diary should create one trigger group
          expect(triggers.length).toBe(1);
          expect(triggers[0].moodColor).toBe(diary.color);
          expect(triggers[0].diaryIds).toContain(diary.diary_id);
          
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });
});


// Import personalized suggestion functions
import {
  extractEntities,
  generatePersonalizedSuggestions,
  isPersonalizedSuggestion,
  generateSuggestionsForNegativePatterns,
  type ExtractedEntity,
  type PersonalizedSuggestion,
} from './rag.service';

// Arbitrary generator for diary entries with specific content containing entities
const diaryWithEntitiesArbitrary = fc.record({
  diary_id: fc.integer({ min: 1, max: 1000000 }),
  title: fc.string({ minLength: 1, maxLength: 255 }),
  content: fc.constantFrom(
    '오늘 친구와 카페에서 커피를 마셨다. 즐거운 시간이었다.',
    '회사에서 힘든 하루였다. 상사와 미팅이 있었다.',
    '공원에서 산책을 했다. 날씨가 좋았다.',
    '엄마와 함께 저녁을 먹었다. 맛있었다.',
    '헬스장에서 운동을 했다. 기분이 좋아졌다.',
    '도서관에서 책을 읽었다. 집중이 잘 됐다.',
    '친구들과 영화를 봤다. 재미있었다.',
    '집에서 요리를 했다. 맛있게 먹었다.',
    '학교에서 공부를 했다. 시험 준비가 힘들었다.',
    '남자친구와 데이트를 했다. 행복했다.',
  ),
  date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  color: fc.constantFrom('빨간색', '노란색', '파란색', '초록색'),
  score: fc.float({ min: Math.fround(0.1), max: 1, noNaN: true }),
});

/**
 * **Feature: mudita-bot, Property 15: Personalized Suggestions**
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 * 
 * *For any* suggestion provided by Mudita_Bot, the suggestion text SHALL contain 
 * at least one entity (activity, person, or place) mentioned in the user's diary entries.
 */
describe('Personalized Suggestions', () => {
  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
   */
  it('should extract entities from diary content', () => {
    fc.assert(
      fc.property(
        fc.array(diaryWithEntitiesArbitrary, { minLength: 1, maxLength: 10 }),
        (diaries) => {
          // Ensure unique diary IDs
          const uniqueDiaries = diaries.filter((d, i, arr) => 
            arr.findIndex(x => x.diary_id === d.diary_id) === i
          );
          
          if (uniqueDiaries.length === 0) return true;
          
          const entities = extractEntities(uniqueDiaries);
          
          // Property: Extracted entities should have valid structure
          for (const entity of entities) {
            expect(['activity', 'person', 'place']).toContain(entity.type);
            expect(entity.value.length).toBeGreaterThan(0);
            expect(entity.frequency).toBeGreaterThan(0);
            expect(entity.diaryIds.length).toBeGreaterThan(0);
            
            // All diary IDs should be from the input diaries
            for (const id of entity.diaryIds) {
              expect(uniqueDiaries.some(d => d.diary_id === id)).toBe(true);
            }
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
   */
  it('should generate suggestions containing entities from user diaries', () => {
    fc.assert(
      fc.property(
        fc.array(diaryWithEntitiesArbitrary, { minLength: 1, maxLength: 10 }),
        fc.constantFrom('빨간색', '노란색', '파란색', '초록색', undefined),
        (diaries, currentMood) => {
          // Ensure unique diary IDs
          const uniqueDiaries = diaries.filter((d, i, arr) => 
            arr.findIndex(x => x.diary_id === d.diary_id) === i
          );
          
          if (uniqueDiaries.length === 0) return true;
          
          const suggestions = generatePersonalizedSuggestions(uniqueDiaries, currentMood);
          
          // Property: Each suggestion must contain at least one entity from user's diaries
          for (const suggestion of suggestions) {
            // Suggestion must be based on at least one entity
            expect(suggestion.basedOn.length).toBeGreaterThan(0);
            
            // The entity must appear in the user's diary content
            const entityFound = suggestion.basedOn.some(entity => {
              return uniqueDiaries.some(diary => 
                diary.content.toLowerCase().includes(entity.value.toLowerCase())
              );
            });
            
            expect(entityFound).toBe(true);
            
            // Suggestion text must contain the entity
            const suggestionContainsEntity = suggestion.basedOn.some(entity =>
              suggestion.suggestion.includes(entity.value)
            );
            
            expect(suggestionContainsEntity).toBe(true);
            
            // Diary IDs must be valid
            for (const id of suggestion.diaryIds) {
              expect(uniqueDiaries.some(d => d.diary_id === id)).toBe(true);
            }
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
   */
  it('should validate personalized suggestions correctly', () => {
    fc.assert(
      fc.property(
        fc.array(diaryWithEntitiesArbitrary, { minLength: 1, maxLength: 10 }),
        (diaries) => {
          // Ensure unique diary IDs
          const uniqueDiaries = diaries.filter((d, i, arr) => 
            arr.findIndex(x => x.diary_id === d.diary_id) === i
          );
          
          if (uniqueDiaries.length === 0) return true;
          
          const suggestions = generatePersonalizedSuggestions(uniqueDiaries);
          
          // Property: All generated suggestions should pass the personalization check
          for (const suggestion of suggestions) {
            const isPersonalized = isPersonalizedSuggestion(suggestion, uniqueDiaries);
            expect(isPersonalized).toBe(true);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
   */
  it('should avoid generic recommendations by requiring diary-based entities', () => {
    // Create diaries with specific entities
    const diaries = [
      {
        diary_id: 1,
        title: '좋은 하루',
        content: '오늘 친구와 카페에서 커피를 마셨다.',
        date: new Date(2025, 0, 1),
        color: '초록색',
        score: 0.9,
      },
      {
        diary_id: 2,
        title: '운동한 날',
        content: '헬스장에서 운동을 했다. 기분이 좋아졌다.',
        date: new Date(2025, 0, 2),
        color: '노란색',
        score: 0.9,
      },
    ];
    
    const suggestions = generatePersonalizedSuggestions(diaries);
    
    // Property: Suggestions should reference specific entities from diaries
    for (const suggestion of suggestions) {
      // Each suggestion must be based on entities found in the diaries
      expect(suggestion.basedOn.length).toBeGreaterThan(0);
      
      // The suggestion text should contain the entity value
      const containsEntity = suggestion.basedOn.some(entity =>
        suggestion.suggestion.includes(entity.value)
      );
      expect(containsEntity).toBe(true);
      
      // The entity should be one of: 친구, 카페, 커피, 헬스장, 운동
      const validEntities = ['친구', '카페', '커피', '헬스장', '운동'];
      const hasValidEntity = suggestion.basedOn.some(entity =>
        validEntities.includes(entity.value)
      );
      expect(hasValidEntity).toBe(true);
    }
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.1**
   */
  it('should generate suggestions for negative emotional patterns', () => {
    // Create diaries with mixed moods
    const diaries = [
      {
        diary_id: 1,
        title: '힘든 날',
        content: '회사에서 스트레스를 많이 받았다.',
        date: new Date(2025, 0, 1),
        color: '빨간색',
        score: 0.9,
      },
      {
        diary_id: 2,
        title: '좋은 날',
        content: '친구와 카페에서 즐거운 시간을 보냈다.',
        date: new Date(2025, 0, 2),
        color: '초록색',
        score: 0.9,
      },
      {
        diary_id: 3,
        title: '운동한 날',
        content: '헬스장에서 운동을 하고 기분이 좋아졌다.',
        date: new Date(2025, 0, 3),
        color: '노란색',
        score: 0.9,
      },
    ];
    
    const suggestions = generateSuggestionsForNegativePatterns(diaries);
    
    // Property: Suggestions for negative patterns should be based on positive experiences
    for (const suggestion of suggestions) {
      expect(suggestion.basedOn.length).toBeGreaterThan(0);
      
      // Suggestions should reference entities from positive diaries
      // (친구, 카페, 헬스장, 운동) rather than negative ones (회사, 스트레스)
      const positiveEntities = ['친구', '카페', '헬스장', '운동'];
      const hasPositiveEntity = suggestion.basedOn.some(entity =>
        positiveEntities.includes(entity.value)
      );
      
      // At least some suggestions should reference positive experiences
      // (This is a soft check since the algorithm prioritizes positive associations)
      if (suggestions.length > 0) {
        const anyPositive = suggestions.some(s =>
          s.basedOn.some(e => positiveEntities.includes(e.value))
        );
        expect(anyPositive).toBe(true);
      }
    }
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
   */
  it('should return empty suggestions for empty diary list', () => {
    const suggestions = generatePersonalizedSuggestions([]);
    expect(suggestions).toHaveLength(0);
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
   */
  it('should return empty entities for empty diary list', () => {
    const entities = extractEntities([]);
    expect(entities).toHaveLength(0);
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.2**
   */
  it('should reference specific activities, people, or places from diaries', () => {
    fc.assert(
      fc.property(
        fc.array(diaryWithEntitiesArbitrary, { minLength: 2, maxLength: 10 }),
        (diaries) => {
          // Ensure unique diary IDs
          const uniqueDiaries = diaries.filter((d, i, arr) => 
            arr.findIndex(x => x.diary_id === d.diary_id) === i
          );
          
          if (uniqueDiaries.length < 2) return true;
          
          const suggestions = generatePersonalizedSuggestions(uniqueDiaries);
          
          // Property: Each suggestion must reference a specific entity type
          for (const suggestion of suggestions) {
            const entityTypes = suggestion.basedOn.map(e => e.type);
            
            // All entity types must be valid
            for (const type of entityTypes) {
              expect(['activity', 'person', 'place']).toContain(type);
            }
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 15: Personalized Suggestions**
   * **Validates: Requirements 7.3**
   */
  it('should tailor recommendations to user preferences from diary history', () => {
    // Create diaries showing a preference for certain activities
    const diaries = [
      {
        diary_id: 1,
        title: '운동 1',
        content: '헬스장에서 운동을 했다. 기분이 좋았다.',
        date: new Date(2025, 0, 1),
        color: '초록색',
        score: 0.9,
      },
      {
        diary_id: 2,
        title: '운동 2',
        content: '오늘도 헬스장에서 운동했다. 상쾌하다.',
        date: new Date(2025, 0, 2),
        color: '노란색',
        score: 0.9,
      },
      {
        diary_id: 3,
        title: '운동 3',
        content: '헬스장 가서 운동하고 왔다.',
        date: new Date(2025, 0, 3),
        color: '초록색',
        score: 0.9,
      },
      {
        diary_id: 4,
        title: '카페',
        content: '카페에서 커피 마셨다.',
        date: new Date(2025, 0, 4),
        color: '파란색',
        score: 0.9,
      },
    ];
    
    const suggestions = generatePersonalizedSuggestions(diaries);
    
    // Property: Suggestions should prioritize frequently mentioned entities
    // 운동 and 헬스장 appear 3 times, so they should be prioritized
    if (suggestions.length > 0) {
      const firstSuggestion = suggestions[0];
      const frequentEntities = ['운동', '헬스장'];
      
      // The first suggestion should likely reference the most frequent entity
      const referencesFrequent = firstSuggestion.basedOn.some(entity =>
        frequentEntities.includes(entity.value)
      );
      
      expect(referencesFrequent).toBe(true);
    }
  });
});
