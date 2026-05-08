const { query } = require('../config/database');

const PLAN_LIMITS = {
  free: {
    ai_chat_per_month: 20,
    game_analysis_per_month: 50,
    report_gen_per_month: 2,
    opening_explore_per_month: 30,
    training_plan_per_month: 1,
  },
  basic: {
    ai_chat_per_month: 300,
    game_analysis_per_month: 200,
    report_gen_per_month: 8,
    opening_explore_per_month: 200,
    training_plan_per_month: 4,
  },
  pro: {
    ai_chat_per_month: 1500,
    game_analysis_per_month: 1000,
    report_gen_per_month: 30,
    opening_explore_per_month: 9999,
    training_plan_per_month: 20,
  },
};

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getMonthlyUsage(userId) {
  const month = getCurrentMonth();
  const result = await query(
    `SELECT ai_chat_count, game_analysis_count, report_gen_count,
            opening_explore_count, training_plan_count, total_tokens_used
     FROM usage_monthly
     WHERE user_id = $1 AND month = $2`,
    [userId, month]
  );

  return (
    result.rows[0] || {
      ai_chat_count: 0,
      game_analysis_count: 0,
      report_gen_count: 0,
      opening_explore_count: 0,
      training_plan_count: 0,
      total_tokens_used: 0,
    }
  );
}

async function checkUsageLimit(userId, plan, action) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limitKey = `${action}_per_month`;
  const usageKey = `${action}_count`;
  const limit = limits[limitKey];

  if (!limit) return { allowed: true };

  const usage = await getMonthlyUsage(userId);
  const used = usage[usageKey] || 0;

  if (used >= limit) {
    return {
      allowed: false,
      used,
      limit,
      action,
      message: `Monthly ${action.replace(/_/g, ' ')} limit of ${limit} reached. Upgrade for more.`,
    };
  }

  return { allowed: true, used, limit };
}

async function incrementUsage(userId, action, extraData = {}) {
  const month = getCurrentMonth();
  const columnMap = {
    ai_chat: 'ai_chat_count',
    game_analysis: 'game_analysis_count',
    report_gen: 'report_gen_count',
    opening_explore: 'opening_explore_count',
    training_plan: 'training_plan_count',
  };

  const column = columnMap[action];
  if (!column) return;

  await query(
    `INSERT INTO usage_monthly (user_id, month, ${column})
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, month) DO UPDATE
     SET ${column} = usage_monthly.${column} + 1`,
    [userId, month]
  );
}

async function getUsageSummary(userId, plan) {
  const usage = await getMonthlyUsage(userId);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const month = getCurrentMonth();

  return {
    month,
    plan,
    usage: {
      ai_chat: { used: usage.ai_chat_count, limit: limits.ai_chat_per_month },
      game_analysis: { used: usage.game_analysis_count, limit: limits.game_analysis_per_month },
      report_gen: { used: usage.report_gen_count, limit: limits.report_gen_per_month },
      opening_explore: { used: usage.opening_explore_count, limit: limits.opening_explore_per_month },
      training_plan: { used: usage.training_plan_count, limit: limits.training_plan_per_month },
    },
    tokens_used: usage.total_tokens_used,
  };
}

module.exports = { checkUsageLimit, incrementUsage, getUsageSummary, getMonthlyUsage, PLAN_LIMITS };
