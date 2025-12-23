/**
 * Reranker Service for Mudita Bot
 * Uses LLM to rerank retrieved diary entries based on relevance to the query
 * Improves RAG quality by selecting the most contextually relevant diaries
 */

import OpenAI from 'openai';
import { DiarySearchResult } from './embedding.service';

// Reranker configuration
const RERANKER_MODEL = 'gpt-4o-mini';
const MAX_DIARIES_TO_RERANK = 10;
const TOP_K_AFTER_RERANK = 3;

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

export interface RerankResult {
  diary: DiarySearchResult;
  relevanceScore: number;
  reason: string;
}

export interface RerankResponse {
  rankings: Array<{
    diaryId: number;
    relevanceScore: number;
    reason: string;
  }>;
}

/**
 * Reranks diary entries based on their relevance to the user's query
 * Uses LLM to evaluate contextual relevance beyond vector similarity
 * 
 * @param query - The user's query
 * @param diaries - Retrieved diary entries from vector search
 * @param topK - Number of top results to return after reranking
 * @returns Reranked diary entries with relevance scores
 */
export async function rerankDiaries(
  query: string,
  diaries: DiarySearchResult[],
  topK: number = TOP_K_AFTER_RERANK
): Promise<RerankResult[]> {
  // Skip reranking if too few diaries
  if (diaries.length <= topK) {
    return diaries.map(diary => ({
      diary,
      relevanceScore: diary.score,
      reason: 'Vector similarity score',
    }));
  }

  // Limit diaries to rerank for cost efficiency
  const diariesToRerank = diaries.slice(0, MAX_DIARIES_TO_RERANK);

  try {
    const openai = getOpenAIClient();

    // Build diary summaries for the prompt
    const diarySummaries = diariesToRerank.map((diary, index) => {
      const dateStr = diary.date instanceof Date
        ? diary.date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
        : new Date(diary.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
      
      // Truncate content for efficiency
      const truncatedContent = diary.content.length > 300
        ? diary.content.slice(0, 300) + '...'
        : diary.content;

      return `[일기 ${diary.diary_id}] ${dateStr}
제목: ${diary.title}
감정: ${diary.color}
내용: ${truncatedContent}`;
    }).join('\n\n');

    const response = await openai.chat.completions.create({
      model: RERANKER_MODEL,
      messages: [
        {
          role: 'system',
          content: `당신은 일기 관련성 평가 전문가입니다. 사용자의 질문과 일기 내용을 비교하여 관련성을 평가합니다.

## 평가 기준
1. **직접적 관련성** (가장 중요): 질문에서 언급된 주제, 감정, 상황이 일기에 직접 나타나는가?
2. **시간적 관련성**: 질문이 특정 시간대를 언급하면 해당 시간대의 일기가 더 관련성 높음
3. **감정적 관련성**: 질문의 감정 톤과 일기의 감정이 일치하는가?
4. **맥락적 관련성**: 질문의 맥락에서 유용한 정보를 제공하는가?

## 점수 기준
- 9-10: 질문에 직접적으로 답할 수 있는 핵심 정보 포함
- 7-8: 관련성 높고 유용한 맥락 제공
- 5-6: 부분적으로 관련됨
- 3-4: 약간의 관련성만 있음
- 1-2: 거의 관련 없음`
        },
        {
          role: 'user',
          content: `사용자 질문: "${query}"

다음 일기들의 관련성을 평가해주세요:

${diarySummaries}

각 일기에 대해 1-10점 사이의 관련성 점수와 간단한 이유를 JSON 형식으로 응답해주세요.`
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'rerank_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              rankings: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    diaryId: {
                      type: 'number',
                      description: '일기 ID'
                    },
                    relevanceScore: {
                      type: 'number',
                      description: '관련성 점수 (1-10)'
                    },
                    reason: {
                      type: 'string',
                      description: '점수 부여 이유 (한 문장)'
                    }
                  },
                  required: ['diaryId', 'relevanceScore', 'reason'],
                  additionalProperties: false
                }
              }
            },
            required: ['rankings'],
            additionalProperties: false
          }
        }
      },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn('[Reranker] Empty response, falling back to vector scores');
      return diaries.slice(0, topK).map(diary => ({
        diary,
        relevanceScore: diary.score,
        reason: 'Fallback to vector similarity',
      }));
    }

    const rerankResponse: RerankResponse = JSON.parse(content);

    // Create a map of diary_id to ranking info
    const rankingMap = new Map<number, { score: number; reason: string }>();
    for (const ranking of rerankResponse.rankings) {
      rankingMap.set(ranking.diaryId, {
        score: ranking.relevanceScore / 10, // Normalize to 0-1
        reason: ranking.reason,
      });
    }

    // Combine with original diaries and sort by reranked score
    const rerankedResults: RerankResult[] = diariesToRerank.map(diary => {
      const ranking = rankingMap.get(diary.diary_id);
      return {
        diary,
        relevanceScore: ranking?.score ?? diary.score,
        reason: ranking?.reason ?? 'No ranking provided',
      };
    });

    // Sort by relevance score descending
    rerankedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log(`[Reranker] Reranked ${diariesToRerank.length} diaries, top scores: ${
      rerankedResults.slice(0, 3).map(r => r.relevanceScore.toFixed(2)).join(', ')
    }`);

    return rerankedResults.slice(0, topK);
  } catch (error) {
    console.error('[Reranker] Error:', error);
    // Fallback to original vector similarity scores
    return diaries.slice(0, topK).map(diary => ({
      diary,
      relevanceScore: diary.score,
      reason: 'Fallback due to reranker error',
    }));
  }
}

