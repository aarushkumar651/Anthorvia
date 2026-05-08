const Groq = require('groq-sdk');
const { query } = require('../config/database');
const { config } = require('../config/env');
const logger = require('../config/logger');

const groq = new Groq({ apiKey: config.groq.apiKey });

async function generateTrainingPlan(userId, durationDays = 7) {
  const [weaknesses, openingStats, recentStats] = await Promise.all([
    getActiveWeaknesses(userId),
    getWorstOpenings(userId),
    getRecentPerformance(userId),
  ]);

  const prompt = buildTrainingPrompt(weaknesses, openingStats, recentStats, durationDays);

  try {
    const res = await groq.chat.completions.create({
      model: config.groq.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.5,
    });

    const raw = res.choices[0]?.message?.content || '{}';
    const plan = JSON.parse(raw.replace(/```json|```/g, '').trim());

    const focusAreas = [
      ...new Set([
        ...weaknesses.slice(0, 2).map((w) => w.category),
        ...openingStats.slice(0, 1).map(() => 'opening'),
      ]),
    ];

    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationDays);

    const result = await query(
      `INSERT INTO training_plans (user_id, title, description, duration_days, focus_areas, daily_tasks, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        userId,
        plan.title || `${durationDays}-Day Training Plan`,
        plan.description || 'Personalized plan based on your game analysis.',
        durationDays,
        JSON.stringify(focusAreas),
        JSON.stringify(plan.daily_tasks || []),
        endsAt,
      ]
    );

    await query(
      `UPDATE training_plans SET is_active = FALSE
       WHERE user_id = $1 AND id != $2`,
      [userId, result.rows[0]?.id]
    );

    return plan;
  } catch (err) {
    logger.error('Training plan generation failed', { userId, error: err.message });
    throw new Error('Failed to generate training plan. Please try again.');
  }
}

function buildTrainingPrompt(weaknesses, openingStats, recentStats, durationDays) {
  const weaknessStr = weaknesses
    .slice(0, 3)
    .map((w) => `${w.subcategory.replace(/_/g, ' ')} (${w.category}, severity ${w.severity}/5)`)
    .join('; ');

  const openingStr = openingStats
    .slice(0, 2)
    .map((o) => `${o.opening_name || o.eco} as ${o.color}: ${o.wins}W/${o.losses}L`)
    .join('; ');

  return `You are a chess coach creating a personalized ${durationDays}-day training plan.

Player profile:
- Average accuracy: ${recentStats.avgAccuracy}%
- Blunders per game: ${recentStats.avgBlunders}
- Main weaknesses: ${weaknessStr || 'not yet detected — general improvement plan'}
- Struggling openings: ${openingStr || 'varied'}

Create a structured training plan with:
- A motivating title
- A short description (2 sentences)
- ${durationDays} daily tasks (one per day)

Each daily task must have:
- "day": day number
- "title": short task name
- "description": what to do specifically (30-50 words)
- "type": one of: "puzzles", "study", "opening", "endgame", "game_review", "rest"
- "duration_minutes": estimated time (15-45 mins)
- "resource_hint": a specific suggestion (e.g., "Lichess puzzle storm", "Study Rook endgames on lichess.org/study")

Return ONLY valid JSON:
{
  "title": "...",
  "description": "...",
  "daily_tasks": [
    {"day": 1, "title": "...", "description": "...", "type": "puzzles", "duration_minutes": 20, "resource_hint": "..."}
  ]
}`;
}

async function getActiveWeaknesses(userId) {
  const result = await query(
    `SELECT category, subcategory, severity, occurrence_count
     FROM user_weaknesses
     WHERE user_id = $1 AND is_resolved = FALSE
     ORDER BY severity DESC, occurrence_count DESC
     LIMIT 5`,
    [userId]
  );
  return result.rows;
}

async function getWorstOpenings(userId) {
  const result = await query(
    `SELECT eco, opening_name, color, wins, losses, games_played, avg_accuracy
     FROM opening_stats
     WHERE user_id = $1 AND games_played >= 3
     ORDER BY (losses::float / NULLIF(games_played, 0)) DESC
     LIMIT 3`,
    [userId]
  );
  return result.rows;
}

async function getRecentPerformance(userId) {
  const result = await query(
    `SELECT
       ROUND(AVG(ga.accuracy_score), 1) as avg_accuracy,
       ROUND(AVG(ga.blunder_count), 2) as avg_blunders
     FROM games g
     JOIN game_analyses ga ON ga.game_id = g.id
     WHERE g.user_id = $1 AND g.played_at >= NOW() - INTERVAL '30 days'`,
    [userId]
  );
  return result.rows[0] || { avg_accuracy: 0, avg_blunders: 0 };
}

async function updateTaskProgress(userId, planId, taskDay, completed) {
  const planResult = await query(
    `SELECT progress, daily_tasks FROM training_plans WHERE id = $1 AND user_id = $2`,
    [planId, userId]
  );

  if (planResult.rows.length === 0) {
    const err = new Error('Training plan not found');
    err.statusCode = 404;
    throw err;
  }

  const { progress, daily_tasks } = planResult.rows[0];
  const completedTasks = progress.completed_tasks || [];

  if (completed && !completedTasks.includes(taskDay)) {
    completedTasks.push(taskDay);
  } else if (!completed) {
    const idx = completedTasks.indexOf(taskDay);
    if (idx > -1) completedTasks.splice(idx, 1);
  }

  const completionPct = Math.round((completedTasks.length / (daily_tasks?.length || 1)) * 100);

  await query(
    `UPDATE training_plans
     SET progress = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3`,
    [JSON.stringify({ completed_tasks: completedTasks, completion_pct: completionPct }), planId, userId]
  );

  return { completed_tasks: completedTasks, completion_pct: completionPct };
}

module.exports = { generateTrainingPlan, updateTaskProgress };
