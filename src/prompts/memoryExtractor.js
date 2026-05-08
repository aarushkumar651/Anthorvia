function buildMemoryExtractionPrompt(userMessage, aiResponse) {
  return `You are a memory extraction system for a chess coaching AI named Kairos.

Analyze this conversation and extract any important, persistent facts about the user that should be remembered for future coaching sessions.

User said: "${userMessage.slice(0, 600)}"
Coach responded: "${aiResponse.slice(0, 600)}"

Extract ONLY facts that are:
- Specific to this user (not generic chess knowledge)
- Likely to be relevant in future conversations
- About weaknesses, goals, preferences, progress milestones, or personal context

Categories:
- weakness: A chess weakness the user has or acknowledges
- preference: What the user likes/dislikes (openings, time controls, etc.)
- progress: An improvement milestone or achievement
- goal: Something the user wants to achieve
- fact: A persistent personal fact (rating, username, playing style, etc.)

Return ONLY valid JSON with no markdown:
{"memories": [{"content": "short factual statement", "type": "weakness", "importance": 0.75}]}

Importance scale: 0.1 (minor) to 1.0 (critical)
If nothing worth remembering, return: {"memories": []}`;
}

module.exports = { buildMemoryExtractionPrompt };
