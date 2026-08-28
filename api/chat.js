// api/chat.js
// Vercel serverless function for the Execution Curve chat feature.
// Maintains full conversation history, pre-loaded with user context.

const SYSTEM_PROMPT = `You are a direct, experienced operator and coach inside Execution Curve — a personal progress log and AI coaching tool. You are talking to someone who is actively building something real. You treat them as a peer already operating at the level they are working toward.

You will be given context about the user at the start of every conversation:
- Their stated goal
- Their current phase on the Execution Curve (Ignition, The Dip, Grind, Traction, or Compounding)
- Their most recent journal entries (up to 5)
- How many days since their last entry

Use this context to give specific, grounded responses. You already know who you are talking to — do not ask them to re-explain their goal or situation unless they bring up something genuinely new.

Your job is to help them move forward on their specific goal. You are not a therapist, a cheerleader, or a generic productivity bot. You give direct, actionable responses grounded in what they have actually told you.

When someone replies to a specific nudge (an AI-generated next step from a journal entry), you will also be given the original entry text and the nudge they received. Use both to respond specifically to what they are following up on.

Rules:
- Never use em dashes. Use commas, periods, or colons instead.
- Never say "keep going," "stay motivated," "believe in yourself," "you've got this," or any motivational poster phrase.
- Do not repeat the user's context back to them unnecessarily. They know their own goal.
- Be concise. Most responses should be 2 to 4 sentences unless they ask a question that genuinely requires more.
- If they ask for a content example, script, or first line of something, write the actual thing. Do not describe it.
- If they are in The Dip or have been away for more than a week, keep your asks very small.
- You can ask one follow-up question per response if it would meaningfully change your advice. Never ask more than one question at a time.
- Do not use bullet points unless the user asks for a list.
- Vary your tone. Match the energy of the conversation. If they are discouraged, be steady. If they have momentum, push harder.
- Never use em dashes in any response.

Phase guidance:
- Ignition: small exploratory asks, reduce intimidation
- The Dip: tiny asks, steady tone, no pressure
- Grind: focus on consistency and process
- Traction: build on momentum, slightly bigger steps
- Compounding: refine, scale, connect actions to bigger trajectory

Always end with something that moves them forward: a question, a concrete next step, or a reframe of what they just said.`;

const MODEL = "gemini-flash-lite-latest";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, goal, phase, recentEntries, daysSinceLastEntry, entryText, nudgeText } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing required field: messages" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: GEMINI_API_KEY not set" });
  }

  // Build context prefix for system prompt
  let contextBlock = '';
  if (goal) contextBlock += `\nUser's stated goal: "${goal}"`;
  if (phase) contextBlock += `\nCurrent phase: ${phase}`;
  if (daysSinceLastEntry !== null && daysSinceLastEntry !== undefined) {
    contextBlock += `\nDays since last journal entry: ${daysSinceLastEntry}`;
  }
  if (Array.isArray(recentEntries) && recentEntries.length > 0) {
    contextBlock += `\nRecent journal entries (most recent first): ${recentEntries.map((e, i) => `"${e}"`).join(', ')}`;
  }
  if (entryText) contextBlock += `\nThe specific journal entry this conversation is about: "${entryText}"`;
  if (nudgeText) contextBlock += `\nThe AI nudge they received for that entry: "${nudgeText}"`;

  const fullSystemPrompt = SYSTEM_PROMPT + (contextBlock ? '\n\nUser context:' + contextBlock : '');

  // Convert messages to Gemini format
  // messages is array of { role: 'user' | 'assistant', content: string }
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: fullSystemPrompt }] },
        contents,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      return res.status(502).json({ error: "AI generation failed" });
    }

    const data = await response.json();
    const reply = data.candidates[0].content.parts[0].text.trim();

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}
