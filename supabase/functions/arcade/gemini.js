import { z } from "npm:zod@4.6.7";

const reply = z.object({
  candidates: z.array(z.object({
    finishReason: z.literal("STOP"),
    content: z.object({ parts: z.array(z.object({ text: z.string(), thought: z.boolean().optional() })) }),
  })).min(1),
});

/** @param {{ key?: string, model?: string, fetcher?: typeof fetch }} [options] */
export function createGeminiHintProvider({ key, model = "gemini-2.5-flash", fetcher = fetch } = {}) {
  if (!key || !/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(model)) return undefined;

  return async ({ word, rule, signal }) => {
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Gumawa ng isang maikling pahiwatig sa Filipino para sa batang nag-aaral ng morpolohiya. Isang pangungusap lamang. Ipaalala ang tuntunin. Huwag isulat ang sagot, ang salitang-ugat ng ibinigay na salita, o ang hakbang na tahasang nagbubunyag ng sagot. Walang Markdown, link, pangalan, o ibang dagdag na impormasyon." }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ salita: word, tuntunin: rule }) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 128, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!response.ok) return null;
    const result = reply.safeParse(await response.json());
    if (!result.success) return null;
    const text = result.data.candidates[0].content.parts.filter((part) => !part.thought).map((part) => part.text).join(" ").trim();
    return text && !/[<>\n\r]|https?:/i.test(text) ? text : null;
  };
}
