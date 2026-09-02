// api/roadmap.js
// Generates a personalized phase roadmap based on the user's goal and entry history.
// Returns structured JSON that the frontend renders as an interactive node map.

const MODEL = "gemini-flash-lite-latest";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { goal, entries, currentPhase } = req.body || {};

  if (!goal) {
    return res.status(400).json({ error: "Missing required field: goal" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: GEMINI_API_KEY not set" });
  }

  const entryContext = Array.isArray(entries) && entries.length > 0
    ? `\nThe user has made ${entries.length} journal entries. Recent entries: ${entries.slice(-5).map(e => `"${e.text}" (feeling: ${e.feeling})`).join(", ")}`
    : "\nThe user has not made any journal entries yet.";

  const phaseContext = currentPhase
    ? `\nBased on their entries, they appear to currently be in the ${currentPhase} phase.`
    : "";

  const prompt = `You are generating a personalized project roadmap for someone working toward the following goal: "${goal}"
${entryContext}${phaseContext}

Generate a roadmap of 4 to 7 phases that represents the realistic journey from where they are now to achieving this goal. Each phase should be specific to their goal, not generic.

Return ONLY a valid JSON object with this exact structure, no markdown, no explanation, no backticks:

{
  "title": "short roadmap title based on their goal",
  "summary": "one sentence describing what this roadmap covers",
  "phases": [
    {
      "id": 1,
      "name": "phase name (2-4 words, specific to their goal)",
      "status": "complete|active|upcoming",
      "estimatedDuration": "realistic time estimate like '1-2 weeks' or '2-3 months'",
      "description": "2-3 sentences describing what happens in this phase and why it matters",
      "milestones": [
        "specific observable milestone 1",
        "specific observable milestone 2",
        "specific observable milestone 3"
      ],
      "commonTraps": "one sentence about the most common mistake in this phase",
      "feelingNote": "one sentence about how this phase typically feels emotionally"
    }
  ]
}

Rules:
- Phase names must be specific to the goal, not generic labels like "Phase 1" or "Getting Started"
- Milestones must be concrete and observable, not vague
- Status must be inferred from their entry history: phases they have clearly passed are "complete", their current phase is "active", future phases are "upcoming"
- If they have no entries, the first phase is "active" and the rest are "upcoming"
- Duration estimates should be realistic for the specific goal type
- Do not use em dashes anywhere in the output
- Return only the JSON object, nothing else`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2000, temperature: 0.4 },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini error (attempt ${attempt + 1}):`, errText);
        if (attempt === 0) continue;
        return res.status(502).json({ error: "Could not generate roadmap. Try again." });
      }

      const data = await response.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!raw) {
        if (attempt === 0) continue;
        return res.status(502).json({ error: "Empty response from AI. Try again." });
      }

      // Strip any accidental markdown fences
      const clean = raw.replace(/^```json\n?/, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();

      let roadmap;
      try {
        roadmap = JSON.parse(clean);
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr, "Raw:", clean.slice(0, 200));
        if (attempt === 0) continue;
        return res.status(502).json({ error: "Could not parse roadmap. Try regenerating." });
      }

      return res.status(200).json({ roadmap });

    } catch (err) {
      console.error(`Roadmap error (attempt ${attempt + 1}):`, err);
      if (attempt === 0) continue;
      return res.status(500).json({ error: "Unexpected error generating roadmap." });
    }
  }

  return res.status(500).json({ error: "Could not generate roadmap after retries." });
}
