/**
 * Chat Controller for Mudita Bot
 * Handles chat message endpoints with SSE streaming and session management
 * Validates: Requirements 1.2, 2.3, 2.4, 5.3, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { Request, Response } from 'express';
import {
  getOrCreateSession,
  createSession,
  getSessionById,
  getUserSessions,
  saveMessage,
  getRecentMessages,
  deleteSession,
  needsSummarization,
  summarizeOldMessages,
  getSessionContext,
} from '../services/session.service';
import {
  generateRAGResponse,
  Message as RAGMessage,
} from '../services/rag.service';
import {
  runGuardrails,
  sanitizeOutput,
} from '../services/guardrail.service';

// SSE retry interval in milliseconds
const SSE_RETRY_INTERVAL = 3000;

// Default supportive message for empty responses (Requirement 9.5)
const DEFAULT_SUPPORTIVE_MESSAGE = '지금은 적절한 답변을 드리기 어려워요. 잠시 후 다시 시도해주세요. 💜';

// Prompt for empty message (Requirement 9.4)
const EMPTY_MESSAGE_PROMPT = '무슨 생각을 하고 있어? 편하게 이야기해줘 😊';

/**
 * POST /api/chat/message
 * Send a message and receive a streaming response via SSE
 * Validates: Requirements 1.2, 8.1, 8.2, 9.4, 9.5
 */
export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  const profileName = req.profileName;
  const { message, session_id } = req.body;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return;
  }

  // Handle empty message (Requirement 9.4)
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ 
      error: EMPTY_MESSAGE_PROMPT,
      code: 'EMPTY_MESSAGE' 
    });
    return;
  }

  // Run guardrails on input
  const guardrailResult = runGuardrails(message);
  if (!guardrailResult.isAllowed) {
    // Instead of returning error, stream the guardrail message as a normal response
    try {
      // Get or create session
      let session;
      if (session_id) {
        session = await getSessionById(session_id);
        if (!session || session.user_id !== userId) {
          res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
          return;
        }
      } else {
        session = await getOrCreateSession(userId);
      }

      // Save user message
      await saveMessage(session.session_id, 'user', message.trim());

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Send session info
      res.write(`event: session\ndata: ${JSON.stringify({ session_id: session.session_id })}\n\n`);
      res.write(`retry: ${SSE_RETRY_INTERVAL}\n\n`);

      // Stream the guardrail message
      const guardrailMessage = guardrailResult.reason || '요청을 처리할 수 없어요.';
      for (const char of guardrailMessage) {
        res.write(`event: token\ndata: ${JSON.stringify({ token: char })}\n\n`);
      }

      // Save assistant response
      await saveMessage(session.session_id, 'assistant', guardrailMessage, []);

      // Send completion event
      res.write(`event: done\ndata: ${JSON.stringify({ 
        message_id: session.session_id,
        diary_ids: [],
        action: null
      })}\n\n`);

      res.end();
      return;
    } catch (error: any) {
      console.error('Guardrail response error:', error);
      res.status(500).json({
        error: 'Failed to process message',
        code: 'INTERNAL_ERROR'
      });
      return;
    }
  }

  // Use sanitized input if available
  const sanitizedMessage = guardrailResult.sanitizedInput || message.trim();

  try {
    // Get or create session
    let session;
    if (session_id) {
      session = await getSessionById(session_id);
      if (!session || session.user_id !== userId) {
        res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
        return;
      }
    } else {
      session = await getOrCreateSession(userId);
    }

    // Save user message
    await saveMessage(session.session_id, 'user', sanitizedMessage);

    // Get chat history for context
    const recentMessages = await getRecentMessages(session.session_id, 10);
    const chatHistory: RAGMessage[] = recentMessages
      .slice(0, -1) // Exclude the message we just saved
      .map(m => ({
        role: m.role,
        content: m.content,
      }));

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send session info as first event
    res.write(`event: session\ndata: ${JSON.stringify({ session_id: session.session_id })}\n\n`);
    res.write(`retry: ${SSE_RETRY_INTERVAL}\n\n`);

    let fullResponse = '';
    let diaryIds: number[] = [];
    let streamingInterrupted = false;

    // Handle client disconnect (streaming interruption)
    // Check if req.on exists (may not exist in test environment)
    if (typeof req.on === 'function') {
      req.on('close', () => {
        streamingInterrupted = true;
      });
    }

    try {
      // Generate response with streaming
      const result = await generateRAGResponse(
        userId,
        sanitizedMessage,
        chatHistory,
        (token: string) => {
          // Check if client disconnected
          if (streamingInterrupted) {
            return;
          }
          // Send each token as an SSE event
          try {
            res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
          } catch (writeError) {
            // Client may have disconnected
            streamingInterrupted = true;
          }
        },
        profileName
      );

      fullResponse = sanitizeOutput(result.response);
      diaryIds = result.diaryIds;
      const action = result.action;

      // Handle empty response (Requirement 9.5)
      if (!fullResponse || fullResponse.trim().length === 0) {
        fullResponse = DEFAULT_SUPPORTIVE_MESSAGE;
        // Stream the default message
        for (const char of fullResponse) {
          if (!streamingInterrupted) {
            res.write(`event: token\ndata: ${JSON.stringify({ token: char })}\n\n`);
          }
        }
      }

      // Save assistant response (even if streaming was interrupted, save what we have)
      if (fullResponse) {
        await saveMessage(session.session_id, 'assistant', fullResponse, diaryIds);
      }

      // Check if summarization is needed
      if (await needsSummarization(session.session_id)) {
        // Run summarization in background (don't block response)
        summarizeOldMessages(session.session_id).catch(err => {
          console.error('Summarization error:', err);
        });
      }

      // Send completion event (if client still connected)
      if (!streamingInterrupted) {
        res.write(`event: done\ndata: ${JSON.stringify({ 
          message_id: session.session_id,
          diary_ids: diaryIds,
          action: action || null
        })}\n\n`);
      }

    } catch (error: any) {
      console.error('RAG generation error:', error);
      
      // Send error event with partial content if any (Requirement 8.5)
      if (!streamingInterrupted) {
        res.write(`event: error\ndata: ${JSON.stringify({ 
          error: error.message || 'Failed to generate response',
          partial_content: fullResponse || null
        })}\n\n`);
      }

      // Save partial response if we have any content
      if (fullResponse && fullResponse.length > 0) {
        await saveMessage(
          session.session_id, 
          'assistant', 
          fullResponse + '\n\n[응답이 중단되었습니다]', 
          diaryIds
        );
      }
    }

    res.end();

  } catch (error: any) {
    console.error('Chat message error:', error);
    
    // If headers haven't been sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to process message',
        code: 'INTERNAL_ERROR'
      });
    } else {
      // Headers already sent (SSE mode), send error event
      res.write(`event: error\ndata: ${JSON.stringify({ 
        error: error.message || 'Internal server error'
      })}\n\n`);
      res.end();
    }
  }
};


