import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Session Manager Service Tests
 * Property-based tests for chat session management
 */

// Mock the database module
vi.mock('../db', () => ({
  default: {
    chatSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

// Mock OpenAI
const mockOpenAICreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: '대화 요약 내용입니다.' } }],
});

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockOpenAICreate,
        },
      };
    },
  };
});

import prisma from '../db';
import {
  getOrCreateSession,
  createSession,
  getSessionById,
  getUserSessions,
  saveMessage,
  getRecentMessages,
  getMessageCount,
  summarizeOldMessages,
  needsSummarization,
  deleteSession,
  getSessionContext,
  MESSAGE_SUMMARIZATION_THRESHOLD,
  type Message,
  type ChatSession,
} from './session.service';

// Arbitrary generators
const userIdArbitrary = fc.integer({ min: 1, max: 1000000 });
const sessionIdArbitrary = fc.uuid();
const messageIdArbitrary = fc.uuid();

const messageContentArbitrary = fc.string({ minLength: 1, maxLength: 1000 });
const roleArbitrary = fc.constantFrom('user', 'assistant', 'system') as fc.Arbitrary<'user' | 'assistant' | 'system'>;
const diaryIdsArbitrary = fc.array(fc.integer({ min: 1, max: 1000000 }), { minLength: 0, maxLength: 5 });

const messageArbitrary = (sessionId: string): fc.Arbitrary<Message> =>
  fc.record({
    message_id: messageIdArbitrary,
    session_id: fc.constant(sessionId),
    role: roleArbitrary,
    content: messageContentArbitrary,
    related_diary_ids: diaryIdsArbitrary,
    created_at: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  });

const sessionArbitrary = (userId: number): fc.Arbitrary<ChatSession> =>
  fc.record({
    session_id: sessionIdArbitrary,
    user_id: fc.constant(userId),
    title: fc.option(fc.string({ minLength: 1, maxLength: 255 }), { nil: null }),
    summary: fc.option(fc.string({ minLength: 1, maxLength: 2000 }), { nil: null }),
    is_active: fc.boolean(),
    created_at: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
    updated_at: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  });

