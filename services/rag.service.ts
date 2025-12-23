/**
 * RAG (Retrieval-Augmented Generation) Service for Mudita Bot
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.4, 8.1
 */

import { createEmbedding, searchSimilarDiaries, DiarySearchResult } from './embedding.service';
export type { DiarySearchResult } from './embedding.service';
import prisma from '../db';
import OpenAI from 'openai';

// LLM configuration
const LLM_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1000;
const TEMPERATURE = 0.8;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

// Lazy-initialized OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// Mood color traits for context (consistent with analyzeController)
const moodColorTraits: Record<string, { zone: string; description: string }> = {
  '빨간색': { zone: '고에너지 + 불쾌감', description: '화남, 불안, 스트레스' },
  '노란색': { zone: '고에너지 + 쾌적함', description: '흥분, 기쁨, 활력' },
  '파란색': { zone: '저에너지 + 불쾌감', description: '슬픔, 우울, 피로' },
  '초록색': { zone: '저에너지 + 쾌적함', description: '평온, 만족, 편안함' },
};

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface RAGContext {
  diaries: DiarySearchResult[];
  chatHistory: Message[];
  moodData: MoodMeterData[];
  contextText: string;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Embeds a user query using OpenAI's embedding model
 * @param query - The user's query text
 * @returns The embedding vector
 */
export async function embedQuery(query: string): Promise<number[]> {
  return createEmbedding(query);
}

/**
 * Parses date range from user query text
 * Supports various Korean and English date formats
 * @param query - The user's query text
 * @returns DateRange if found, null otherwise
 */
export function parseDateRange(query: string): DateRange | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Korean relative date patterns
  const koreanPatterns: { pattern: RegExp; getDates: () => DateRange }[] = [
    // "지난 N일" - last N days
    {
      pattern: /지난\s*(\d+)\s*일/,
      getDates: () => {
        const match = query.match(/지난\s*(\d+)\s*일/);
        const days = match ? parseInt(match[1]) : 7;
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - days);
        return { startDate, endDate: today };
      }
    },
    // "최근 N일" - recent N days
    {
      pattern: /최근\s*(\d+)\s*일/,
      getDates: () => {
        const match = query.match(/최근\s*(\d+)\s*일/);
        const days = match ? parseInt(match[1]) : 7;
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - days);
        return { startDate, endDate: today };
      }
    },
    // "지난 주" - last week
    {
      pattern: /지난\s*주/,
      getDates: () => {
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
        return { startDate, endDate: today };
      }
    },
    // "이번 주" - this week
    {
      pattern: /이번\s*주/,
      getDates: () => {
        const startDate = new Date(today);
        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek);
        return { startDate, endDate: today };
      }
    },
    // "지난 달" or "지난달" - last month
    {
      pattern: /지난\s*달/,
      getDates: () => {
        const startDate = new Date(today);
        startDate.setMonth(startDate.getMonth() - 1);
        return { startDate, endDate: today };
      }
    },
    // "이번 달" or "이번달" - this month
    {
      pattern: /이번\s*달/,
      getDates: () => {
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        return { startDate, endDate: today };
      }
    },
    // "요즘" or "최근" - recently (default 7 days)
    {
      pattern: /요즘|최근에/,
      getDates: () => {
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
        return { startDate, endDate: today };
      }
    },
    // "오늘" - today
    {
      pattern: /오늘/,
      getDates: () => {
        return { startDate: today, endDate: today };
      }
    },
    // "어제" - yesterday
    {
      pattern: /어제/,
      getDates: () => {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { startDate: yesterday, endDate: yesterday };
      }
    },
  ];

  // English relative date patterns
  const englishPatterns: { pattern: RegExp; getDates: () => DateRange }[] = [
    // "last N days"
    {
      pattern: /last\s*(\d+)\s*days?/i,
      getDates: () => {
        const match = query.match(/last\s*(\d+)\s*days?/i);
        const days = match ? parseInt(match[1]) : 7;
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - days);
        return { startDate, endDate: today };
      }
    },
    // "past N days"
    {
      pattern: /past\s*(\d+)\s*days?/i,
      getDates: () => {
        const match = query.match(/past\s*(\d+)\s*days?/i);
        const days = match ? parseInt(match[1]) : 7;
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - days);
        return { startDate, endDate: today };
      }
    },
    // "last week"
    {
      pattern: /last\s*week/i,
      getDates: () => {
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
        return { startDate, endDate: today };
      }
    },
    // "this week"
    {
      pattern: /this\s*week/i,
      getDates: () => {
        const startDate = new Date(today);
        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek);
        return { startDate, endDate: today };
      }
    },
    // "last month"
    {
      pattern: /last\s*month/i,
      getDates: () => {
        const startDate = new Date(today);
        startDate.setMonth(startDate.getMonth() - 1);
        return { startDate, endDate: today };
      }
    },
    // "this month"
    {
      pattern: /this\s*month/i,
      getDates: () => {
        const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        return { startDate, endDate: today };
      }
    },
    // "recently" or "lately"
    {
      pattern: /recently|lately/i,
      getDates: () => {
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
        return { startDate, endDate: today };
      }
    },
    // "today"
    {
      pattern: /\btoday\b/i,
      getDates: () => {
        return { startDate: today, endDate: today };
      }
    },
    // "yesterday"
    {
      pattern: /\byesterday\b/i,
      getDates: () => {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { startDate: yesterday, endDate: yesterday };
      }
    },
  ];

  // Check Korean patterns first
  for (const { pattern, getDates } of koreanPatterns) {
    if (pattern.test(query)) {
      return getDates();
    }
  }

  // Check English patterns
  for (const { pattern, getDates } of englishPatterns) {
    if (pattern.test(query)) {
      return getDates();
    }
  }

  // Specific date patterns (YYYY-MM-DD or YYYY년 MM월 DD일)
  const specificDatePattern = /(\d{4})[-년]\s*(\d{1,2})[-월]\s*(\d{1,2})일?/;
  const specificMatch = query.match(specificDatePattern);
  if (specificMatch) {
    const year = parseInt(specificMatch[1]);
    const month = parseInt(specificMatch[2]) - 1; // 0-indexed
    const day = parseInt(specificMatch[3]);
    const specificDate = new Date(year, month, day);
    return { startDate: specificDate, endDate: specificDate };
  }

  return null;
}

