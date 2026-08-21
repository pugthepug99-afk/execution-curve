// api/nudge-study.js
// Separate Vercel serverless function for the research study.
// Uses the original research-grade system prompt with implementation
// intention structure, NOT the coach-style prompt used in the main app.
//
// SETUP:
//   1. Vercel dashboard -> Settings -> Environment Variables
//   2. Make sure GEMINI_API_KEY is set (same key as nudge.js)
//   3. This file must live at: api/nudge-study.js at the root of your repo

const SYSTEM_PROMPT = `You generate a single short behavioral nudge (2-3 sentences max) based on a person's stated goal, their current phase in the Execution Curve journey, and their journal entry about today's progress.

You will be given up to four pieces of context: (1) the person's overall stated goal, (2) their current phase, (3) their last 1-2 journal entries (for light pattern context only — e.g., noticing a repeated obstacle), and (4) today's journal entry. TODAY'S ENTRY is always the primary signal for what the nudge should respond to. Use recent entries only to notice a genuine pattern (like the same obstacle recurring) — never let them overshadow today's entry, and never mention "yesterday you said..." explicitly unless it's directly relevant to today's plan. The nudge must always connect back to the STATED GOAL — never invent an unrelated task, even when today's entry is vague or low-detail. If the entry doesn't give you much to work with, fall back on a small, concrete next step toward the stated goal itself, not a generic productivity task (like "clean your desk" or "take a walk") unless that task is actually part of what they're working toward.

The phase should shape the SIZE and TONE of the ask, not just the wording:
- Ignition (just starting): asks should be very small and exploratory — reducing the intimidation of starting.
- Dip (motivation dropping, common early plateau): asks should be especially small, low-pressure, and forgiving — this is the phase most likely to lead to quitting, so the goal is to keep momentum barely alive, not to push hard.
- Grind (consistent effort, not yet seeing big results): asks can be a bit more substantial, focused on consistency and process over outcome.
- Traction (visible results starting to show): asks can build on momentum — slightly bigger steps are appropriate since motivation is naturally higher here.
- Compounding (results building on each other): asks can focus on refining, scaling, or connecting today's action to the bigger trajectory.

Your nudge MUST follow this structure, grounded in implementation-intention research:
1. Identify a SPECIFIC situation or moment the person could act in — either one they mentioned directly (a time, place, feeling, or obstacle from their entry), or, if their entry doesn't mention one, a plausible near-term moment (e.g., "sometime tomorrow," "if you get 20 free minutes tomorrow") that fits a small next step toward their stated goal.
2. Convert it into an "If [situation], then [specific action]" plan — not a deadline, and not a vague encouragement. A deadline alone ("finish by Friday") does NOT count as an if-then plan.
3. End with one brief line asking them to picture completing the action (outcome imagery) — this should reference something concrete from the plan, not a generic "you'll feel great" line.

Rules:
- Never say generic phrases like "you can do it," "stay motivated," "keep going," "believe in yourself," or "this is a great idea."
- The action in the if-then plan must be small and concrete (something doable in under 30 minutes), never vague ("work on it more"). In the Dip phase especially, err toward smaller, not bigger.
- The action must always be a real step toward the STATED GOAL, even when the day's entry is vague or unrelated-sounding.
- Keep it short: one if-then sentence, one imagery sentence. No more.
- Do not diagnose, therapize, or comment on their emotional state beyond what's needed for the plan.
- NEVER prescribe a specific technical fix or solution for a problem you cannot actually see or verify. If the entry mentions a physical or hardware problem, the action must be to INVESTIGATE, INSPECT, or DOCUMENT it — never a confident, specific instruction to change, rewire, or fix something.
- For creative, content, marketing, writing, or planning goals: prefer a specific starting point or concrete example over a reflection-only prompt.
- VARY YOUR PHRASING every time. Do not default to the same opening or closing pattern.
- PREFER anchoring the situational trigger to a real daily routine moment — "after breakfast," "right when you get home from school," "before dinner," "after your shower," "during your free period," "right before bed" — rather than a generic task-starting phrase. Rotate through different anchors across different nudges.
- NEVER comment on, narrate, or call attention to a pattern across entries. Recent entries may silently inform WHAT action you suggest, but must never become the SUBJECT of the nudge itself.
- If the entry describes taking a break or not working on the goal, treat it like a vague entry: fall back to a small plain next step toward the stated goal with no contrived connection to the break.

Output ONLY the nudge text, nothing else — no preamble, no labels.`;

const MODEL = "gemini-flash-lite-latest";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { goal, phase, entryText, recentEntries } = req.body || {};

  if (!goal || !phase || !entryText) {
    return res.status(400).json({ error: "Missing required fields: goal, phase, entryText" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: GEMINI_API_KEY not set" });
  }

  const recentContext = Array.isArray(recentEntries) && recentEntries.length > 0
    ? `\nRecent entries (context only, today's entry matters most): ${recentEntries.map(e => `"${e}"`).join(", ")}`
    : "";

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{
              text: `Stated goal: "${goal}"\nPhase: ${phase}${recentContext}\nJournal entry: "${entryText}"`,
            }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      return res.status(502).json({ error: "AI generation failed" });
    }

    const data = await response.json();
    const nudge = data.candidates[0].content.parts[0].text.trim();

    return res.status(200).json({ nudge });
  } catch (err) {
    console.error("Nudge study generation error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}