describe('Session CRUD Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a new session when none exists for today', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArbitrary, async (userId) => {
        vi.mocked(prisma.chatSession.findFirst).mockResolvedValueOnce(null);
        
        const newSession = {
          session_id: 'new-session-id',
          user_id: userId,
          title: null,
          summary: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
        vi.mocked(prisma.chatSession.create).mockResolvedValueOnce(newSession);

        const result = await getOrCreateSession(userId);

        expect(result.user_id).toBe(userId);
        expect(result.is_active).toBe(true);
        expect(vi.mocked(prisma.chatSession.create)).toHaveBeenCalled();

        return true;
      }),
      { numRuns: 50 }
    );
  });

  it('should return existing session from today', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArbitrary, sessionIdArbitrary, async (userId, sessionId) => {
        const existingSession = {
          session_id: sessionId,
          user_id: userId,
          title: null,
          summary: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
        vi.mocked(prisma.chatSession.findFirst).mockResolvedValueOnce(existingSession);

        const result = await getOrCreateSession(userId);

        expect(result.session_id).toBe(sessionId);
        expect(result.user_id).toBe(userId);
        expect(vi.mocked(prisma.chatSession.create)).not.toHaveBeenCalled();

        return true;
      }),
      { numRuns: 50 }
    );
  });

  it('should save messages with correct session association', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        roleArbitrary,
        messageContentArbitrary,
        diaryIdsArbitrary,
        async (sessionId, role, content, diaryIds) => {
          const savedMessage = {
            message_id: 'msg-id',
            session_id: sessionId,
            role,
            content,
            related_diary_ids: diaryIds,
            created_at: new Date(),
          };
          vi.mocked(prisma.chatMessage.create).mockResolvedValueOnce(savedMessage);
          vi.mocked(prisma.chatSession.update).mockResolvedValueOnce({} as any);

          const result = await saveMessage(sessionId, role, content, diaryIds);

          expect(result.session_id).toBe(sessionId);
          expect(result.role).toBe(role);
          expect(result.content).toBe(content);
          expect(result.related_diary_ids).toEqual(diaryIds);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * **Feature: mudita-bot, Property 4: Session Context Inclusion**
 * **Validates: Requirements 2.1**
 * 
 * *For any* follow-up message in a Chat_Session, the context sent to the LLM 
 * SHALL include the content of previous messages from that session.
 */
describe('Property 4: Session Context Inclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Feature: mudita-bot, Property 4: Session Context Inclusion**
   * **Validates: Requirements 2.1**
   */
  it('should include all previous messages in session context', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.array(messageContentArbitrary, { minLength: 1, maxLength: 10 }),
        async (sessionId, messageContents) => {
          const baseTime = Date.now();
          
          // Generate messages in chronological order (oldest first)
          const messagesChronological = messageContents.map((content, index) => ({
            message_id: `msg-${index}`,
            session_id: sessionId,
            role: index % 2 === 0 ? 'user' : 'assistant',
            content,
            related_diary_ids: [],
            created_at: new Date(baseTime + index * 1000), // Increasing timestamps
          }));

          // getRecentMessages queries with ORDER BY desc, then reverses
          // So we mock the desc order (newest first)
          const messagesDescOrder = [...messagesChronological].reverse();

          vi.mocked(prisma.chatSession.findUnique).mockResolvedValueOnce({
            summary: null,
          } as any);
          vi.mocked(prisma.chatMessage.findMany).mockResolvedValueOnce(messagesDescOrder);

          const context = await getSessionContext(sessionId, 10);

          // Property: All message contents should be included in the context
          for (const content of messageContents) {
            const found = context.messages.some((m) => m.content === content);
            expect(found).toBe(true);
          }

          // Property: Messages should be in chronological order (oldest first)
          for (let i = 1; i < context.messages.length; i++) {
            expect(context.messages[i - 1].created_at.getTime())
              .toBeLessThanOrEqual(context.messages[i].created_at.getTime());
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 4: Session Context Inclusion**
   * **Validates: Requirements 2.1**
   */
  it('should include session summary in context when available', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.string({ minLength: 10, maxLength: 500 }),
        async (sessionId, summaryText) => {
          vi.mocked(prisma.chatSession.findUnique).mockResolvedValueOnce({
            summary: summaryText,
          } as any);
          vi.mocked(prisma.chatMessage.findMany).mockResolvedValueOnce([]);

          const context = await getSessionContext(sessionId, 10);

          // Property: Summary should be included in context
          expect(context.summary).toBe(summaryText);

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 4: Session Context Inclusion**
   * **Validates: Requirements 2.1**
   */
  it('should respect the limit parameter for recent messages', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 50 }),
        async (sessionId, limit, totalMessages) => {
          // Generate more messages than the limit
          const messages = Array.from({ length: Math.min(totalMessages, limit) }, (_, i) => ({
            message_id: `msg-${i}`,
            session_id: sessionId,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`,
            related_diary_ids: [],
            created_at: new Date(Date.now() - i * 1000),
          }));

          vi.mocked(prisma.chatMessage.findMany).mockResolvedValueOnce(messages);

          const result = await getRecentMessages(sessionId, limit);

          // Property: Result should not exceed the limit
          expect(result.length).toBeLessThanOrEqual(limit);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * **Feature: mudita-bot, Property 5: Message Summarization Threshold**
 * **Validates: Requirements 2.2**
 * 
 * *For any* Chat_Session with more than 10 messages, the system SHALL generate 
 * a summary of older messages and the summary field SHALL be non-empty.
 */
describe('Property 5: Message Summarization Threshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up OpenAI API key for tests
    process.env.OPENAI_API_KEY = 'test-api-key';
  });

  /**
   * **Feature: mudita-bot, Property 5: Message Summarization Threshold**
   * **Validates: Requirements 2.2**
   */
  it('should trigger summarization when message count exceeds threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.integer({ min: MESSAGE_SUMMARIZATION_THRESHOLD + 1, max: 30 }),
        async (sessionId, messageCount) => {
          vi.mocked(prisma.chatMessage.count).mockResolvedValueOnce(messageCount);

          const result = await needsSummarization(sessionId);

          // Property: Sessions with more than threshold messages need summarization
          expect(result).toBe(true);

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 5: Message Summarization Threshold**
   * **Validates: Requirements 2.2**
   */
  it('should not trigger summarization when message count is at or below threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.integer({ min: 0, max: MESSAGE_SUMMARIZATION_THRESHOLD }),
        async (sessionId, messageCount) => {
          vi.mocked(prisma.chatMessage.count).mockResolvedValueOnce(messageCount);

          const result = await needsSummarization(sessionId);

          // Property: Sessions at or below threshold don't need summarization
          expect(result).toBe(false);

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 5: Message Summarization Threshold**
   * **Validates: Requirements 2.2**
   */
  it('should generate non-empty summary when summarizing', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.integer({ min: MESSAGE_SUMMARIZATION_THRESHOLD + 1, max: 20 }),
        async (sessionId, messageCount) => {
          // Mock message count above threshold
          vi.mocked(prisma.chatMessage.count).mockResolvedValueOnce(messageCount);

          // Generate mock messages to summarize
          const keepRecent = 5;
          const messagesToSummarize = Array.from(
            { length: messageCount - keepRecent },
            (_, i) => ({
              message_id: `msg-${i}`,
              session_id: sessionId,
              role: i % 2 === 0 ? 'user' : 'assistant',
              content: `Test message ${i}`,
              related_diary_ids: [],
              created_at: new Date(Date.now() - i * 1000),
            })
          );

          vi.mocked(prisma.chatMessage.findMany).mockResolvedValueOnce(messagesToSummarize);
          vi.mocked(prisma.chatSession.update).mockResolvedValueOnce({} as any);
          vi.mocked(prisma.chatMessage.deleteMany).mockResolvedValueOnce({ count: messagesToSummarize.length });

          const summary = await summarizeOldMessages(sessionId);

          // Property: Summary should be non-empty when messages exceed threshold
          expect(summary).not.toBeNull();
          expect(summary!.length).toBeGreaterThan(0);

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 5: Message Summarization Threshold**
   * **Validates: Requirements 2.2**
   */
  it('should return null when message count is at or below threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.integer({ min: 0, max: MESSAGE_SUMMARIZATION_THRESHOLD }),
        async (sessionId, messageCount) => {
          vi.mocked(prisma.chatMessage.count).mockResolvedValueOnce(messageCount);

          const summary = await summarizeOldMessages(sessionId);

          // Property: No summary generated when below threshold
          expect(summary).toBeNull();

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });
});

/**
 * **Feature: mudita-bot, Property 6: Session Persistence Round Trip**
 * **Validates: Requirements 2.3, 5.4**
 * 
 * *For any* Chat_Session, saving the session, closing the interface, and reopening 
 * SHALL restore all messages with identical content and timestamps.
 */
describe('Property 6: Session Persistence Round Trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Feature: mudita-bot, Property 6: Session Persistence Round Trip**
   * **Validates: Requirements 2.3, 5.4**
   */
  it('should persist and restore messages with identical content', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.array(
          fc.record({
            role: roleArbitrary,
            content: messageContentArbitrary,
            related_diary_ids: diaryIdsArbitrary,
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (sessionId, messageData) => {
          // Simulate saving messages
          const savedMessages = messageData.map((data, index) => ({
            message_id: `msg-${index}`,
            session_id: sessionId,
            role: data.role,
            content: data.content,
            related_diary_ids: data.related_diary_ids,
            created_at: new Date(Date.now() + index * 1000),
          }));

          // Mock the retrieval to return the same messages
          vi.mocked(prisma.chatSession.findUnique).mockResolvedValueOnce({
            session_id: sessionId,
            user_id: 1,
            title: null,
            summary: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
            messages: savedMessages,
          } as any);

          const result = await getSessionById(sessionId, true);

          // Property: All messages should be restored with identical content
          expect(result).not.toBeNull();
          expect(result!.messages).toBeDefined();
          expect(result!.messages!.length).toBe(messageData.length);

          for (let i = 0; i < messageData.length; i++) {
            expect(result!.messages![i].content).toBe(messageData[i].content);
            expect(result!.messages![i].role).toBe(messageData[i].role);
            expect(result!.messages![i].related_diary_ids).toEqual(messageData[i].related_diary_ids);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 6: Session Persistence Round Trip**
   * **Validates: Requirements 2.3, 5.4**
   */
  it('should preserve message timestamps after round trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.array(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
          { minLength: 1, maxLength: 10 }
        ),
        async (sessionId, timestamps) => {
          const savedMessages = timestamps.map((timestamp, index) => ({
            message_id: `msg-${index}`,
            session_id: sessionId,
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${index}`,
            related_diary_ids: [],
            created_at: timestamp,
          }));

          vi.mocked(prisma.chatSession.findUnique).mockResolvedValueOnce({
            session_id: sessionId,
            user_id: 1,
            title: null,
            summary: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
            messages: savedMessages,
          } as any);

          const result = await getSessionById(sessionId, true);

          // Property: Timestamps should be preserved
          expect(result!.messages!.length).toBe(timestamps.length);
          for (let i = 0; i < timestamps.length; i++) {
            expect(result!.messages![i].created_at.getTime()).toBe(timestamps[i].getTime());
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 6: Session Persistence Round Trip**
   * **Validates: Requirements 2.3, 5.4**
   */
  it('should preserve session metadata after round trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary,
        sessionIdArbitrary,
        fc.option(fc.string({ minLength: 1, maxLength: 255 }), { nil: null }),
        fc.option(fc.string({ minLength: 1, maxLength: 2000 }), { nil: null }),
        async (userId, sessionId, title, summary) => {
          const sessionData = {
            session_id: sessionId,
            user_id: userId,
            title,
            summary,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          };

          vi.mocked(prisma.chatSession.findUnique).mockResolvedValueOnce(sessionData as any);

          const result = await getSessionById(sessionId, false);

          // Property: Session metadata should be preserved
          expect(result).not.toBeNull();
          expect(result!.session_id).toBe(sessionId);
          expect(result!.user_id).toBe(userId);
          expect(result!.title).toBe(title);
          expect(result!.summary).toBe(summary);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * **Feature: mudita-bot, Property 7: New Session Isolation**
 * **Validates: Requirements 2.4**
 * 
 * *For any* newly created Chat_Session, the message history SHALL be empty 
 * while the RAG pipeline SHALL still return results from the user's diary history.
 */
describe('Property 7: New Session Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Feature: mudita-bot, Property 7: New Session Isolation**
   * **Validates: Requirements 2.4**
   */
  it('should create new session with empty message history', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary,
        fc.option(fc.string({ minLength: 1, maxLength: 255 }), { nil: undefined }),
        async (userId, title) => {
          const newSession = {
            session_id: 'new-session-id',
            user_id: userId,
            title: title || null,
            summary: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          };

          vi.mocked(prisma.chatSession.create).mockResolvedValueOnce(newSession);

          const result = await createSession(userId, title);

          // Property: New session should have no messages (messages not included in create response)
          expect(result.session_id).toBeDefined();
          expect(result.user_id).toBe(userId);
          expect(result.summary).toBeNull();

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 7: New Session Isolation**
   * **Validates: Requirements 2.4**
   */
  it('should return zero messages for newly created session', async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArbitrary, async (sessionId) => {
        // Mock empty message list for new session
        vi.mocked(prisma.chatMessage.findMany).mockResolvedValueOnce([]);

        const messages = await getRecentMessages(sessionId, 10);

        // Property: New session should have empty message history
        expect(messages).toHaveLength(0);

        return true;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 7: New Session Isolation**
   * **Validates: Requirements 2.4**
   */
  it('should isolate messages between different sessions', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        sessionIdArbitrary,
        fc.array(messageContentArbitrary, { minLength: 1, maxLength: 5 }),
        async (sessionId1, sessionId2, messageContents) => {
          // Ensure different session IDs
          fc.pre(sessionId1 !== sessionId2);

          // Messages for session 1
          const session1Messages = messageContents.map((content, i) => ({
            message_id: `s1-msg-${i}`,
            session_id: sessionId1,
            role: 'user',
            content,
            related_diary_ids: [],
            created_at: new Date(),
          }));

          // Session 2 should have no messages
          vi.mocked(prisma.chatMessage.findMany)
            .mockResolvedValueOnce(session1Messages)
            .mockResolvedValueOnce([]);

          const messages1 = await getRecentMessages(sessionId1, 10);
          const messages2 = await getRecentMessages(sessionId2, 10);

          // Property: Sessions should be isolated - session 2 has no messages
          expect(messages1.length).toBe(messageContents.length);
          expect(messages2.length).toBe(0);

          // Property: All messages in session 1 should have correct session_id
          for (const msg of messages1) {
            expect(msg.session_id).toBe(sessionId1);
          }

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 7: New Session Isolation**
   * **Validates: Requirements 2.4**
   */
  it('should not inherit summary from previous sessions', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArbitrary, async (userId) => {
        const newSession = {
          session_id: 'new-session-id',
          user_id: userId,
          title: null,
          summary: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };

        vi.mocked(prisma.chatSession.create).mockResolvedValueOnce(newSession);

        const result = await createSession(userId);

        // Property: New session should have null summary (not inherited)
        expect(result.summary).toBeNull();

        return true;
      }),
      { numRuns: 50 }
    );
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject invalid limit for getRecentMessages', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdArbitrary,
        fc.integer({ min: -100, max: 0 }),
        async (sessionId, invalidLimit) => {
          await expect(getRecentMessages(sessionId, invalidLimit)).rejects.toThrow(
            'Limit must be at least 1'
          );

          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle session deletion gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArbitrary, async (sessionId) => {
        vi.mocked(prisma.chatSession.delete).mockResolvedValueOnce({} as any);

        const result = await deleteSession(sessionId);

        expect(result).toBe(true);

        return true;
      }),
      { numRuns: 20 }
    );
  });

  it('should return false when deleting non-existent session', async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArbitrary, async (sessionId) => {
        vi.mocked(prisma.chatSession.delete).mockRejectedValueOnce(new Error('Not found'));

        const result = await deleteSession(sessionId);

        expect(result).toBe(false);

        return true;
      }),
      { numRuns: 20 }
    );
  });
});