/**
 * Searches for relevant diaries with optional date range filtering
 * Validates: Requirements 1.3, 1.4
 * @param userId - The authenticated user's ID
 * @param queryEmbedding - The query embedding vector
 * @param topK - Maximum number of results
 * @param dateRange - Optional date range filter
 * @returns Array of diary search results
 */
export async function searchDiariesWithDateFilter(
  userId: number,
  queryEmbedding: number[],
  topK: number = 5,
  dateRange?: DateRange | null
): Promise<DiarySearchResult[]> {
  // If no date range, use the standard search
  if (!dateRange) {
    return searchSimilarDiaries(userId, queryEmbedding, topK);
  }

  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  
  // Adjust end date to include the entire day
  const endOfDay = new Date(dateRange.endDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Use raw SQL for pgvector cosine similarity search with date filtering
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
      AND d.date >= ${dateRange.startDate}
      AND d.date <= ${endOfDay}
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
 * MoodMeter data for context
 */
export interface MoodMeterData {
  id: number;
  label: string;
  color: string;
  pleasantness: number;
  energy: number;
  created_at: Date;
}

/**
 * Formats MoodMeter data for inclusion in the LLM context
 * @param moodData - Array of recent MoodMeter entries
 * @returns Formatted string representation
 */
function formatMoodMeterForContext(moodData: MoodMeterData[]): string {
  if (moodData.length === 0) return '';

  const moodDescriptions: Record<string, string> = {
    '빨간색': '고에너지 + 불쾌감 (화남, 불안, 스트레스)',
    '노란색': '고에너지 + 쾌적함 (흥분, 기쁨, 활력)',
    '파란색': '저에너지 + 불쾌감 (슬픔, 우울, 피로)',
    '초록색': '저에너지 + 쾌적함 (평온, 만족, 편안함)',
  };

  const entries = moodData.slice(0, 5).map(mood => {
    const dateStr = mood.created_at instanceof Date
      ? mood.created_at.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
      : new Date(mood.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    
    const colorDesc = moodDescriptions[mood.color] || mood.color;
    
    return `- ${dateStr}: "${mood.label}" (${colorDesc}, 쾌적함: ${mood.pleasantness}/10, 에너지: ${mood.energy}/10)`;
  });

  return entries.join('\n');
}

/**
 * Retrieves recent MoodMeter data for a user
 * @param userId - The authenticated user's ID
 * @param limit - Maximum number of entries to retrieve
 * @returns Array of recent MoodMeter entries
 */
export async function getRecentMoodMeterData(
  userId: number,
  limit: number = 5
): Promise<MoodMeterData[]> {
  const results = await prisma.moodMeter.findMany({
    where: { user_id: userId },
    orderBy: { id: 'desc' },
    take: limit,
  });

  return results.map(r => ({
    id: r.id,
    label: r.label,
    color: r.color,
    pleasantness: r.pleasantness,
    energy: r.energy,
    created_at: r.created_at,
  }));
}

/**
 * Formats a diary entry for inclusion in the LLM context
 * @param diary - The diary search result
 * @returns Formatted string representation
 */
function formatDiaryForContext(diary: DiarySearchResult): string {
  const dateStr = diary.date instanceof Date 
    ? diary.date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date(diary.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  
  const moodMap: Record<string, string> = {
    '빨간색': '불쾌/화남',
    '노란색': '활력/흥분',
    '파란색': '평온/차분',
    '초록색': '행복/만족',
  };
  
  const mood = moodMap[diary.color] || diary.color;
  
  return `[일기 #${diary.diary_id}] ${dateStr}
제목: ${diary.title}
감정: ${mood}
내용: ${diary.content}`;
}

/**
 * Formats chat history for inclusion in the LLM context
 * @param messages - Array of chat messages
 * @returns Formatted string representation
 */
function formatChatHistory(messages: Message[]): string {
  if (messages.length === 0) return '';
  
  return messages.map(msg => {
    const role = msg.role === 'user' ? '사용자' : '무디타';
    return `${role}: ${msg.content}`;
  }).join('\n');
}

/**
 * Builds the context string for the LLM from diaries, chat history, and mood data
 * Validates: Requirements 1.3, 2.1, 3.1
 * @param diaries - Retrieved diary entries
 * @param chatHistory - Previous messages in the session
 * @param moodData - Optional recent MoodMeter data
 * @returns Combined context string
 */
export function buildContext(
  diaries: DiarySearchResult[],
  chatHistory: Message[],
  moodData?: MoodMeterData[]
): string {
  const parts: string[] = [];

  // Add recent mood meter data if available
  if (moodData && moodData.length > 0) {
    parts.push('=== 최근 감정 상태 (MoodMeter) ===');
    parts.push(formatMoodMeterForContext(moodData));
  }

  // Add diary context if available
  if (diaries.length > 0) {
    parts.push('\n=== 관련 일기 기록 ===');
    parts.push(diaries.map(formatDiaryForContext).join('\n\n'));
  }

  // Add chat history if available
  if (chatHistory.length > 0) {
    parts.push('\n=== 이전 대화 ===');
    parts.push(formatChatHistory(chatHistory));
  }

  return parts.join('\n');
}

/**
 * Retrieves relevant context for a user query
 * Validates: Requirements 1.3, 1.4, 2.1, 3.1
 * @param userId - The authenticated user's ID
 * @param query - The user's query text
 * @param chatHistory - Previous messages in the session
 * @param topK - Maximum number of diary entries to retrieve
 * @returns RAG context with diaries, chat history, mood data, and formatted context text
 */
export async function retrieveContext(
  userId: number,
  query: string,
  chatHistory: Message[] = [],
  topK: number = 5
): Promise<RAGContext> {
  // Parse date range from query
  const dateRange = parseDateRange(query);
  
  // Embed the query
  const queryEmbedding = await embedQuery(query);
  
  // Search for relevant diaries with optional date filtering
  const diaries = await searchDiariesWithDateFilter(
    userId,
    queryEmbedding,
    topK,
    dateRange
  );
  
  // Get recent MoodMeter data
  const moodData = await getRecentMoodMeterData(userId, 5);
  
  // Build the context string with mood data
  const contextText = buildContext(diaries, chatHistory, moodData);
  
  return {
    diaries,
    chatHistory,
    moodData,
    contextText,
  };
}

/**
 * Extracts diary IDs from retrieved context
 * Useful for storing references in chat messages
 * @param context - The RAG context
 * @returns Array of diary IDs
 */
export function extractDiaryIds(context: RAGContext): number[] {
  return context.diaries.map(d => d.diary_id);
}


/**
 * Builds the system prompt for Mudita Bot with personality and context
 * Validates: Requirements 1.5
 * @param context - The RAG context with diary entries
 * @param userName - Optional user name for personalization
 * @returns The system prompt string
 */
export function buildSystemPrompt(context: string, userName?: string): string {
  const displayName = userName || '친구';
  
  return `당신은 '무디타'라는 이름의 따뜻하고 공감적인 AI 친구예요. ${displayName}의 감정 여정을 함께하는 대화 상대입니다.

## 무디타의 성격
- 따뜻하고 다정한 친구처럼 대화해요
- 사용자의 감정을 진심으로 이해하고 공감해요
- 판단하지 않고 있는 그대로 받아들여요
- 긍정적이지만 현실적인 조언을 해요

## 대화 규칙
1. **일기 기반 개인화**: 제공된 일기 내용을 참고하여 구체적으로 공감하고 대화해요
   - 일기에 나온 상황, 사람, 장소, 활동을 직접 언급하며 대화해요
   - "일기에서 봤는데..." 또는 "전에 ~했다고 했잖아" 식으로 자연스럽게 연결해요
2. **MoodMeter 활용**: 최근 감정 상태(MoodMeter) 데이터를 참고해서 현재 기분을 파악해요
   - 쾌적함(pleasantness)과 에너지(energy) 수치로 감정의 강도를 이해해요
   - 사용자가 선택한 감정 라벨을 참고해서 더 정확하게 공감해요
   - 최근 감정 변화 패턴을 파악해서 대화에 반영해요
3. **맥락 유지**: 이전 대화 내용을 기억하고 자연스럽게 이어가요
4. **감정 인식**: 사용자의 현재 감정 상태를 파악하고 적절히 반응해요
5. **구체적 제안**: 일반적인 조언 대신 사용자의 상황에 맞는 구체적인 제안을 해요

## 말투
- 친한 언니/오빠가 말하듯 다정한 반말 사용
- 이모지는 자연스럽게 1-2개 정도만 (💛🌿🌸☁️✨ 등)
- "힘내", "괜찮아", "화이팅" 같은 상투적 표현 피하기
- "~했구나", "~였겠다" 식으로 공감 표현
- 짧고 자연스러운 문장 사용 (한 번에 2-4문장 정도)

## 참고할 사용자 정보
${context || '(아직 일기 기록이 없어요)'}

위 정보를 바탕으로 ${displayName}와 자연스럽게 대화해주세요. 일기 내용과 MoodMeter 데이터를 직접적으로 나열하지 말고, 대화 흐름에 맞게 자연스럽게 언급해주세요.`;
}

/**
 * Callback type for streaming tokens
 */
export type OnTokenCallback = (token: string) => void;

/**
 * Helper function to delay execution
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determines if an error is retryable
 * @param error - The error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: any): boolean {
  // Rate limit errors are retryable
  if (error.status === 429) return true;
  
  // Connection errors are retryable
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }
  
  // Server errors (5xx) are retryable
  if (error.status >= 500 && error.status < 600) return true;
  
  // Network errors are retryable
  if (error.message?.includes('network') || error.message?.includes('timeout')) {
    return true;
  }
  
  return false;
}

/**
 * Generates a response using the LLM with streaming support and retry logic
 * Validates: Requirements 1.2, 1.5, 8.1, 9.3
 * @param context - The RAG context string with diary entries and chat history
 * @param userMessage - The user's current message
 * @param onToken - Callback function called for each streamed token
 * @param userName - Optional user name for personalization
 * @returns The complete response string
 */
export async function generateResponse(
  context: string,
  userMessage: string,
  onToken: OnTokenCallback,
  userName?: string
): Promise<string> {
  const openai = getOpenAIClient();
  const systemPrompt = buildSystemPrompt(context, userName);
  
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stream = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: true,
      });

      let fullResponse = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
          onToken(content);
        }
      }

      return fullResponse;
    } catch (error: any) {
      lastError = error;
      console.error(`LLM API Error (attempt ${attempt}/${MAX_RETRIES}):`, error.message);
      
      // Check if error is retryable and we have attempts left
      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        console.log(`Retrying in ${RETRY_DELAY_MS}ms...`);
        await delay(RETRY_DELAY_MS);
        continue;
      }
      
      // Non-retryable error or max retries reached
      break;
    }
  }

  // All retries exhausted or non-retryable error
  const error = lastError as any;
  
  if (error.status === 429) {
    throw new Error('Rate limit exceeded. Please try again in a moment.');
  } else if (error.status === 401) {
    throw new Error('Invalid API key configuration.');
  } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    throw new Error('Unable to connect to the AI service. Please try again.');
  }
  
  throw new Error(`Failed to generate response: ${error?.message || 'Unknown error'}`);
}

