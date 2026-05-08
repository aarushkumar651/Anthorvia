const Groq = require('groq-sdk');
const { query } = require('../config/database');
const { config } = require('../config/env');
const logger = require('../config/logger');

const groq = new Groq({ apiKey: config.groq.apiKey });

async function generateWeeklyReport(userId) {
  const [gamesData, weaknessData, openingData, ratingData] = await Promise.all([
    getWeeklyGameStats(userId),
    getTopWeaknesses(userId),
    getOpeningPerformance(userId),
    getRatingTrend(userId),
  ]);

  if (gamesData.totalGames === 0) {
    return {
      title: 'Weekly Chess Report',
      summary: 'Not enough games played this week to generate a report.',
      content: { gamesData, weaknessData, openingData, ratingData },
      games_analyzed: 0,
    };
  }

  const aiInsight = await generateAIInsight(userId, gamesData, weaknessData, openingData);

  const report = {
    title: `Weekly Chess Report — ${new Date().toLocaleDateString('en-IN', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    summary: aiInsight.summary,
    content: {
      performance: gamesData,
      weaknesses: weaknessData,
      openings: openingData,
      ratingTrend: ratingData,
      aiInsights: aiInsight,
    },
    games_analyzed: gamesData.totalGames,
    date_range_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    date_range_end: new Date(),
  };

  await query(
    `INSERT INTO analysis_reports (user_id, report_type, title, summary, content, games_analyzed, date_range_start, date_range_end)
     VALUES ($1, 'weekly', $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      report.title,
      report.summary,
      JSON.stringify(report.content),
      report.games_analyzed,
      report.date_range_start,
      report.date_range_end,
    ]
  );

  return report;
}

async function getWeeklyGameStats(userId) {
  const result = await query(
    `SELECT
       COUNT(*) as total_games,
       COUNT(*) FILTER (WHERE user_result = 'win') as wins,
       COUNT(*) FILTER (WHERE user_result = 'loss') as losses,
       COUNT(*) FILTER (WHERE user_result = 'draw') as draws,
       ROUND(AVG(ga.accuracy_score), 1) as avg_accuracy,
       ROUND(AVG(ga.blunder_count), 2) as avg_blunders,
       ROUND(AVG(ga.mistake_count), 2) as avg_mistakes,
       MAX(g.user_rating) as peak_rating,
       MIN(g.user_rating) as low_rating
     FROM games g
     LEFT JOIN game_analyses ga ON ga.game_id = g.id
     WHERE g.user_id = $1
       AND g.played_at >= NOW() - INTERVAL '7 days'`,
    [userId]
  );

  const row = result.rows[0];
  const total = parseInt(row.total_games, 10);
  const wins = parseInt(row.wins, 10);

  return {
    totalGames: total,
    wins,
    losses: parseInt(row.losses, 10),
    draws: parseInt(row.draws, 10),
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    avgAccuracy: parseFloat(row.avg_accuracy) || 0,
    avgBlunders: parseFloat(row.avg_blunders) || 0,
    avgMistakes: parseFloat(row.avg_mistakes) || 0,
    peakRating: row.peak_rating,
    lowRating: row.low_rating,
  };
}

async function getTopWeaknesses(userId) {
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

async function getOpeningPerformance(userId) {
  const result = await query(
    `SELECT eco, opening_name, color, games_played, wins, losses, draws, avg_accuracy
     FROM opening_stats
     WHERE user_id = $1 AND games_played >= 3
     ORDER BY games_played DESC
     LIMIT 5`,
    [userId]
  );
  return result.rows.map((r) => ({
    ...r,
    winRate: r.games_played > 0 ? Math.round((r.wins / r.games_played) * 100) : 0,
  }));
}

async function getRatingTrend(userId) {
  const result = await query(
    `SELECT platform, time_class, rating, recorded_at
     FROM rating_history
     WHERE user_id = $1
       AND recorded_at >= NOW() - INTERVAL '30 days'
     ORDER BY recorded_at ASC`,
    [userId]
  );
  return result.rows;
}

async function generateAIInsight(userId, gamesData, weaknessData, openingData) {
  const weaknessStr = weaknessData
    .slice(0, 3)
    .map((w) => `${w.subcategory.replace(/_/g, ' ')} (severity: ${w.severity}/5)`)
    .join(', ');

  const prompt = `You are a chess coach writing a weekly performance summary for a player.

This week's data:
- Games: ${gamesData.totalGames} played, ${gamesData.wins}W/${gamesData.losses}L/${gamesData.draws}D (${gamesData.winRate}% win rate)
- Average accuracy: ${gamesData.avgAccuracy}%
- Average blunders per game: ${gamesData.avgBlunders}
- Top weaknesses: ${weaknessStr || 'none detected yet'}
- Most played openings: ${openingData.slice(0, 2).map((o) => o.opening_name).join(', ') || 'varied'}

Write:
1. A 2-sentence "summary" of the week
2. A "key_strength" (1 sentence, what they did well)
3. A "key_weakness" (1 sentence, the most important thing to fix)
4. "action_items" (array of 3 specific, concrete improvement tasks)
5. A "motivational_close" (1 short encouraging sentence)

Return ONLY valid JSON: {"summary": "...", "key_strength": "...", "key_weakness": "...", "action_items": ["...", "...", "..."], "motivational_close": "..."}`;

  try {
    const res = await groq.chat.completions.create({
      model: config.groq.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.6,
    });

    const raw = res.choices[0]?.message?.content || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.warn('AI report generation failed', { userId, error: err.message });
    return {
      summary: `You played ${gamesData.totalGames} games this week with a ${gamesData.winRate}% win rate.`,
      key_strength: 'Keep building consistency by playing regularly.',
      key_weakness: weaknessData[0]
        ? `Your biggest focus should be: ${weaknessData[0].subcategory.replace(/_/g, ' ')}.`
        : 'Focus on reducing blunders.',
      action_items: [
        'Complete 15 tactics puzzles daily',
        'Review your worst game from this week',
        'Study one new endgame technique',
      ],
      motivational_close: 'Every game is a lesson. Keep going.',
    };
  }
}

module.exports = { generateWeeklyReport };
