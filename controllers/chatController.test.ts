/**
 * Chat Controller Tests
 * Property-based tests for streaming response delivery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Request, Response } from 'express';

/**
 * **Feature: mudita-bot, Property 16: Streaming Response Delivery**
 * **Validates: Requirements 8.1**
 * 
 * *For any* LLM response, the client SHALL receive multiple SSE events (not a single block),
 * with each event containing a partial token.
 */

// Mock the session service
vi.mock('../services/session.service', () => ({
  getOrCreateSession: vi.fn(),
  getSessionById: vi.fn(),
  saveMessage: vi.fn(),
  getRecentMessages: vi.fn(),
  needsSummarization: vi.fn(),
  summarizeOldMessages: vi.fn(),
}));

// Mock the RAG service
vi.mock('../services/rag.service', () => ({
  generateRAGResponse: vi.fn(),
}));

import {
  getOrCreateSession,
  getSessionById,
  saveMessage,
  getRecentMessages,
  needsSummarization,
} from '../services/session.service';
import { generateRAGResponse } from '../services/rag.service';
import { sendMessage } from './chatController';

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    userId: 1,
    profileName: 'TestUser',
    body: { message: 'Hello' },
    ...overrides,
  };
}

// Helper to create mock response with SSE tracking
function createMockSSEResponse() {
  const events: string[] = [];
  const tokenEvents: string[] = [];
  let headersSent = false;
  let ended = false;
  
  const res: Partial<Response> = {
    headersSent: false,
    setHeader: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn().mockImplementation(() => {
      headersSent = true;
      (res as any).headersSent = true;
    }),
    write: vi.fn().mockImplementation((data: string) => {
      events.push(data);
      // Extract token events specifically
      if (data.includes('event: token')) {
        tokenEvents.push(data);
      }
      return true;
    }),
    end: vi.fn().mockImplementation(() => {
      ended = true;
    }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  
  return {
    res,
    getEvents: () => events,
    getTokenEvents: () => tokenEvents,
    isHeadersSent: () => headersSent,
    isEnded: () => ended,
  };
}

describe('Streaming Response Delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Feature: mudita-bot, Property 16: Streaming Response Delivery**
   * **Validates: Requirements 8.1**
   * 
   * This test verifies that when the LLM generates a response with multiple tokens,
   * each token is delivered as a separate SSE event.
   */
  it('should deliver multiple SSE token events for multi-token responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate an array of tokens (at least 2 to verify multiple events)
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }),
          { minLength: 2, maxLength: 20 }
        ),
        fc.integer({ min: 1, max: 1000000 }), // userId
        fc.string({ minLength: 1, maxLength: 100 }), // message
        async (tokens, userId, message) => {
          // Reset mocks
          vi.clearAllMocks();
          
          // Setup mock session
          const mockSession = {
            session_id: 'test-session-id',
            user_id: userId,
            title: null,
            summary: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          };
          
          vi.mocked(getOrCreateSession).mockResolvedValueOnce(mockSession);
          vi.mocked(saveMessage).mockResolvedValue({
            message_id: 'msg-1',
            session_id: mockSession.session_id,
            role: 'user',
            content: message,
            related_diary_ids: [],
            created_at: new Date(),
          });
          vi.mocked(getRecentMessages).mockResolvedValueOnce([]);
          vi.mocked(needsSummarization).mockResolvedValueOnce(false);
          
          // Mock generateRAGResponse to call onToken for each token
          vi.mocked(generateRAGResponse).mockImplementationOnce(
            async (uid, msg, history, onToken, userName) => {
              // Simulate streaming by calling onToken for each token
              for (const token of tokens) {
                onToken(token);
              }
              return {
                response: tokens.join(''),
                diaryIds: [],
              };
            }
          );
          
          // Create mock request and response
          const req = createMockRequest({
            userId,
            body: { message },
          }) as Request;
          
          const { res, getTokenEvents, getEvents } = createMockSSEResponse();
          
          // Call the controller
          await sendMessage(req, res as Response);
          
          // Property: Number of token events should equal number of tokens
          const tokenEvents = getTokenEvents();
          expect(tokenEvents.length).toBe(tokens.length);
          
          // Property: Each token event should contain the corresponding token
          for (let i = 0; i < tokens.length; i++) {
            const eventData = tokenEvents[i];
            expect(eventData).toContain('event: token');
            expect(eventData).toContain(tokens[i]);
          }
          
          // Property: Should have session, token events, and done event
          const allEvents = getEvents();
          expect(allEvents.some(e => e.includes('event: session'))).toBe(true);
          expect(allEvents.some(e => e.includes('event: done'))).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 16: Streaming Response Delivery**
   * **Validates: Requirements 8.1**
   * 
   * Verifies that SSE headers are set correctly for streaming.
   */
  it('should set correct SSE headers for streaming', async () => {
    // Setup mocks
    const mockSession = {
      session_id: 'test-session-id',
      user_id: 1,
      title: null,
      summary: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    
    vi.mocked(getOrCreateSession).mockResolvedValueOnce(mockSession);
    vi.mocked(saveMessage).mockResolvedValue({
      message_id: 'msg-1',
      session_id: mockSession.session_id,
      role: 'user',
      content: 'test',
      related_diary_ids: [],
      created_at: new Date(),
    });
    vi.mocked(getRecentMessages).mockResolvedValueOnce([]);
    vi.mocked(needsSummarization).mockResolvedValueOnce(false);
    vi.mocked(generateRAGResponse).mockResolvedValueOnce({
      response: 'Hello!',
      diaryIds: [],
    });
    
    const req = createMockRequest() as Request;
    const { res } = createMockSSEResponse();
    
    await sendMessage(req, res as Response);
    
    // Property: SSE headers must be set correctly
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  /**
   * **Feature: mudita-bot, Property 16: Streaming Response Delivery**
   * **Validates: Requirements 8.1**
   * 
   * Verifies that each SSE event follows the correct format.
   */
  it('should format SSE events correctly with event type and data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }), // Single token
        async (token) => {
          vi.clearAllMocks();
          
          const mockSession = {
            session_id: 'test-session-id',
            user_id: 1,
            title: null,
            summary: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          };
          
          vi.mocked(getOrCreateSession).mockResolvedValueOnce(mockSession);
          vi.mocked(saveMessage).mockResolvedValue({
            message_id: 'msg-1',
            session_id: mockSession.session_id,
            role: 'user',
            content: 'test',
            related_diary_ids: [],
            created_at: new Date(),
          });
          vi.mocked(getRecentMessages).mockResolvedValueOnce([]);
          vi.mocked(needsSummarization).mockResolvedValueOnce(false);
          
          vi.mocked(generateRAGResponse).mockImplementationOnce(
            async (uid, msg, history, onToken) => {
              onToken(token);
              return { response: token, diaryIds: [] };
            }
          );
          
          const req = createMockRequest() as Request;
          const { res, getTokenEvents } = createMockSSEResponse();
          
          await sendMessage(req, res as Response);
          
          const tokenEvents = getTokenEvents();
          expect(tokenEvents.length).toBe(1);
          
          // Property: SSE event format should be "event: <type>\ndata: <json>\n\n"
          const event = tokenEvents[0];
          expect(event).toMatch(/^event: token\ndata: .+\n\n$/);
          
          // Property: Data should be valid JSON containing the token
          const dataMatch = event.match(/data: (.+)\n/);
          expect(dataMatch).not.toBeNull();
          if (dataMatch) {
            const parsed = JSON.parse(dataMatch[1]);
            expect(parsed.token).toBe(token);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: mudita-bot, Property 16: Streaming Response Delivery**
   * **Validates: Requirements 8.1**
   * 
   * Verifies that the stream includes a session event at the start.
   */
  it('should send session event before token events', async () => {
    const mockSession = {
      session_id: 'unique-session-123',
      user_id: 1,
      title: null,
      summary: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    
    vi.mocked(getOrCreateSession).mockResolvedValueOnce(mockSession);
    vi.mocked(saveMessage).mockResolvedValue({
      message_id: 'msg-1',
      session_id: mockSession.session_id,
      role: 'user',
      content: 'test',
      related_diary_ids: [],
      created_at: new Date(),
    });
    vi.mocked(getRecentMessages).mockResolvedValueOnce([]);
    vi.mocked(needsSummarization).mockResolvedValueOnce(false);
    
    vi.mocked(generateRAGResponse).mockImplementationOnce(
      async (uid, msg, history, onToken) => {
        onToken('Hello');
        return { response: 'Hello', diaryIds: [] };
      }
    );
    
    const req = createMockRequest() as Request;
    const { res, getEvents } = createMockSSEResponse();
    
    await sendMessage(req, res as Response);
    
    const events = getEvents();
    
    // Find indices of session and first token event
    const sessionIndex = events.findIndex(e => e.includes('event: session'));
    const firstTokenIndex = events.findIndex(e => e.includes('event: token'));
    
    // Property: Session event should come before token events
    expect(sessionIndex).toBeGreaterThanOrEqual(0);
    expect(firstTokenIndex).toBeGreaterThan(sessionIndex);
    
    // Property: Session event should contain the session_id
    const sessionEvent = events[sessionIndex];
    expect(sessionEvent).toContain(mockSession.session_id);
  });

  /**
   * **Feature: mudita-bot, Property 16: Streaming Response Delivery**
   * **Validates: Requirements 8.1**
   * 
   * Verifies that the stream ends with a done event.
   */
  it('should send done event after all token events', async () => {
    const tokens = ['Hello', ' ', 'World', '!'];
    
    const mockSession = {
      session_id: 'test-session-id',
      user_id: 1,
      title: null,
      summary: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    
    vi.mocked(getOrCreateSession).mockResolvedValueOnce(mockSession);
    vi.mocked(saveMessage).mockResolvedValue({
      message_id: 'msg-1',
      session_id: mockSession.session_id,
      role: 'user',
      content: 'test',
      related_diary_ids: [],
      created_at: new Date(),
    });
    vi.mocked(getRecentMessages).mockResolvedValueOnce([]);
    vi.mocked(needsSummarization).mockResolvedValueOnce(false);
    
    vi.mocked(generateRAGResponse).mockImplementationOnce(
      async (uid, msg, history, onToken) => {
        for (const token of tokens) {
          onToken(token);
        }
        return { response: tokens.join(''), diaryIds: [1, 2] };
      }
    );
    
    const req = createMockRequest() as Request;
    const { res, getEvents } = createMockSSEResponse();
    
    await sendMessage(req, res as Response);
    
    const events = getEvents();
    
    // Find indices
    const lastTokenIndex = events.map((e, i) => e.includes('event: token') ? i : -1)
      .filter(i => i >= 0)
      .pop() ?? -1;
    const doneIndex = events.findIndex(e => e.includes('event: done'));
    
    // Property: Done event should come after all token events
    expect(doneIndex).toBeGreaterThan(lastTokenIndex);
    
    // Property: Done event should contain diary_ids
    const doneEvent = events[doneIndex];
    expect(doneEvent).toContain('diary_ids');
  });
});

describe('Error Handling in Streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when user is not authenticated', async () => {
    const req = createMockRequest({ userId: undefined }) as Request;
    const { res } = createMockSSEResponse();
    
    await sendMessage(req, res as Response);
    
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'NOT_AUTHENTICATED',
    }));
  });

  it('should return 400 when message is empty', async () => {
    const req = createMockRequest({ body: { message: '' } }) as Request;
    const { res } = createMockSSEResponse();
    
    await sendMessage(req, res as Response);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'EMPTY_MESSAGE',
    }));
  });

  it('should return 400 when message is whitespace only', async () => {
    const req = createMockRequest({ body: { message: '   ' } }) as Request;
    const { res } = createMockSSEResponse();
    
    await sendMessage(req, res as Response);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'EMPTY_MESSAGE',
    }));
  });

  it('should send error event when RAG generation fails', async () => {
    const mockSession = {
      session_id: 'test-session-id',
      user_id: 1,
      title: null,
      summary: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    
    vi.mocked(getOrCreateSession).mockResolvedValueOnce(mockSession);
    vi.mocked(saveMessage).mockResolvedValue({
      message_id: 'msg-1',
      session_id: mockSession.session_id,
      role: 'user',
      content: 'test',
      related_diary_ids: [],
      created_at: new Date(),
    });
    vi.mocked(getRecentMessages).mockResolvedValueOnce([]);
    vi.mocked(generateRAGResponse).mockRejectedValueOnce(new Error('LLM API Error'));
    
    const req = createMockRequest() as Request;
    const { res, getEvents } = createMockSSEResponse();
    
    await sendMessage(req, res as Response);
    
    const events = getEvents();
    const errorEvent = events.find(e => e.includes('event: error'));
    
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toContain('LLM API Error');
  });
});