/**
 * Default response for users with no diary entries
 * Validates: Requirements 9.1
 */
const NO_DIARY_RESPONSE = `안녕! 아직 일기가 없는 것 같아. 😊

일기를 쓰면 내가 너의 감정 여정을 더 잘 이해하고 도움을 줄 수 있어.
오늘 하루는 어땠어? 간단하게라도 적어보는 건 어때?

일기를 쓰면 이런 것들을 함께 할 수 있어:
• 감정 패턴 분석
• 맞춤형 조언
• 과거 기록 기반 대화

매글에서 첫 일기를 시작해볼까? ✨`;

/**
 * Default response when no relevant diary entries are found
 * Validates: Requirements 9.2
 */
const NO_CONTEXT_RESPONSE_TEMPLATE = (userName?: string) => {
  const name = userName || '친구';
  return `${name}야, 그 주제에 대한 일기 기록은 아직 없는 것 같아.

지금 이야기하고 싶은 게 있으면 편하게 말해줘. 
일기에 없는 내용이라도 함께 이야기 나눌 수 있어! 💜`;
};

/**
 * Generates a response with full RAG pipeline (retrieval + generation)
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 8.1, 9.1, 9.2
 * @param userId - The authenticated user's ID
 * @param userMessage - The user's current message
 * @param chatHistory - Previous messages in the session
 * @param onToken - Callback function called for each streamed token
 * @param userName - Optional user name for personalization
 * @returns Object containing the full response and referenced diary IDs
 */
