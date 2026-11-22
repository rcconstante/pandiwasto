export const WHACK_GAME_ID = 2;
export const FIRST_WINDOW_MS = 10_000;
export const STARTING_LIVES = 3;
export const POINTS_PER_HIT = 100;
export const XP_PER_HIT = 10;

export const WORD_TYPES = [
  { id: "payak", label: "Payak", explanation: "Salitang-ugat lamang.", example: "bata" },
  { id: "maylapi", label: "Maylapi", explanation: "May panlaping idinagdag sa salitang-ugat.", example: "sumulat" },
  { id: "tambalan", label: "Tambalan", explanation: "Binuo mula sa dalawang salita.", example: "bahay-kubo" },
  { id: "inuulit", label: "Inuulit", explanation: "Inuulit ang buong salita o bahagi nito.", example: "araw-araw" },
] as const;

export type WordType = (typeof WORD_TYPES)[number]["id"];
export interface WhackWord {
  text: string;
  type: WordType;
}

const GROUPS: Record<WordType, readonly string[]> = {
  payak: ["bata", "bahay", "aklat", "araw", "ulap", "ilog", "bato"],
  maylapi: ["sumulat", "nagluto", "magbasa", "basahin", "nilinis", "kumanta", "nagwalis"],
  tambalan: ["bahay-kubo", "kapitbahay", "hanapbuhay", "bukang-liwayway", "takipsilim", "silid-aklatan", "bahaghari"],
  inuulit: ["gabi-gabi", "araw-araw", "isa-isa", "sama-sama", "babasa", "lalakad", "kakain"],
};

export function dealWhackDeck(lastWord?: string): WhackWord[] {
  const deck = WORD_TYPES.flatMap(({ id }) => GROUPS[id].map((text) => ({ text, type: id })));
  for (let index = deck.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  if (deck[0].text === lastWord) [deck[0], deck[1]] = [deck[1], deck[0]];
  return deck;
}

export function whackWindow(hits: number) {
  return Math.max(5_000, FIRST_WINDOW_MS - Math.floor(hits / 5) * 1_000);
}
