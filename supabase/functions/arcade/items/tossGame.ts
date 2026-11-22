export const TOSS_GAME_ID = 3;
export const TOSS_ROUNDS = 5;
export const TOSS_XP_PER_ROUND = 20;
export const TOSS_MAX_POINTS = 100;

export const AFFIX_TYPES = [
  { id: "unlapi", label: "Unlapi", clue: "Inilalagay ang panlapi sa unahan ng salitang-ugat.", example: "mag- + laro" },
  { id: "gitlapi", label: "Gitlapi", clue: "Isingit ang panlapi sa loob ng salitang-ugat, pagkatapos ng unang katinig.", example: "s + -um- + ulat" },
  { id: "hulapi", label: "Hulapi", clue: "Idinadagdag ang panlapi sa hulihan ng salitang-ugat.", example: "linis + -in" },
  { id: "kabilaan", label: "Kabilaan", clue: "May panlapi sa unahan at sa hulihan ng salitang-ugat.", example: "pag- + aral + -an" },
] as const;

export type TossAffixType = (typeof AFFIX_TYPES)[number]["id"];
export type AffixTile =
  | { type: "unlapi" | "gitlapi" | "hulapi"; affix: string }
  | { type: "kabilaan"; affix: string; suffix: string };

export interface TossPuzzle {
  root: string;
  sentence: string;
  answerTile: AffixTile;
}
export type TossRound = TossPuzzle & { choices: AffixTile[] };

const PUZZLES: readonly TossPuzzle[] = [
  { root: "laro", sentence: "Mahilig ___ ng patintero si Mira.", answerTile: { type: "unlapi", affix: "mag" } },
  { root: "luto", sentence: "Gusto ni Kuya na ___ ng sinigang.", answerTile: { type: "unlapi", affix: "mag" } },
  { root: "walis", sentence: "Kahapon, ___ si Mila sa bakuran.", answerTile: { type: "unlapi", affix: "nag" } },
  { root: "linis", sentence: "Kailangang ___ ng silid ang pangkat.", answerTile: { type: "unlapi", affix: "mag" } },
  { root: "sulat", sentence: "Kahapon, ___ si Lea ng liham para kay Lola.", answerTile: { type: "gitlapi", affix: "um" } },
  { root: "tahi", sentence: "Kagabi, ___ ni Lola ang punit na damit.", answerTile: { type: "gitlapi", affix: "in" } },
  { root: "takbo", sentence: "Nang tumunog ang pito, ___ si Niko patungo sa linya ng pagtatapos.", answerTile: { type: "gitlapi", affix: "um" } },
  { root: "kain", sentence: "Bago pumasok, ___ muna si Lino ng almusal.", answerTile: { type: "gitlapi", affix: "um" } },
  { root: "basa", sentence: "Bago sumagot, ___ mo muna ang tanong.", answerTile: { type: "hulapi", affix: "hin" } },
  { root: "sulat", sentence: "___ mo ang iyong sagot sa papel.", answerTile: { type: "hulapi", affix: "in" } },
  { root: "linis", sentence: "Pagkatapos maglaro, ___ mo ang mesa.", answerTile: { type: "hulapi", affix: "in" } },
  { root: "hugas", sentence: "Bago kumain, ___ mo ang iyong mga kamay.", answerTile: { type: "hulapi", affix: "an" } },
  { root: "aral", sentence: "Dapat nating ___ ang paksang ito.", answerTile: { type: "kabilaan", affix: "pag", suffix: "an" } },
  { root: "sipag", sentence: "Hinangaan ng guro ang ___ ng mga bata.", answerTile: { type: "kabilaan", affix: "ka", suffix: "an" } },
  { root: "saya", sentence: "Nagkaroon ng ___ sa pista.", answerTile: { type: "kabilaan", affix: "ka", suffix: "han" } },
  { root: "buti", sentence: "Ipakita ang ___ sa iyong kapwa.", answerTile: { type: "kabilaan", affix: "ka", suffix: "han" } },
];

function shuffle<T>(items: readonly T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

export function firstTossExample() {
  return PUZZLES[0];
}

function mistakenTiles(puzzle: TossPuzzle): Record<TossAffixType, AffixTile> {
  const endsInVowel = /[aeiou]$/i.test(puzzle.root);
  return {
    unlapi: { type: "unlapi", affix: "mag" },
    gitlapi: { type: "gitlapi", affix: puzzle.answerTile.type === "unlapi" ? "in" : "um" },
    hulapi: { type: "hulapi", affix: endsInVowel ? "hin" : "in" },
    kabilaan: { type: "kabilaan", affix: "pag", suffix: endsInVowel ? "han" : "an" },
  };
}

export function buildTossRun(firstRun: boolean): TossRound[] {
  const oneOfEach = AFFIX_TYPES.map(({ id }) => {
    if (firstRun && id === "unlapi") return firstTossExample();
    return shuffle(PUZZLES.filter((puzzle) => puzzle.answerTile.type === id))[0];
  });
  const spare = shuffle(PUZZLES.filter((puzzle) => !oneOfEach.includes(puzzle)))[0];
  const selected = firstRun ? [oneOfEach[0], ...shuffle([...oneOfEach.slice(1), spare])] : shuffle([...oneOfEach, spare]);
  return selected.map((puzzle) => {
    const byType = mistakenTiles(puzzle);
    byType[puzzle.answerTile.type] = puzzle.answerTile;
    return { ...puzzle, choices: shuffle(Object.values(byType)) };
  });
}

export function tileLabel(tile: AffixTile) {
  switch (tile.type) {
    case "unlapi": return `${tile.affix}-`;
    case "gitlapi": return `-${tile.affix}-`;
    case "hulapi": return `-${tile.affix}`;
    case "kabilaan": return `${tile.affix}- … -${tile.suffix}`;
  }
}

export function applyAffix(root: string, tile: AffixTile) {
  if (tile.type === "gitlapi") return root[0] + tile.affix + root.slice(1);
  if (tile.type === "hulapi") return root + tile.affix;
  const hyphen = /^(mag|nag|pag)$/.test(tile.affix) && /^[aeiou]/.test(root) ? "-" : "";
  const prefixedRoot = tile.affix + hyphen + root;
  return tile.type === "kabilaan" ? prefixedRoot + tile.suffix : prefixedRoot;
}