export async function generateRAGResponse(
  userId: number,
  userMessage: string,
  chatHistory: Message[] = [],
  onToken: OnTokenCallback,
  userName?: string
): Promise<{ response: string; diaryIds: number[] }> {
  // Check if user has any diary entries
  const userDiaryCount = await prisma.diary.count({
    where: { user_id: userId }
  });

  // Handle empty diary state (Requirement 9.1)
  if (userDiaryCount === 0) {
    // Stream the no-diary response token by token
    const response = NO_DIARY_RESPONSE;
    for (const char of response) {
      onToken(char);
    }
    return { response, diaryIds: [] };
  }

  // Retrieve relevant context
  const ragContext = await retrieveContext(userId, userMessage, chatHistory);
  
  // Handle empty search results (Requirement 9.2)
  // If no relevant diaries found but user has diaries, respond without context
  if (ragContext.diaries.length === 0) {
    // Still try to generate a response, but with minimal context
    // The LLM will respond based on the current message only
    const minimalContext = buildContext([], chatHistory);
    
    try {
      const response = await generateResponse(
        minimalContext,
        userMessage,
        onToken,
        userName
      );
      return { response, diaryIds: [] };
    } catch (error) {
      // If LLM fails, provide a fallback response
      const fallbackResponse = NO_CONTEXT_RESPONSE_TEMPLATE(userName);
      for (const char of fallbackResponse) {
        onToken(char);
      }
      return { response: fallbackResponse, diaryIds: [] };
    }
  }
  
  // Generate response with streaming
  const response = await generateResponse(
    ragContext.contextText,
    userMessage,
    onToken,
    userName
  );
  
  // Extract diary IDs for reference
  const diaryIds = extractDiaryIds(ragContext);
  
  return { response, diaryIds };
}


// ============================================================================
// Emotional Pattern Analysis
// Validates: Requirements 3.1, 3.2, 3.4
// ============================================================================

/**
 * Mood color distribution result
 */
export interface MoodColorDistribution {
  color: string;
  count: number;
  percentage: number;
  description: string;
}

/**
 * Recurring theme identified from diary content
 */
export interface RecurringTheme {
  theme: string;
  frequency: number;
  diaryIds: number[];
  examples: string[];
}

/**
 * Emotion trigger analysis result
 */
export interface EmotionTrigger {
  moodColor: string;
  triggers: string[];
  diaryIds: number[];
  examples: DiaryExample[];
}

/**
 * Diary example for pattern analysis
 */
export interface DiaryExample {
  diary_id: number;
  title: string;
  date: Date;
  excerpt: string;
}

/**
 * Complete emotional pattern analysis result
 */
export interface EmotionalPatternAnalysis {
  moodDistribution: MoodColorDistribution[];
  recurringThemes: RecurringTheme[];
  emotionTriggers: EmotionTrigger[];
  diaryCount: number;
  dateRange: { start: Date; end: Date } | null;
}

/**
 * Analyzes mood color distribution over a set of diary entries
 * Validates: Requirements 3.1, 3.3
 * @param diaries - Array of diary entries to analyze
 * @returns Array of mood color distributions sorted by count (descending)
 */
