import { z } from "npm:zod@4.6.7";

const generatedHint = z.string().trim().min(1).max(300);

function comparisonText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("fil").replace(/[^\p{L}\p{N}]/gu, "");
}

// A future provider receives only the public exercise and the authored rule.
// Keep the solution on the server for screening responses before display.
export async function resolveHint({ text, word, root }, provider) {
  if (!provider || !word || !root) return text;

  const controller = new AbortController();
  let timer;
  try {
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, 2_200);
    });
    const candidate = await Promise.race([
      provider({ language: "fil", game: "pop", word, rule: text, signal: controller.signal }),
      deadline,
    ]);
    const parsed = generatedHint.safeParse(candidate);
    if (parsed.success && !comparisonText(parsed.data).includes(comparisonText(root))) return parsed.data;
  } catch {
    // Gameplay stays available when a provider is unavailable.
  } finally {
    clearTimeout(timer);
  }

  return text;
}
