import Groq from "groq-sdk";

// A plain-text sibling to callGroqJSON (see groq.ts) for the growing set of
// callers that want a short piece of written copy back — a drafted email
// reply, a sales one-liner, a report paragraph — rather than a structured
// card. Deliberately skips the giant Venus system prompt and JSON-mode
// enforcement entirely: those exist to keep the main chat's causal-reasoning
// contract intact, and would just get in the way of "write me one paragraph."
export async function draftText(groq: Groq, systemPrompt: string, userPrompt: string): Promise<string | null> {
  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.6,
  });
  return completion.choices[0]?.message?.content?.trim() || null;
}
