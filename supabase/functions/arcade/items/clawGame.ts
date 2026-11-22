export const CLAW_GAME_ID = 6;
export const CLAW_POINTS = 100;
export const CLAW_XP = 100;

export const CLAW_ROLES = {
  tagaganap: { label: "Tagaganap", animal: "cat", detail: "Gumagawa ng kilos" },
  layon: { label: "Layon", animal: "turtle", detail: "Bagay na tinutukoy ng kilos" },
  ganapan: { label: "Ganapan", animal: "rabbit", detail: "Lugar na pinangyarihan ng kilos" },
  tagatanggap: { label: "Tagatanggap", animal: "chick", detail: "Pinaglalaanan ng kilos" },
} as const;

export type ClawRole = keyof typeof CLAW_ROLES;

interface FocusItem {
  role: ClawRole;
  verb: string;
  beforeFocus?: string;
  subject: string;
  afterFocus?: string;
  explanation: string;
}

const ITEMS: readonly FocusItem[] = [
  { role: "tagaganap", verb: "Nagluto", subject: "si Ana", afterFocus: "ng hapunan", explanation: "Si Ana ang gumawa ng kilos na pagluluto." },
  { role: "tagaganap", verb: "Tumalon", subject: "si Ben", afterFocus: "sa palaruan", explanation: "Si Ben ang gumawa ng kilos na pagtalon." },
  { role: "tagaganap", verb: "Umawit", subject: "ang mga bata", afterFocus: "sa entablado", explanation: "Ang mga bata ang gumawa ng kilos na pag-awit." },
  { role: "tagaganap", verb: "Nagtanim", subject: "si Lolo", afterFocus: "ng mga gulay sa bakuran", explanation: "Si Lolo ang gumawa ng kilos na pagtatanim." },
  { role: "layon", verb: "Binasa", beforeFocus: "ni Maya", subject: "ang aklat", afterFocus: "sa silid", explanation: "Ang aklat ang binasa ni Maya." },
  { role: "layon", verb: "Kinain", beforeFocus: "ni Pilo", subject: "ang suman", afterFocus: "pagkatapos ng laro", explanation: "Ang suman ang kinain ni Pilo." },
  { role: "layon", verb: "Tinahi", beforeFocus: "ni Lola", subject: "ang damit", afterFocus: "kagabi", explanation: "Ang damit ang tinahi ni Lola." },
  { role: "layon", verb: "Pinulot", beforeFocus: "ni Lira", subject: "ang lapis", afterFocus: "sa sahig", explanation: "Ang lapis ang pinulot ni Lira." },
  { role: "ganapan", verb: "Pinagtaniman", beforeFocus: "ng mga bata ng gulay", subject: "ang bakuran", explanation: "Ang bakuran ang lugar kung saan nagtanim ng gulay ang mga bata." },
  { role: "ganapan", verb: "Pinagdausan", beforeFocus: "ng paaralan ng programa", subject: "ang bulwagan", explanation: "Ang bulwagan ang lugar kung saan ginanap ang programa." },
  { role: "ganapan", verb: "Pinagpahingahan", beforeFocus: "ng mga bisita", subject: "ang silungan", explanation: "Ang silungan ang lugar kung saan nagpahinga ang mga bisita." },
  { role: "tagatanggap", verb: "Ipinagluto", beforeFocus: "ni Ate ng sopas", subject: "si Lola", explanation: "Si Lola ang pinaglaanan ng sopas na niluto ni Ate." },
  { role: "tagatanggap", verb: "Ibinili", beforeFocus: "ni Tatay ng lapis", subject: "si Ben", explanation: "Si Ben ang pinaglaanan ng lapis na binili ni Tatay." },
  { role: "tagatanggap", verb: "Ipinagtahi", beforeFocus: "ni Tita ng damit", subject: "si Maya", explanation: "Si Maya ang pinaglaanan ng damit na tinahi ni Tita." },
  { role: "tagatanggap", verb: "Ipinaghanda", beforeFocus: "ni Lira ng meryenda", subject: "ang mga bisita", explanation: "Ang mga bisita ang pinaglaanan ng meryenda." },
];

const ROLES = Object.keys(CLAW_ROLES) as ClawRole[];

function shuffle<T>(items: readonly T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function buildClawRun(firstRun: boolean) {
  const pool = shuffle(firstRun ? ITEMS.slice(1) : ITEMS);
  const required = ROLES.map((role) => firstRun && role === "tagaganap" ? ITEMS[0] : pool.find((item) => item.role === role)!);
  const extra = pool.find((item) => !required.includes(item))!;
  const items = firstRun ? [required[0], ...shuffle([...required.slice(1), extra])] : shuffle([...required, extra]);
  return items.map((item) => ({ ...item, options: shuffle(ROLES) }));
}