export function analyzeMoodDistribution(diaries: DiarySearchResult[]): MoodColorDistribution[] {
  if (diaries.length === 0) {
    return [];
  }

  const colorCounts: Record<string, number> = {};
  
  for (const diary of diaries) {
    const color = diary.color || '알 수 없음';
    colorCounts[color] = (colorCounts[color] || 0) + 1;
  }

  const total = diaries.length;
  const distribution: MoodColorDistribution[] = [];

  for (const [color, count] of Object.entries(colorCounts)) {
    const trait = moodColorTraits[color];
    distribution.push({
      color,
      count,
      percentage: Math.round((count / total) * 100),
      description: trait?.description || '알 수 없는 감정',
    });
  }

  // Sort by count descending
  return distribution.sort((a, b) => b.count - a.count);
}

/**
 * Common Korean words to exclude from theme extraction
 */
const KOREAN_STOP_WORDS = new Set([
  '그', '저', '이', '것', '수', '등', '때', '더', '안', '못', '잘', '좀',
  '너무', '정말', '진짜', '아주', '매우', '조금', '많이', '다시', '또',
  '오늘', '어제', '내일', '지금', '항상', '가끔', '자주', '계속',
  '나', '내', '저', '제', '우리', '그녀', '그', '그들',
  '하다', '되다', '있다', '없다', '같다', '보다', '가다', '오다', '주다', '받다',
  '하고', '하면', '해서', '했다', '한다', '할', '하는', '했는데',
  '그리고', '그래서', '하지만', '그런데', '그러나', '또한', '그래도',
  '이런', '저런', '그런', '어떤', '무슨', '왜', '어떻게',
  '아', '어', '음', '응', '네', '예', '아니', '아니요',
]);

/**
 * Extracts meaningful words/phrases from diary content
 * @param content - Diary content text
 * @returns Array of extracted words/phrases
 */
function extractKeywords(content: string): string[] {
  // Remove special characters and split into words
  const words = content
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 2)
    .map(word => word.toLowerCase());

  // Filter out stop words and short words
  return words.filter(word => 
    !KOREAN_STOP_WORDS.has(word) && 
    word.length >= 2 &&
    !/^\d+$/.test(word) // Exclude pure numbers
  );
}

/**
 * Identifies recurring themes in diary content
 * Validates: Requirements 3.1, 3.2
 * @param diaries - Array of diary entries to analyze
 * @param minFrequency - Minimum frequency for a theme to be considered recurring (default: 2)
 * @returns Array of recurring themes with diary references
 */
export function identifyRecurringThemes(
  diaries: DiarySearchResult[],
  minFrequency: number = 2
): RecurringTheme[] {
  if (diaries.length === 0) {
    return [];
  }

  // Track word occurrences across diaries
  const wordToDiaries: Map<string, Set<number>> = new Map();
  const wordToExamples: Map<string, string[]> = new Map();

  for (const diary of diaries) {
    const keywords = extractKeywords(diary.content);
    const seenInThisDiary = new Set<string>();

    for (const word of keywords) {
      // Only count each word once per diary
      if (!seenInThisDiary.has(word)) {
        seenInThisDiary.add(word);
        
        if (!wordToDiaries.has(word)) {
          wordToDiaries.set(word, new Set());
          wordToExamples.set(word, []);
        }
        
        wordToDiaries.get(word)!.add(diary.diary_id);
        
        // Store example excerpt (first 100 chars containing the word)
        const examples = wordToExamples.get(word)!;
        if (examples.length < 3) {
          const excerpt = extractExcerpt(diary.content, word);
          if (excerpt) {
            examples.push(excerpt);
          }
        }
      }
    }
  }

  // Convert to RecurringTheme array
  const themes: RecurringTheme[] = [];
  
  for (const [word, diaryIdSet] of wordToDiaries.entries()) {
    const frequency = diaryIdSet.size;
    if (frequency >= minFrequency) {
      themes.push({
        theme: word,
        frequency,
        diaryIds: Array.from(diaryIdSet),
        examples: wordToExamples.get(word) || [],
      });
    }
  }

  // Sort by frequency descending, then alphabetically
  return themes.sort((a, b) => {
    if (b.frequency !== a.frequency) {
      return b.frequency - a.frequency;
    }
    return a.theme.localeCompare(b.theme);
  });
}

/**
 * Extracts a short excerpt containing the given word
 * @param content - Full content text
 * @param word - Word to find
 * @returns Excerpt string or null if not found
 */
function extractExcerpt(content: string, word: string): string | null {
  const lowerContent = content.toLowerCase();
  const index = lowerContent.indexOf(word.toLowerCase());
  
  if (index === -1) {
    return null;
  }

  const start = Math.max(0, index - 30);
  const end = Math.min(content.length, index + word.length + 70);
  
  let excerpt = content.slice(start, end).trim();
  
  if (start > 0) {
    excerpt = '...' + excerpt;
  }
  if (end < content.length) {
    excerpt = excerpt + '...';
  }
  
  return excerpt;
}

/**
 * Extracts emotion triggers from diary entries grouped by mood color
 * Validates: Requirements 3.4
 * @param diaries - Array of diary entries to analyze
 * @returns Array of emotion triggers grouped by mood color
 */
