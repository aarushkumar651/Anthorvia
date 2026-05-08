const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscriptionGate');
const { checkUsageLimit, incrementUsage } = require('../services/usageService');
const { generateTrainingPlan, updateTaskProgress } = require('../services/trainingService');
const { success, error, forbidden, notFound } = require('../utils/response');

router.post('/generate', authenticate, requireActiveSubscription, async (req, res, next) => {
  try {
    const usageCheck = await checkUsageLimit(req.user.id, req.user.plan, 'training_plan');
    if (!usageCheck.allowed) {
      return forbidden(res, usageCheck.message, true);
    }

    const { duration_days = 7 } = req.body;
    const validDurations = [7, 14, 30];
    const duration = validDurations.includes(duration_days) ? duration_days : 7;

    const plan = await generateTrainingPlan(req.user.id, duration);
    await incrementUsage(req.user.id, 'training_plan');

    return success(res, plan, 'Training plan generated');
  } catch (err) {
    next(err);
  }
});

router.get('/active', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, description, duration_days, focus_areas, daily_tasks, progress, starts_at, ends_at
       FROM training_plans WHERE user_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );

    return success(res, result.rows[0] || null);
  } catch (err) {
    next(err);
  }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, description, duration_days, focus_areas, progress, is_active, created_at
       FROM training_plans WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );

    return success(res, { plans: result.rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/:planId/task/:taskDay', authenticate, async (req, res, next) => {
  try {
    const { completed } = req.body;

    if (typeof completed !== 'boolean') {
      return error(res, 'completed must be a boolean', 400);
    }

    const progress = await updateTaskProgress(
      req.user.id,
      req.params.planId,
      parseInt(req.params.taskDay, 10),
      completed
    );

    return success(res, progress, 'Task progress updated');
  } catch (err) {
    if (err.statusCode === 404) return notFound(res, 'Training plan');
    next(err);
  }
});

module.exports = router;
