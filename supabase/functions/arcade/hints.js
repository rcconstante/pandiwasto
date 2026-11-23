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

// Bump when the prompt or screening changes; every hint row records it.
export const PROMPT_VERSION = "fil-hint-v3";

const FILIPINO_WORDS = new Set(["ang", "ng", "sa", "mga", "na", "ay", "ito", "upang", "kung", "o", "at", "ba", "salita", "mo", "nito", "para"]);
const ENGLISH_WORDS = new Set(["the", "and", "is", "of", "to", "you", "this", "that", "word", "with", "for", "are"]);

/** Rough language screen: a hint must read as Filipino, not English. */
export function looksFilipino(text) {
  const words = text.toLocaleLowerCase("fil").split(/[^\p{L}-]+/u).filter(Boolean);
  const filipino = words.filter((word) => FILIPINO_WORDS.has(word)).length;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  return filipino >= 2 && english <= filipino / 3;
}

/** Mastery band the hint model is told: low below 0.4, medium below 0.7, otherwise high. */
export const masteryBand = (mastery) => mastery == null ? undefined : mastery < 0.4 ? "mababa" : mastery < 0.7 ? "katamtaman" : "mataas";

/**
 * Rephrases authored hints with an optional provider. The provider sees only the public
 * exercise, the authored text, wrong choices and a mastery band; the answer stays here for screening.
 * A provider returns the text, or { text, inputTokens, outputTokens }.
 * @param {((input: object) => Promise<string | { text: string, inputTokens?: number, outputTokens?: number } | null>) & { model?: string } | undefined} provider
 */
// The brief targets about 3 seconds for a hint.
export function createHintResolver(provider, { hourlyLimit = 300, timeoutMs = 3_000, now = Date.now } = {}) {
  const cache = new Map();
  let windowStart = now();
  let calls = 0;

  // fact: the item's own reviewed nudge (for example "May gitlapi sa loob."), sent with every
  // level so the model cannot invent the wrong affix when the level text is a general rule.
  const resolve = async ({ text, fact, level, word, wrong = [], secrets, cacheKey, band }) => {
    const authored = { text, source: "authored", model: null, latencyMs: 0, cacheHit: false, promptVersion: null };
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
      const candidate = await Promise.race([provider({ word, rule: text, fact, level, wrong, band, signal: controller.signal }), deadline]);
      const reply = typeof candidate === "string" ? { text: candidate } : candidate;
      const parsed = generatedHint.safeParse(reply?.text);
      const usable = parsed.success && !leaks(parsed.data, secrets, word) && looksFilipino(parsed.data);
      if (usable) {
        const result = {
          text: parsed.data, source: "ai", model: provider.model ?? null, latencyMs: now() - started, cacheHit: false,
          promptVersion: PROMPT_VERSION, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens,
        };
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
        cache.set(key, result);
        return result;
      }
      const reason = controller.signal.aborted ? "timeout" : !parsed.success ? "invalid text" : looksFilipino(parsed.data) ? "answer leak" : "not Filipino";
      console.warn("Generated hint not used", { reason, level });
    } catch (error) {
      // Gameplay stays available when a provider is unavailable.
      console.warn("Generated hint failed", { error: error instanceof Error ? error.message : "unknown", level });
    } finally {
      clearTimeout(timer);
    }
    return { ...authored, latencyMs: now() - started };
  };
  // Routes skip the mastery lookup when no provider would use it.
  resolve.usesProvider = Boolean(provider);
  return resolve;
}