export function extractEmotionTriggers(diaries: DiarySearchResult[]): EmotionTrigger[] {
  if (diaries.length === 0) {
    return [];
  }

  // Group diaries by mood color
  const diariesByColor: Map<string, DiarySearchResult[]> = new Map();
  
  for (const diary of diaries) {
    const color = diary.color || '알 수 없음';
    if (!diariesByColor.has(color)) {
      diariesByColor.set(color, []);
    }
    diariesByColor.get(color)!.push(diary);
  }

  const triggers: EmotionTrigger[] = [];

  for (const [color, colorDiaries] of diariesByColor.entries()) {
    // Find common themes within this mood color
    const themes = identifyRecurringThemes(colorDiaries, 1);
    
    // Take top 5 themes as triggers
    const topThemes = themes.slice(0, 5);
    
    // Create diary examples
    const examples: DiaryExample[] = colorDiaries.slice(0, 3).map(diary => ({
      diary_id: diary.diary_id,
      title: diary.title,
      date: diary.date,
      excerpt: diary.content.slice(0, 100) + (diary.content.length > 100 ? '...' : ''),
    }));

    triggers.push({
      moodColor: color,
      triggers: topThemes.map(t => t.theme),
      diaryIds: colorDiaries.map(d => d.diary_id),
      examples,
    });
  }

  // Sort by number of diaries (most common mood first)
  return triggers.sort((a, b) => b.diaryIds.length - a.diaryIds.length);
}

/**
 * Performs comprehensive emotional pattern analysis on diary entries
 * Validates: Requirements 3.1, 3.2, 3.4
 * @param diaries - Array of diary entries to analyze
 * @returns Complete emotional pattern analysis
 */
export function analyzeEmotionalPatterns(diaries: DiarySearchResult[]): EmotionalPatternAnalysis {
  if (diaries.length === 0) {
    return {
      moodDistribution: [],
      recurringThemes: [],
      emotionTriggers: [],
      diaryCount: 0,
      dateRange: null,
    };
  }

  // Calculate date range
  const dates = diaries.map(d => new Date(d.date).getTime());
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));

  return {
    moodDistribution: analyzeMoodDistribution(diaries),
    recurringThemes: identifyRecurringThemes(diaries),
    emotionTriggers: extractEmotionTriggers(diaries),
    diaryCount: diaries.length,
    dateRange: { start: minDate, end: maxDate },
  };
}

/**
 * Retrieves diaries by mood color for trigger analysis
 * Validates: Requirements 3.4
 * @param userId - The authenticated user's ID
 * @param moodColor - The mood color to filter by
 * @param limit - Maximum number of diaries to retrieve
 * @returns Array of diary entries with the specified mood color
 */
export async function getDiariesByMoodColor(
  userId: number,
  moodColor: string,
  limit: number = 10
): Promise<DiarySearchResult[]> {
  const results = await prisma.$queryRaw<Array<{
    diary_id: number;
    title: string;
    content: string;
    date: Date;
    color: string;
  }>>`
    SELECT 
      diary_id,
      title,
      content,
      date,
      color
    FROM "Diary"
    WHERE user_id = ${userId}
      AND color = ${moodColor}
    ORDER BY date DESC
    LIMIT ${limit}
  `;

  return results.map(r => ({
    diary_id: r.diary_id,
    title: r.title,
    content: r.content,
    date: r.date,
    color: r.color,
    score: 1.0, // Direct match, full score
  }));
}

/**
 * Retrieves all diaries for a user within a date range for pattern analysis
 * Validates: Requirements 3.1, 3.3
 * @param userId - The authenticated user's ID
 * @param dateRange - Optional date range filter
 * @param limit - Maximum number of diaries to retrieve
 * @returns Array of diary entries
 */
export async function getDiariesForPatternAnalysis(
  userId: number,
  dateRange?: DateRange | null,
  limit: number = 50
): Promise<DiarySearchResult[]> {
  if (dateRange) {
    const endOfDay = new Date(dateRange.endDate);
    endOfDay.setHours(23, 59, 59, 999);

    const results = await prisma.$queryRaw<Array<{
      diary_id: number;
      title: string;
      content: string;
      date: Date;
      color: string;
    }>>`
      SELECT 
        diary_id,
        title,
        content,
        date,
        color
      FROM "Diary"
      WHERE user_id = ${userId}
        AND date >= ${dateRange.startDate}
        AND date <= ${endOfDay}
      ORDER BY date DESC
      LIMIT ${limit}
    `;

    return results.map(r => ({
      diary_id: r.diary_id,
      title: r.title,
      content: r.content,
      date: r.date,
      color: r.color,
      score: 1.0,
    }));
  }

  // No date range - get recent diaries
  const results = await prisma.$queryRaw<Array<{
    diary_id: number;
    title: string;
    content: string;
    date: Date;
    color: string;
  }>>`
    SELECT 
      diary_id,
      title,
      content,
      date,
      color
    FROM "Diary"
    WHERE user_id = ${userId}
    ORDER BY date DESC
    LIMIT ${limit}
  `;

  return results.map(r => ({
    diary_id: r.diary_id,
    title: r.title,
    content: r.content,
    date: r.date,
    color: r.color,
    score: 1.0,
  }));
}


// ============================================================================
// Personalized Suggestion Generation
// Validates: Requirements 7.1, 7.2, 7.3, 7.4
// ============================================================================

/**
 * Entity types that can be extracted from diary content
 */
export type EntityType = 'activity' | 'person' | 'place';

/**
 * Extracted entity from diary content
 */
export interface ExtractedEntity {
  type: EntityType;
  value: string;
  frequency: number;
  diaryIds: number[];
  moodColors: string[];
}

/**
 * Personalized suggestion based on diary content
 */
export interface PersonalizedSuggestion {
  suggestion: string;
  basedOn: ExtractedEntity[];
  diaryIds: number[];
  moodContext: string;
}

/**
 * Common activity keywords in Korean
 */
