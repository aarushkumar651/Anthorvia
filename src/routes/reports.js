const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requirePlan } = require('../middleware/subscriptionGate');
const { validate, schemas } = require('../middleware/validate');
const { checkUsageLimit, incrementUsage } = require('../services/usageService');
const { addReportJob } = require('../queues');
const { getPagination } = require('../utils/pagination');
const { success, error, forbidden, paginated, notFound } = require('../utils/response');

router.post(
  '/generate',
  authenticate,
  requirePlan('basic'),
  validate(schemas.generateReport),
  async (req, res, next) => {
    try {
      const { report_type } = req.body;

      const usageCheck = await checkUsageLimit(req.user.id, req.user.plan, 'report_gen');
      if (!usageCheck.allowed) {
        return forbidden(res, usageCheck.message, true);
      }

      await addReportJob(req.user.id, report_type);
      await incrementUsage(req.user.id, 'report_gen');

      return success(res, { report_type, message: 'Report generation queued' }, 'Report queued');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    const count = await query(
      'SELECT COUNT(*) FROM analysis_reports WHERE user_id = $1',
      [req.user.id]
    );

    const reports = await query(
      `SELECT id, report_type, title, summary, games_analyzed, date_range_start, date_range_end, generated_at
       FROM analysis_reports WHERE user_id = $1
       ORDER BY generated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    return paginated(res, reports.rows, parseInt(count.rows[0].count, 10), page, limit);
  } catch (err) {
    next(err);
  }
});

router.get('/:reportId', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM analysis_reports WHERE id = $1 AND user_id = $2`,
      [req.params.reportId, req.user.id]
    );

    if (result.rows.length === 0) return notFound(res, 'Report');

    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
