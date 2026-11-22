export const FORTUNE_GAME_ID = 7;
export const FORTUNE_POINTS = 100;
export const FORTUNE_XP = 100;

const PREFIXES = ["pang", "pam", "pan"] as const;
type Prefix = (typeof PREFIXES)[number];

export const FORTUNE_HINTS: Record<Prefix, string> = {
  pam: "Sa mga halimbawang nagsisimula sa b o p, nagiging pam- ang pang-.",
  pan: "Sa mga halimbawang nagsisimula sa d, l o t, nagiging pan- ang pang-.",
  pang: "Sa salitang ito, nananatiling pang- ang panlapi.",
};

interface FortuneItem {
  root: string;
  prefix: Prefix;
}

const ITEMS: FortuneItem[] = [
  { root: "bansa", prefix: "pam" },
  { root: "bahay", prefix: "pam" },
  { root: "pamilya", prefix: "pam" },
  { root: "paaralan", prefix: "pam" },
  { root: "linis", prefix: "pan" },
  { root: "dikit", prefix: "pan" },
  { root: "tinda", prefix: "pan" },
  { root: "tali", prefix: "pan" },
  { root: "gupit", prefix: "pang" },
  { root: "kusina", prefix: "pang" },
  { root: "gabi", prefix: "pang" },
  { root: "walis", prefix: "pang" },
];

function shuffle<T>(items: readonly T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function buildFortuneRun(firstRun: boolean) {
  const pool = shuffle(firstRun ? ITEMS.slice(1) : ITEMS);
  const required = PREFIXES.map((prefix) => firstRun && prefix === "pam" ? ITEMS[0] : pool.find((item) => item.prefix === prefix)!);
  const extras = pool.filter((item) => !required.includes(item)).slice(0, 2);
  const items = firstRun ? [ITEMS[0], ...shuffle([...required.filter((item) => item !== ITEMS[0]), ...extras])] : shuffle([...required, ...extras]);
  return items.map(({ root, prefix }) => ({
    root,
    prefix,
    answer: `${prefix}${root}`,
    choices: shuffle([...PREFIXES.map((form) => `${form}${root}`), root]),
  }));
}