const ACTIVITY_KEYWORDS = new Set([
  '운동', '산책', '조깅', '달리기', '수영', '헬스', '요가', '필라테스', '등산',
  '독서', '책', '영화', '드라마', '음악', '노래', '춤', '그림', '그리기',
  '요리', '베이킹', '청소', '정리', '빨래', '설거지',
  '공부', '학습', '강의', '수업', '시험', '과제',
  '게임', '쇼핑', '여행', '캠핑', '피크닉', '드라이브',
  '명상', '휴식', '낮잠', '수면', '잠',
  '카페', '커피', '차', '맥주', '술', '식사', '밥', '점심', '저녁', '아침',
  '미팅', '회의', '발표', '프로젝트', '업무', '일',
  '데이트', '약속', '모임', '파티', '생일',
  '병원', '치료', '검진', '약',
  '글쓰기', '일기', '블로그', '사진', '촬영',
]);

/**
 * Common relationship/person keywords in Korean
 */
const PERSON_KEYWORDS = new Set([
  '친구', '가족', '부모님', '엄마', '아빠', '어머니', '아버지',
  '형', '오빠', '누나', '언니', '동생', '남동생', '여동생',
  '할머니', '할아버지', '조부모', '삼촌', '이모', '고모', '외삼촌',
  '남편', '아내', '배우자', '애인', '여자친구', '남자친구', '연인',
  '아들', '딸', '자녀', '아이', '아기',
  '동료', '상사', '부하', '팀장', '사장', '대표', '선배', '후배',
  '선생님', '교수님', '강사', '학생', '제자',
  '이웃', '주민',
]);

/**
 * Common place keywords in Korean
 */
const PLACE_KEYWORDS = new Set([
  '집', '회사', '사무실', '학교', '대학', '학원',
  '카페', '커피숍', '식당', '레스토랑', '맛집', '술집', '바',
  '공원', '산', '바다', '해변', '강', '호수', '숲',
  '병원', '약국', '은행', '마트', '슈퍼', '백화점', '쇼핑몰',
  '헬스장', '체육관', '수영장', '운동장', '경기장',
  '도서관', '서점', '미술관', '박물관', '영화관', '극장', '공연장',
  '역', '버스정류장', '공항', '터미널',
  '호텔', '펜션', '숙소', '리조트',
  '교회', '절', '성당',
]);

/**
 * Extracts entities (activities, people, places) from diary content
 * Validates: Requirements 7.1, 7.2
 * @param diaries - Array of diary entries to analyze
 * @returns Array of extracted entities with frequency and context
 */
export function extractEntities(diaries: DiarySearchResult[]): ExtractedEntity[] {
  if (diaries.length === 0) {
    return [];
  }

  const entityMap: Map<string, {
    type: EntityType;
    frequency: number;
    diaryIds: Set<number>;
    moodColors: Set<string>;
  }> = new Map();

  for (const diary of diaries) {
    const content = diary.content.toLowerCase();
    const words = content.split(/\s+/);

    // Check for activities
    for (const word of words) {
      const cleanWord = word.replace(/[^\w가-힣]/g, '');
      
      if (ACTIVITY_KEYWORDS.has(cleanWord)) {
        updateEntityMap(entityMap, cleanWord, 'activity', diary);
      } else if (PERSON_KEYWORDS.has(cleanWord)) {
        updateEntityMap(entityMap, cleanWord, 'person', diary);
      } else if (PLACE_KEYWORDS.has(cleanWord)) {
        updateEntityMap(entityMap, cleanWord, 'place', diary);
      }
    }

    // Also check for multi-word patterns
    for (const keyword of ACTIVITY_KEYWORDS) {
      if (content.includes(keyword)) {
        updateEntityMap(entityMap, keyword, 'activity', diary);
      }
    }
    for (const keyword of PERSON_KEYWORDS) {
      if (content.includes(keyword)) {
        updateEntityMap(entityMap, keyword, 'person', diary);
      }
    }
    for (const keyword of PLACE_KEYWORDS) {
      if (content.includes(keyword)) {
        updateEntityMap(entityMap, keyword, 'place', diary);
      }
    }
  }

  // Convert map to array and sort by frequency
  const entities: ExtractedEntity[] = [];
  for (const [value, data] of entityMap.entries()) {
    entities.push({
      type: data.type,
      value,
      frequency: data.frequency,
      diaryIds: Array.from(data.diaryIds),
      moodColors: Array.from(data.moodColors),
    });
  }

  return entities.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Helper function to update entity map
 */
function updateEntityMap(
  map: Map<string, {
    type: EntityType;
    frequency: number;
    diaryIds: Set<number>;
    moodColors: Set<string>;
  }>,
  value: string,
  type: EntityType,
  diary: DiarySearchResult
): void {
  if (!map.has(value)) {
    map.set(value, {
      type,
      frequency: 0,
      diaryIds: new Set(),
      moodColors: new Set(),
    });
  }
  
  const entry = map.get(value)!;
  // Only increment frequency once per diary
  if (!entry.diaryIds.has(diary.diary_id)) {
    entry.frequency++;
    entry.diaryIds.add(diary.diary_id);
  }
  entry.moodColors.add(diary.color);
}

/**
 * Suggestion templates based on entity type and mood context
 */
const SUGGESTION_TEMPLATES: Record<EntityType, Record<string, string[]>> = {
  activity: {
    positive: [
      '{entity}을(를) 하면서 좋은 시간을 보냈던 것 같아. 다시 해보는 건 어때?',
      '전에 {entity} 했을 때 기분이 좋았잖아. 오늘도 한번 해볼까?',
      '{entity}이(가) 너한테 잘 맞는 것 같아. 꾸준히 해보면 좋겠다!',
    ],
    negative: [
      '힘들 때 {entity}을(를) 해보는 건 어때? 기분 전환이 될 수도 있어.',
      '전에 {entity} 하고 나서 기분이 나아졌던 적 있잖아.',
      '잠깐 {entity}을(를) 하면서 머리 좀 식혀보는 건 어떨까?',
    ],
  },
  person: {
    positive: [
      '{entity}와(과) 함께한 시간이 즐거웠던 것 같아. 연락해보는 건 어때?',
      '{entity}이(가) 너한테 좋은 영향을 주는 것 같아. 자주 만나면 좋겠다!',
      '{entity}와(과) 또 좋은 시간 보내면 좋겠다.',
    ],
    negative: [
      '{entity}한테 연락해보는 건 어때? 이야기 나누면 기분이 나아질 수도 있어.',
      '힘들 때 {entity}와(과) 대화해보면 도움이 될 것 같아.',
      '{entity}이(가) 네 이야기를 들어줄 수 있을 것 같아.',
    ],
  },
  place: {
    positive: [
      '{entity}에 가면 기분이 좋아지는 것 같아. 다시 가보는 건 어때?',
      '전에 {entity}에서 좋은 시간 보냈잖아. 또 가볼까?',
      '{entity}이(가) 너한테 좋은 장소인 것 같아.',
    ],
    negative: [
      '기분 전환으로 {entity}에 가보는 건 어때?',
      '{entity}에 가서 잠깐 쉬어보는 것도 좋을 것 같아.',
      '환경을 바꿔서 {entity}에 가보면 기분이 나아질 수도 있어.',
    ],
  },
};

/**
 * Determines if the mood context is positive or negative
 * @param moodColors - Array of mood colors
 * @returns 'positive' or 'negative'
 */
function getMoodContext(moodColors: string[]): 'positive' | 'negative' {
  const positiveColors = ['초록색', '노란색'];
  const negativeColors = ['빨간색', '파란색'];
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const color of moodColors) {
    if (positiveColors.includes(color)) {
      positiveCount++;
    } else if (negativeColors.includes(color)) {
      negativeCount++;
    }
  }
  
  return positiveCount >= negativeCount ? 'positive' : 'negative';
}

