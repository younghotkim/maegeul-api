/**
 * Session Manager Service for Mudita Bot
 * Handles chat session CRUD operations and message management
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

import prisma from '../db';
import OpenAI from 'openai';

// Message summarization configuration
const SUMMARIZATION_THRESHOLD = 10;
const SUMMARY_MODEL = 'gpt-4o-mini';
const SUMMARY_MAX_TOKENS = 500;

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

export interface Message {
  message_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  related_diary_ids: number[];
  created_at: Date;
}

export interface ChatSession {
  session_id: string;
  user_id: number;
  title: string | null;
  summary: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  messages?: Message[];
}

/**
 * Gets an existing session from today or creates a new one for the user
 * Validates: Requirements 2.1, 2.4, 5.3
 * @param userId - The authenticated user's ID
 * @returns The chat session (existing from today or newly created)
 */
export async function getOrCreateSession(userId: number): Promise<ChatSession> {
  // Get the start of today (midnight)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Try to find an existing active session from today
  const existingSession = await prisma.chatSession.findFirst({
    where: {
      user_id: userId,
      is_active: true,
      created_at: {
        gte: today,
      },
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  if (existingSession) {
    return {
      session_id: existingSession.session_id,
      user_id: existingSession.user_id,
      title: existingSession.title,
      summary: existingSession.summary,
      is_active: existingSession.is_active,
      created_at: existingSession.created_at,
      updated_at: existingSession.updated_at,
    };
  }

  // Create a new session
  const newSession = await prisma.chatSession.create({
    data: {
      user_id: userId,
      title: null,
      is_active: true,
    },
  });

  return {
    session_id: newSession.session_id,
    user_id: newSession.user_id,
    title: newSession.title,
    summary: newSession.summary,
    is_active: newSession.is_active,
    created_at: newSession.created_at,
    updated_at: newSession.updated_at,
  };
}

/**
 * Creates a new chat session for the user
 * Validates: Requirements 2.4
 * @param userId - The authenticated user's ID
 * @param title - Optional title for the session
 * @returns The newly created chat session
 */
export async function createSession(userId: number, title?: string): Promise<ChatSession> {
  const session = await prisma.chatSession.create({
    data: {
      user_id: userId,
      title: title || null,
      is_active: true,
    },
  });

  return {
    session_id: session.session_id,
    user_id: session.user_id,
    title: session.title,
    summary: session.summary,
    is_active: session.is_active,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

/**
 * Gets a session by ID with optional message loading
 * Validates: Requirements 2.3
 * @param sessionId - The session ID
 * @param includeMessages - Whether to include messages
 * @returns The chat session or null if not found
 */
export async function getSessionById(
  sessionId: string,
  includeMessages: boolean = false
): Promise<ChatSession | null> {
  const session = await prisma.chatSession.findUnique({
    where: { session_id: sessionId },
    include: includeMessages ? { messages: { orderBy: { created_at: 'asc' } } } : undefined,
  });

  if (!session) {
    return null;
  }

  return {
    session_id: session.session_id,
    user_id: session.user_id,
    title: session.title,
    summary: session.summary,
    is_active: session.is_active,
    created_at: session.created_at,
    updated_at: session.updated_at,
    messages: includeMessages
      ? session.messages?.map((m) => ({
          message_id: m.message_id,
          session_id: m.session_id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          related_diary_ids: m.related_diary_ids,
          created_at: m.created_at,
        }))
      : undefined,
  };
}

/**
 * Gets all sessions for a user
 * Validates: Requirements 2.3
 * @param userId - The authenticated user's ID
 * @returns Array of chat sessions
 */
export async function getUserSessions(userId: number): Promise<ChatSession[]> {
  const sessions = await prisma.chatSession.findMany({
    where: { user_id: userId },
    orderBy: { updated_at: 'desc' },
  });

  return sessions.map((s) => ({
    session_id: s.session_id,
    user_id: s.user_id,
    title: s.title,
    summary: s.summary,
    is_active: s.is_active,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
}

/**
 * Saves a message to a chat session
 * Validates: Requirements 2.1, 2.3
 * @param sessionId - The session ID
 * @param role - The message role (user, assistant, or system)
 * @param content - The message content
 * @param relatedDiaryIds - Optional array of related diary IDs
 * @returns The saved message
 */
export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  relatedDiaryIds: number[] = []
): Promise<Message> {
  const message = await prisma.chatMessage.create({
    data: {
      session_id: sessionId,
      role,
      content,
      related_diary_ids: relatedDiaryIds,
    },
  });

  // Update session's updated_at timestamp
  await prisma.chatSession.update({
    where: { session_id: sessionId },
    data: { updated_at: new Date() },
  });

  return {
    message_id: message.message_id,
    session_id: message.session_id,
    role: message.role as 'user' | 'assistant' | 'system',
    content: message.content,
    related_diary_ids: message.related_diary_ids,
    created_at: message.created_at,
  };
}

/**
 * Gets recent messages from a session with a limit
 * Validates: Requirements 2.1
 * @param sessionId - The session ID
 * @param limit - Maximum number of messages to return
 * @returns Array of recent messages (oldest first)
 */
export async function getRecentMessages(sessionId: string, limit: number): Promise<Message[]> {
  if (limit < 1) {
    throw new Error('Limit must be at least 1');
  }

  // Get the most recent messages, then reverse to get chronological order
  const messages = await prisma.chatMessage.findMany({
    where: { session_id: sessionId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

  // Reverse to get chronological order (oldest first)
  return messages.reverse().map((m) => ({
    message_id: m.message_id,
    session_id: m.session_id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    related_diary_ids: m.related_diary_ids,
    created_at: m.created_at,
  }));
}

/**
 * Gets the total message count for a session
 * @param sessionId - The session ID
 * @returns The number of messages in the session
 */
export async function getMessageCount(sessionId: string): Promise<number> {
  return prisma.chatMessage.count({
    where: { session_id: sessionId },
  });
}

/**
 * Summarizes old messages in a session when the message count exceeds the threshold
 * Validates: Requirements 2.2
 * @param sessionId - The session ID
 * @returns The generated summary or null if summarization wasn't needed
 */
export async function summarizeOldMessages(sessionId: string): Promise<string | null> {
  const messageCount = await getMessageCount(sessionId);

  // Only summarize if we exceed the threshold
  if (messageCount <= SUMMARIZATION_THRESHOLD) {
    return null;
  }

  // Get all messages except the most recent ones (keep last 5 for context)
  const keepRecent = 5;
  const messagesToSummarize = await prisma.chatMessage.findMany({
    where: { session_id: sessionId },
    orderBy: { created_at: 'asc' },
    take: messageCount - keepRecent,
  });

  if (messagesToSummarize.length === 0) {
    return null;
  }

  // Format messages for summarization
  const conversationText = messagesToSummarize
    .map((m) => {
      const role = m.role === 'user' ? '사용자' : m.role === 'assistant' ? '무디타' : '시스템';
      return `${role}: ${m.content}`;
    })
    .join('\n');

  // Generate summary using LLM
  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: SUMMARY_MODEL,
    messages: [
      {
        role: 'system',
        content: `당신은 대화 요약 전문가입니다. 다음 대화 내용을 간결하게 요약해주세요.
요약 시 다음 사항을 포함해주세요:
- 사용자가 언급한 주요 감정이나 상태
- 논의된 주요 주제
- 무디타가 제공한 주요 조언이나 공감 포인트
요약은 한국어로 작성하고, 3-5문장으로 간결하게 작성해주세요.`,
      },
      {
        role: 'user',
        content: conversationText,
      },
    ],
    temperature: 0.3,
    max_tokens: SUMMARY_MAX_TOKENS,
  });

  const summary = response.choices[0]?.message?.content || '';

  // Update the session with the summary
  await prisma.chatSession.update({
    where: { session_id: sessionId },
    data: { summary },
  });

  // Delete the summarized messages to keep the session lean
  const messageIdsToDelete = messagesToSummarize.map((m) => m.message_id);
  await prisma.chatMessage.deleteMany({
    where: {
      message_id: { in: messageIdsToDelete },
    },
  });

  return summary;
}

/**
 * Checks if a session needs summarization
 * @param sessionId - The session ID
 * @returns True if the session has more than SUMMARIZATION_THRESHOLD messages
 */
export async function needsSummarization(sessionId: string): Promise<boolean> {
  const count = await getMessageCount(sessionId);
  return count > SUMMARIZATION_THRESHOLD;
}

/**
 * Deletes a chat session and all its messages
 * @param sessionId - The session ID
 * @returns True if the session was deleted
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    await prisma.chatSession.delete({
      where: { session_id: sessionId },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deactivates a session (soft delete)
 * @param sessionId - The session ID
 * @returns The updated session or null if not found
 */
export async function deactivateSession(sessionId: string): Promise<ChatSession | null> {
  try {
    const session = await prisma.chatSession.update({
      where: { session_id: sessionId },
      data: { is_active: false },
    });

    return {
      session_id: session.session_id,
      user_id: session.user_id,
      title: session.title,
      summary: session.summary,
      is_active: session.is_active,
      created_at: session.created_at,
      updated_at: session.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Updates a session's title
 * @param sessionId - The session ID
 * @param title - The new title
 * @returns The updated session or null if not found
 */
export async function updateSessionTitle(
  sessionId: string,
  title: string
): Promise<ChatSession | null> {
  try {
    const session = await prisma.chatSession.update({
      where: { session_id: sessionId },
      data: { title },
    });

    return {
      session_id: session.session_id,
      user_id: session.user_id,
      title: session.title,
      summary: session.summary,
      is_active: session.is_active,
      created_at: session.created_at,
      updated_at: session.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Gets the context for LLM including session summary and recent messages
 * Validates: Requirements 2.1, 2.2
 * @param sessionId - The session ID
 * @param recentLimit - Number of recent messages to include
 * @returns Object containing summary and recent messages
 */
export async function getSessionContext(
  sessionId: string,
  recentLimit: number = 10
): Promise<{ summary: string | null; messages: Message[] }> {
  const session = await prisma.chatSession.findUnique({
    where: { session_id: sessionId },
    select: { summary: true },
  });

  const messages = await getRecentMessages(sessionId, recentLimit);

  return {
    summary: session?.summary || null,
    messages,
  };
}

// Export the threshold for testing
export const MESSAGE_SUMMARIZATION_THRESHOLD = SUMMARIZATION_THRESHOLD;
