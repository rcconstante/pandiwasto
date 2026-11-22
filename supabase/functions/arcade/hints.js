import { z } from "npm:zod@4.6.7";
import { LESSONS } from "./items/lessons.ts";

export const HINT_LEVELS = 3;
const HOUR = 3_600_000;
const CACHE_LIMIT = 500;
const generatedHint = z.string().trim().min(1).max(300);

function comparisonText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("fil").replace(/[^\p{L}\p{N}]/gu, "");
}

// Short secrets such as the affix "-in" must match a whole word, or every "hanapin" would count.
// The puzzle word is already on screen, so repeating it is not a leak even when the answer
// (the root SIPILYO inside MAGSIPILYO) is part of it.
function leaks(text, secrets, shown = "") {
  const visible = comparisonText(text);
  const words = new Set(text.normalize("NFKC").toLocaleLowerCase("fil").split(/[^\p{L}\p{N}]+/u));
  const onScreen = comparisonText(shown);
  return secrets.some((secret) => {
    const hidden = comparisonText(secret ?? "");
    if (!hidden.length) return false;
    if (hidden.length < 4) return words.has(hidden);
    const checked = onScreen.includes(hidden) ? visible.replaceAll(onScreen, "") : visible;
    return checked.includes(hidden);
  });
}

/**
 * Authored hint for a ladder level: 1 is the item's nudge, 2 the lesson rule, and 3 the
 * lesson examples. If any example contains the answer word, level 3 repeats the rule:
 * dropping only that example would point at the answer by its absence.
 */
export function hintLadder(gameId, level, nudge, answerWords) {
  if (level <= 1) return nudge;
  const lessons = LESSONS.filter((lesson) => lesson.gameId === gameId);
  const rule = lessons.map(({ explanation }) => explanation).join(" ");
  if (level === 2) return rule;
  const examples = lessons.flatMap(({ example }) => example.split(" · "));
  return examples.some((example) => leaks(example, answerWords)) ? rule : "Halimbawa: " + examples.join(" · ");
}

/**
 * Rephrases authored hints with an optional provider. The provider sees only the public
 * exercise, the authored text and wrong choices; the answer stays here for screening.
 * @param {((input: object) => Promise<string | null>) & { model?: string } | undefined} provider
 */
// The brief targets about 3 seconds for a hint.
export function createHintResolver(provider, { hourlyLimit = 300, timeoutMs = 3_000, now = Date.now } = {}) {
  const cache = new Map();
  let windowStart = now();
  let calls = 0;

  // fact: the item's own reviewed nudge (for example "May gitlapi sa loob."), sent with every
  // level so the model cannot invent the wrong affix when the level text is a general rule.
  return async ({ text, fact, level, word, wrong = [], secrets, cacheKey }) => {
    const authored = { text, source: "authored", model: null, latencyMs: 0, cacheHit: false };
    // Level 3 is the reviewed worked example; rewriting it tended to turn it into the answer's steps.
    if (!provider || !word || level >= HINT_LEVELS) return authored;
    const key = JSON.stringify([cacheKey, level, [...wrong].sort()]);
    const cached = cache.get(key);
    if (cached) return { ...cached, latencyMs: 0, cacheHit: true };
    if (now() - windowStart >= HOUR) {
      windowStart = now();
      calls = 0;
    }
    // shortcut: the cost cap and cache are per Edge Function instance; use a shared store if several instances run.
    if (calls >= hourlyLimit) return authored;
    calls += 1;

    const started = now();
    const controller = new AbortController();
    let timer;
    try {
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, timeoutMs);
      });
      const candidate = await Promise.race([provider({ word, rule: text, fact, level, wrong, signal: controller.signal }), deadline]);
      const parsed = generatedHint.safeParse(candidate);
      if (parsed.success && !leaks(parsed.data, secrets, word)) {
        const result = { text: parsed.data, source: "ai", model: provider.model ?? null, latencyMs: now() - started, cacheHit: false };
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
        cache.set(key, result);
        return result;
      }
      console.warn("Generated hint not used", { reason: controller.signal.aborted ? "timeout" : parsed.success ? "answer leak" : "invalid text", level });
    } catch (error) {
      // Gameplay stays available when a provider is unavailable.
      console.warn("Generated hint failed", { error: error instanceof Error ? error.message : "unknown", level });
    } finally {
      clearTimeout(timer);
    }
    return { ...authored, latencyMs: now() - started };
  };
}