/**
 * Generates personalized suggestions based on diary content
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 * @param diaries - Array of diary entries to analyze
 * @param currentMood - Optional current mood color for context-aware suggestions
 * @param maxSuggestions - Maximum number of suggestions to generate (default: 3)
 * @returns Array of personalized suggestions
 */
export function generatePersonalizedSuggestions(
  diaries: DiarySearchResult[],
  currentMood?: string,
  maxSuggestions: number = 3
): PersonalizedSuggestion[] {
  if (diaries.length === 0) {
    return [];
  }

  const entities = extractEntities(diaries);
  
  if (entities.length === 0) {
    return [];
  }

  const suggestions: PersonalizedSuggestion[] = [];
  const usedEntities = new Set<string>();

  // Determine mood context
  const isNegativeMood = currentMood === '빨간색' || currentMood === '파란색';
  
  // Prioritize entities based on mood context
  // For negative moods, prioritize entities associated with positive experiences
  const sortedEntities = [...entities].sort((a, b) => {
    if (isNegativeMood) {
      // For negative moods, prefer entities with positive mood associations
      const aPositive = a.moodColors.filter(c => c === '초록색' || c === '노란색').length;
      const bPositive = b.moodColors.filter(c => c === '초록색' || c === '노란색').length;
      if (aPositive !== bPositive) {
        return bPositive - aPositive;
      }
    }
    return b.frequency - a.frequency;
  });

  for (const entity of sortedEntities) {
    if (suggestions.length >= maxSuggestions) {
      break;
    }

    // Skip if we've already used this entity
    if (usedEntities.has(entity.value)) {
      continue;
    }

    // Get appropriate templates based on entity type and mood
    const templates = SUGGESTION_TEMPLATES[entity.type];
    const moodContext = isNegativeMood ? 'negative' : getMoodContext(entity.moodColors);
    const templateList = templates[moodContext];

    // Select a template (rotate through templates based on suggestion count)
    const template = templateList[suggestions.length % templateList.length];
    
    // Generate suggestion text
    const suggestionText = template.replace('{entity}', entity.value);

    suggestions.push({
      suggestion: suggestionText,
      basedOn: [entity],
      diaryIds: entity.diaryIds,
      moodContext: moodContext,
    });

    usedEntities.add(entity.value);
  }

  return suggestions;
}

/**
 * Checks if a suggestion contains at least one entity from the user's diary entries
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 * @param suggestion - The suggestion to validate
 * @param diaries - The user's diary entries
 * @returns True if the suggestion contains a user-specific entity
 */
export function isPersonalizedSuggestion(
  suggestion: PersonalizedSuggestion,
  diaries: DiarySearchResult[]
): boolean {
  if (suggestion.basedOn.length === 0) {
    return false;
  }

  // Check that at least one entity in the suggestion appears in the user's diaries
  for (const entity of suggestion.basedOn) {
    for (const diary of diaries) {
      if (diary.content.toLowerCase().includes(entity.value.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Generates suggestions for negative emotional patterns
 * Validates: Requirements 7.1
 * @param diaries - Array of diary entries with negative mood colors
 * @returns Array of personalized suggestions
 */
export function generateSuggestionsForNegativePatterns(
  diaries: DiarySearchResult[]
): PersonalizedSuggestion[] {
  // Filter to get diaries with positive moods to find what made the user happy
  const positiveDiaries = diaries.filter(d => 
    d.color === '초록색' || d.color === '노란색'
  );

  // If user has positive experiences, suggest based on those
  if (positiveDiaries.length > 0) {
    return generatePersonalizedSuggestions(positiveDiaries, '빨간색', 3);
  }

  // Otherwise, generate suggestions from all diaries
  return generatePersonalizedSuggestions(diaries, '빨간색', 3);
}
