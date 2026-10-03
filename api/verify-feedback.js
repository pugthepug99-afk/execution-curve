// api/verify-feedback.js
// Verifies feedback submissions are genuine before points are awarded.
// Returns { valid: bool, reason: string, score: number }

const MODEL = "gemini-flash-lite-latest";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { feedbackType, content, projectTitle, projectDescription } = req.body || {};

  if (!content || !feedbackType) return res.status(400).json({ error: "Missing required fields" });

  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Server misconfigured" });

  // Hard minimums by type
  const minLength = { thoughtful_feedback: 100, app_test: 150, bug_report: 200 };
  const min = minLength[feedbackType] || 100;

  if (content.trim().length < min) {
    return res.status(200).json({
      valid: false,
      reason: `Your feedback needs to be at least ${min} characters for this type. You wrote ${content.trim().length}.`,
      score: 0,
    });
  }

  // Check for random characters / gibberish
  const words = content.trim().split(/\s+/);
  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  const hasLongGibberish = words.some(w => w.length > 25 && /[^aeiou]{8,}/i.test(w));
  const tooFewWords = words.length < 15;

  if (hasLongGibberish || tooFewWords) {
    return res.status(200).json({
      valid: false,
      reason: "Your feedback doesn't look like genuine review content. Please write actual thoughts about the project.",
      score: 0,
    });
  }

  const typeDescriptions = {
    thoughtful_feedback: "a written review covering what works, what doesn't, and specific suggestions",
    app_test: "a report from actually using the app for 5 minutes, describing the experience, usability, and what they noticed",
    bug_report: "a detailed bug report with steps to reproduce, what was expected, and what actually happened",
  };

  const prompt = `You are verifying whether this feedback submission is genuine and useful.

Project being reviewed: "${projectTitle || 'Unknown project'}"
${projectDescription ? `Project description: "${projectDescription}"` : ''}
Feedback type: ${feedbackType} (should be ${typeDescriptions[feedbackType] || 'genuine feedback'})
Feedback submitted:
"""
${content.slice(0, 1500)}
"""

Evaluate this feedback on three criteria:
1. Is it genuine (not random characters, not copied text, not obviously fake)?
2. Is it actually about reviewing/testing a project (not unrelated rambling)?
3. Does it provide value to the project owner (specific observations, not just "looks good")?

Respond with ONLY a JSON object, no markdown:
{"valid": true/false, "reason": "one sentence explanation if invalid, empty string if valid", "score": 1-10}

Score 1-3 = fake/useless, 4-6 = low quality but genuine, 7-10 = good feedback.
Only set valid=false for scores 1-3. Scores 4+ should be valid=true.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.1 },
        }),
      });

      if (!response.ok) { if (attempt === 0) continue; break; }

      const data = await response.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!raw) { if (attempt === 0) continue; break; }

      const clean = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      const result = JSON.parse(clean);
      return res.status(200).json(result);

    } catch (err) {
      console.error("Verify feedback error:", err);
      if (attempt === 0) continue;
    }
  }

  // If AI check fails, allow submission but at minimum length
  return res.status(200).json({ valid: true, reason: "", score: 5 });
}
