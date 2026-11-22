type Affix = "unlapi" | "gitlapi" | "hulapi";

export interface BalloonWord {
  word: string;
  root: string;
  affix: Affix;
}

const WORDS: readonly BalloonWord[] = [
  { word: "SUMAKAY", root: "SAKAY", affix: "gitlapi" },
  { word: "SUMULAT", root: "SULAT", affix: "gitlapi" },
  { word: "BUMILI", root: "BILI", affix: "gitlapi" },
  { word: "KUMAIN", root: "KAIN", affix: "gitlapi" },
  { word: "TUMAKBO", root: "TAKBO", affix: "gitlapi" },
  { word: "LUMIPAD", root: "LIPAD", affix: "gitlapi" },
  { word: "TINAHI", root: "TAHI", affix: "gitlapi" },
  { word: "MAGLARO", root: "LARO", affix: "unlapi" },
  { word: "MAGBASA", root: "BASA", affix: "unlapi" },
  { word: "NAGWALIS", root: "WALIS", affix: "unlapi" },
  { word: "NAGLUTO", root: "LUTO", affix: "unlapi" },
  { word: "NAGLINIS", root: "LINIS", affix: "unlapi" },
  { word: "HUGASAN", root: "HUGAS", affix: "hulapi" },
  { word: "BASAHIN", root: "BASA", affix: "hulapi" },
  { word: "SULATIN", root: "SULAT", affix: "hulapi" },
  { word: "LINISIN", root: "LINIS", affix: "hulapi" },
  { word: "TANIMAN", root: "TANIM", affix: "hulapi" },
];

export const AFFIX_HINTS: Record<Affix, string> = {
  unlapi: "May unlapi sa unahan. Tingnan ang mga unang titik.",
  gitlapi: "May gitlapi sa loob. Tingnan ang mga titik pagkatapos ng unang titik.",
  hulapi: "May hulapi sa dulo. Tingnan ang mga huling titik.",
};

const ROUNDS_PER_GAME = 5;
export const BALLOON_GAME_ID = 1;
export const XP_PER_ROUND = 20;

export const MAX_ROUND_SCORE = 100;

export function buildBalloonRun(firstRun: boolean): BalloonWord[] {
  const pool = firstRun ? WORDS.slice(1) : [...WORDS];
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return firstRun ? [WORDS[0], ...pool.slice(0, ROUNDS_PER_GAME - 1)] : pool.slice(0, ROUNDS_PER_GAME);
}
