const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscriptionGate');
const { chatLimiter } = require('../middleware/rateLimiter');
const { validate, schemas } = require('../middleware/validate');
const { checkUsageLimit, incrementUsage } = require('../services/usageService');
const { chat } = require('../services/aiService');
const { addMemoryJob } = require('../queues');
const { getPagination } = require('../utils/pagination');
const { success, error, forbidden, paginated, notFound } = require('../utils/response');

router.post(
  '/message',
  authenticate,
  requireActiveSubscription,
  chatLimiter,
  validate(schemas.chatMessage),
  async (req, res, next) => {
    try {
      const { message, session_id, game_id } = req.body;
      const userId = req.user.id;

      const usageCheck = await checkUsageLimit(userId, req.user.plan, 'ai_chat');
      if (!usageCheck.allowed) {
        return forbidden(res, usageCheck.message, true);
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let fullResponse = '';
      let resolvedSessionId = null;

      const { response, sessionId, tokensUsed } = await chat(
        req.user,
        message,
        session_id,
        game_id,
        (chunk) => {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
        }
      );

      fullResponse = response;
      resolvedSessionId = sessionId;

      res.write(`data: ${JSON.stringify({ type: 'done', session_id: resolvedSessionId })}\n\n`);
      res.end();

      await incrementUsage(userId, 'ai_chat');
      addMemoryJob(userId, message, fullResponse, resolvedSessionId).catch(() => {});
    } catch (err) {
      if (!res.headersSent) {
        next(err);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream interrupted' })}\n\n`);
        res.end();
      }
    }
  }
);

router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    const count = await query(
      'SELECT COUNT(*) FROM chat_sessions WHERE user_id = $1',
      [req.user.id]
    );

    const sessions = await query(
      `SELECT id, title, context_game_id, message_count, created_at, updated_at
       FROM chat_sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    return paginated(res, sessions.rows, parseInt(count.rows[0].count, 10), page, limit);
  } catch (err) {
    next(err);
  }
});

router.get('/sessions/:sessionId/messages', authenticate, async (req, res, next) => {
  try {
    const sessionCheck = await query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.user.id]
    );

    if (sessionCheck.rows.length === 0) return notFound(res, 'Session');

    const { page, limit, offset } = getPagination(req.query);

    const count = await query(
      'SELECT COUNT(*) FROM chat_messages WHERE session_id = $1',
      [req.params.sessionId]
    );

    const messages = await query(
      `SELECT id, role, content, created_at
       FROM chat_messages WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [req.params.sessionId, limit, offset]
    );

    return paginated(res, messages.rows, parseInt(count.rows[0].count, 10), page, limit);
  } catch (err) {
    next(err);
  }
});

router.delete('/sessions/:sessionId', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.sessionId, req.user.id]
    );

    if (result.rows.length === 0) return notFound(res, 'Session');

    return success(res, null, 'Session deleted');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
