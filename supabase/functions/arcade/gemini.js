import { z } from "npm:zod@4.6.7";

const reply = z.object({
  candidates: z.array(z.object({
    finishReason: z.literal("STOP"),
    content: z.object({ parts: z.array(z.object({ text: z.string(), thought: z.boolean().optional() })) }),
  })).min(1),
});

/** @param {{ key?: string, model?: string, fetcher?: typeof fetch }} [options] */
// Pinned, not a "-latest" alias: the study must use one fixed model (logged with every hint).
export function createGeminiHintProvider({ key, model = "gemini-3.5-flash-lite", fetcher = fetch } = {}) {
  if (!key || !/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(model)) return undefined;

  const provider = async ({ word, rule, fact, level, wrong, signal }) => {
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Gumawa ng isang maikling pahiwatig sa Filipino para sa batang nag-aaral ng morpolohiya. Isang pangungusap lamang. Ibatay lamang sa ibinigay na tuntunin at katotohanan. Huwag sumalungat sa katotohanan at huwag magbanggit ng panlaping wala rito. Huwag isulat ang sagot, ang salitang-ugat ng ibinigay na salita, o ang hakbang na tahasang nagbubunyag ng sagot. Walang Markdown, link, pangalan, o ibang dagdag na impormasyon." }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ salita: word, tuntunin: rule, katotohanan: fact ?? rule, antas: level, maling_sagot: wrong }) }] }],
        // Gemini 3 uses thinkingLevel; "minimal" keeps a hint inside the ~3 s target.
        generationConfig: { temperature: 0.2, maxOutputTokens: 256, thinkingConfig: { thinkingLevel: "minimal" } },
      }),
    });
    // Errors name the cause; callers fall back to the authored hint and log or show it.
    if (!response.ok) {
      const detail = await response.json().then((body) => body?.error?.status ?? "").catch(() => "");
      throw new Error(`Gemini HTTP ${response.status} ${detail}`.trim());
    }
    const body = await response.json();
    const result = reply.safeParse(body);
    if (!result.success) throw new Error(`Gemini reply not usable (finish reason: ${body?.candidates?.[0]?.finishReason ?? "none"})`);
    const text = result.data.candidates[0].content.parts.filter((part) => !part.thought).map((part) => part.text).join(" ").trim();
    if (!text || /[<>]|https?:/i.test(text)) throw new Error("Gemini text has markup or links");
    // A sentence may arrive wrapped across lines; join it instead of discarding the hint.
    return text.replace(/\s*[\r\n]+\s*/g, " ");
  };
  provider.model = model;
  /** Models this key can call with generateContent, for choosing GEMINI_MODEL. */
  provider.listModels = async () => {
    const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
    const { models = [] } = await response.json();
    return models.filter((entry) => entry.supportedGenerationMethods?.includes("generateContent"))
      .map((entry) => String(entry.name).replace(/^models\//, ""));
  };
  return provider;
}