/**
 * Lightweight reranking using keyword matching and heuristics
 * Use this for faster reranking when LLM call is not needed
 * 
 * @param query - The user's query
 * @param diaries - Retrieved diary entries
 * @param topK - Number of top results to return
 * @returns Reranked diary entries
 */
export function rerankDiariesFast(
  query: string,
  diaries: DiarySearchResult[],
  topK: number = TOP_K_AFTER_RERANK
): RerankResult[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 2);

  const scored = diaries.map(diary => {
    let bonusScore = 0;
    const contentLower = diary.content.toLowerCase();
    const titleLower = diary.title.toLowerCase();

    // Keyword matching bonus
    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        bonusScore += 0.15; // Title match is more important
      }
      if (contentLower.includes(word)) {
        bonusScore += 0.05;
      }
    }

    // Recency bonus (more recent = slightly higher score)
    const diaryDate = diary.date instanceof Date ? diary.date : new Date(diary.date);
    const daysSinceEntry = (Date.now() - diaryDate.getTime()) / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 0.1 - (daysSinceEntry / 365) * 0.1);

    // Mood keyword matching
    const moodKeywords: Record<string, string[]> = {
      '빨간색': ['화나', '짜증', '스트레스', '불안', '걱정'],
      '노란색': ['행복', '기쁨', '즐거', '신나', '좋았'],
      '파란색': ['슬프', '우울', '힘들', '지치', '피곤'],
      '초록색': ['평온', '편안', '차분', '만족', '평화'],
    };

    const moodWords = moodKeywords[diary.color] || [];
    for (const moodWord of moodWords) {
      if (queryLower.includes(moodWord)) {
        bonusScore += 0.1;
        break;
      }
    }

    const finalScore = Math.min(1, diary.score + bonusScore + recencyBonus);

    return {
      diary,
      relevanceScore: finalScore,
      reason: `Vector: ${diary.score.toFixed(2)}, Bonus: ${bonusScore.toFixed(2)}`,
    };
  });

  // Sort by final score
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return scored.slice(0, topK);
}

/**
 * Determines whether to use LLM reranking or fast reranking
 * Based on query complexity and number of results
 * 
 * @param query - The user's query
 * @param diaryCount - Number of diaries to rerank
 * @returns true if LLM reranking should be used
 */
export function shouldUseLLMReranking(query: string, diaryCount: number): boolean {
  // Use LLM reranking for:
  // 1. Complex queries (longer than 20 chars)
  // 2. When there are many results to choose from (> 5)
  // 3. Queries with emotional or temporal context
  
  const isComplexQuery = query.length > 20;
  const hasManyResults = diaryCount > 5;
  const hasEmotionalContext = /기분|감정|느낌|행복|슬프|화나|우울|스트레스/.test(query);
  const hasTemporalContext = /지난|최근|요즘|어제|오늘|이번|저번/.test(query);

  return (isComplexQuery && hasManyResults) || hasEmotionalContext || hasTemporalContext;
}
