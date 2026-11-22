export const MEMORY_GAME_ID = 4;
export const MEMORY_XP = 100;
export const POINTS_PER_PAIR = 100;
const MISMATCH_PENALTY = 15;
const HINT_PENALTY = 25;

export interface CompoundPair {
  words: readonly [string, string];
  compound: string;
  meaning: string;
}

export interface MemoryCard {
  id: string;
  word: string;
  pair: CompoundPair;
}

export interface MemoryBoard {
  pairs: CompoundPair[];
  cards: MemoryCard[];
}

const PAIRS: readonly CompoundPair[] = [
  { words: ["bahay", "kubo"], compound: "bahay-kubo", meaning: "Munting bahay na karaniwang yari sa kawayan at nipa." },
  { words: ["hanap", "buhay"], compound: "hanapbuhay", meaning: "Trabaho o pagkakakitaan." },
  { words: ["balik", "bayan"], compound: "balikbayan", meaning: "Pilipinong umuuwi mula sa ibang bansa." },
  { words: ["takip", "silim"], compound: "takipsilim", meaning: "Oras ng papadilim na kasunod ng paglubog ng araw." },
  { words: ["balat", "sibuyas"], compound: "balat-sibuyas", meaning: "Taong madaling masaktan ang damdamin." },
  { words: ["bukas", "palad"], compound: "bukas-palad", meaning: "Kusang nagbibigay o tumutulong sa kapwa." },
  { words: ["basag", "ulo"], compound: "basag-ulo", meaning: "Gulo o pag-aaway." },
  { words: ["sulat", "kamay"], compound: "sulat-kamay", meaning: "Sulat na ginawa sa pamamagitan ng kamay." },
  { words: ["ningas", "kugon"], compound: "ningas-kugon", meaning: "Masigasig sa simula ngunit madaling mawalan ng sigla." },
  { words: ["anak", "pawis"], compound: "anak-pawis", meaning: "Taong naghahanapbuhay sa pamamagitan ng pisikal na paggawa." },
  { words: ["tulog", "mantika"], compound: "tulog-mantika", meaning: "Napakahimbing matulog at mahirap gisingin." },
  { words: ["tubig", "alat"], compound: "tubig-alat", meaning: "Maalat na tubig, gaya ng tubig sa dagat." },
  { words: ["lakad", "pagong"], compound: "lakad-pagong", meaning: "Napakabagal na paglakad." },
  { words: ["bantay", "salakay"], compound: "bantay-salakay", meaning: "Tagapagbantay na siya ring nanloloob o nagnanakaw." },
  { words: ["langit", "lupa"], compound: "langit-lupa", meaning: "Larong habulan na may ligtas na mga lugar na mas mataas sa lupa." },
];

const BOARD_SIZES = [3, 4, 5];
export const MEMORY_MAX_SCORE = BOARD_SIZES.reduce((total, size) => total + size, 0) * POINTS_PER_PAIR;

function shuffle<T>(items: readonly T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function buildMemoryRun(firstRun: boolean): MemoryBoard[] {
  const pool = firstRun ? [PAIRS[0], ...shuffle(PAIRS.slice(1))] : shuffle(PAIRS);
  let offset = 0;
  return BOARD_SIZES.map((size) => {
    const pairs = pool.slice(offset, offset + size);
    offset += size;
    return {
      pairs,
      cards: shuffle(pairs.flatMap((pair) => pair.words.map((word) => ({ id: word, word, pair })))),
    };
  });
}

export function memoryScore(matches: number, misses: number, usedHint: boolean) {
  return Math.max(0, matches * POINTS_PER_PAIR - misses * MISMATCH_PENALTY - Number(usedHint) * HINT_PENALTY);
}