/**
 * GET /api/chat/sessions/:user_id
 * List all chat sessions for a user
 * Validates: Requirements 2.3, 5.3
 */
export const listSessions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  const requestedUserId = parseInt(req.params.user_id);

  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return;
  }

  if (requestedUserId !== userId) {
    res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
    return;
  }

  try {
    const sessions = await getUserSessions(userId);
    res.status(200).json({ sessions });
  } catch (error: any) {
    console.error('List sessions error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve sessions',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * GET /api/chat/session/:session_id
 * Get a specific session with its messages
 * Validates: Requirements 2.3
 */
export const getSession = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  const { session_id } = req.params;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return;
  }

  if (!session_id) {
    res.status(400).json({ error: 'Session ID is required', code: 'MISSING_SESSION_ID' });
    return;
  }

  try {
    const session = await getSessionById(session_id, true);

    if (!session) {
      res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }

    if (session.user_id !== userId) {
      res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
      return;
    }

    res.status(200).json({ session });
  } catch (error: any) {
    console.error('Get session error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve session',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * POST /api/chat/session
 * Create a new chat session
 * Validates: Requirements 2.4
 */
export const createNewSession = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  const { title } = req.body;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return;
  }

  try {
    const session = await createSession(userId, title);
    res.status(201).json({ session });
  } catch (error: any) {
    console.error('Create session error:', error);
    res.status(500).json({ 
      error: 'Failed to create session',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * DELETE /api/chat/session/:session_id
 * Delete a chat session
 * Validates: Requirements 2.3
 */
export const removeSession = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  const { session_id } = req.params;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return;
  }

  if (!session_id) {
    res.status(400).json({ error: 'Session ID is required', code: 'MISSING_SESSION_ID' });
    return;
  }

  try {
    // Verify ownership before deletion
    const session = await getSessionById(session_id);

    if (!session) {
      res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }

    if (session.user_id !== userId) {
      res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
      return;
    }

    const deleted = await deleteSession(session_id);

    if (deleted) {
      res.status(200).json({ message: 'Session deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete session', code: 'DELETE_FAILED' });
    }
  } catch (error: any) {
    console.error('Delete session error:', error);
    res.status(500).json({ 
      error: 'Failed to delete session',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * GET /api/chat/session/:session_id/context
 * Get session context (summary + recent messages) for LLM
 * Validates: Requirements 2.1, 2.2
 */
export const getSessionContextEndpoint = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  const { session_id } = req.params;
  const limit = parseInt(req.query.limit as string) || 10;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return;
  }

  if (!session_id) {
    res.status(400).json({ error: 'Session ID is required', code: 'MISSING_SESSION_ID' });
    return;
  }

  try {
    // Verify ownership
    const session = await getSessionById(session_id);

    if (!session) {
      res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }

    if (session.user_id !== userId) {
      res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
      return;
    }

    const context = await getSessionContext(session_id, limit);
    res.status(200).json({ context });
  } catch (error: any) {
    console.error('Get session context error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve session context',
      code: 'INTERNAL_ERROR'
    });
  }
};
