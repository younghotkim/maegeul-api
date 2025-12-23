/**
 * Chat Routes for Mudita Bot
 * Handles chat message and session management endpoints
 * Validates: Requirements 1.2, 2.3, 2.4, 5.3, 8.1, 8.2
 */

import express from 'express';
import {
  sendMessage,
  listSessions,
  getSession,
  createNewSession,
  removeSession,
  getSessionContextEndpoint,
} from '../controllers/chatController';
import { authenticateToken, verifyUserOwnership } from '../middleware/auth';

const router = express.Router();

// All chat routes require authentication

// Message endpoint with SSE streaming
// POST /api/chat/message - send message and stream response
router.post('/chat/message', authenticateToken, sendMessage);

// Session management endpoints
// GET /api/chat/sessions/:user_id - list user sessions
router.get(
  '/chat/sessions/:user_id',
  authenticateToken,
  verifyUserOwnership,
  listSessions
);

// GET /api/chat/session/:session_id - get session with messages
router.get('/chat/session/:session_id', authenticateToken, getSession);

// POST /api/chat/session - create new session
router.post('/chat/session', authenticateToken, createNewSession);

// DELETE /api/chat/session/:session_id - delete session
router.delete('/chat/session/:session_id', authenticateToken, removeSession);

// GET /api/chat/session/:session_id/context - get session context for LLM
router.get('/chat/session/:session_id/context', authenticateToken, getSessionContextEndpoint);

export default router;
