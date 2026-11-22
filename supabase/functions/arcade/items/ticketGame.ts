export const TICKET_GAME_ID = 5;
export const TICKET_ROUNDS = 5;
export const TICKET_POINTS = 100;
export const TICKET_XP = 100;

export type TicketKind = "ganap" | "parsiyal";

interface TicketQuestion {
  kind: TicketKind;
  root: string;
  repeated: string;
  sentence: string;
}

export const TICKET_LEVERS = [
  { kind: "ganap", label: "Ganap", detail: "Repeat the whole word" },
  { kind: "parsiyal", label: "Parsiyal", detail: "Repeat part of the word" },
] as const;

const QUESTIONS: readonly TicketQuestion[] = [
  { kind: "ganap", root: "gabi", repeated: "gabi", sentence: "Nagbabasa kami ng kuwento ___ bago matulog." },
  { kind: "parsiyal", root: "sulat", repeated: "su", sentence: "Bukas, ___ si Ana ng liham para kay Lola." },
  { kind: "ganap", root: "araw", repeated: "araw", sentence: "___ na nagdidilig si Lolo ng mga halaman." },
  { kind: "ganap", root: "isa", repeated: "isa", sentence: "___ nilang inilagay ang mga lapis sa kahon." },
  { kind: "ganap", root: "sama", repeated: "sama", sentence: "___ kaming umawit sa entablado." },
  { kind: "ganap", root: "dahan", repeated: "dahan", sentence: "___ na inilapag ni Lira ang baso sa mesa." },
  { kind: "ganap", root: "sunod", repeated: "sunod", sentence: "___ ang mga sasakyang dumaan sa tulay." },
  { kind: "ganap", root: "dala", repeated: "dala", sentence: "___ ni Ben ang payong sa pag-uwi." },
  { kind: "parsiyal", root: "takbo", repeated: "ta", sentence: "___ si Lino papunta sa puno kapag narinig niya ang pito." },
  { kind: "parsiyal", root: "basa", repeated: "ba", sentence: "Mamayang hapon, ___ ako ng bagong aklat." },
  { kind: "parsiyal", root: "lakad", repeated: "la", sentence: "___ kami papuntang parke bukas." },
  { kind: "parsiyal", root: "kain", repeated: "ka", sentence: "___ tayo ng suman pagkatapos maglaro." },
  { kind: "parsiyal", root: "guhit", repeated: "gu", sentence: "___ si Maya ng saranggola sa papel." },
  { kind: "parsiyal", root: "talon", repeated: "ta", sentence: "___ si Pilo sa ibabaw ng guhit sa lupa." },
];

export function ticketWord(question: TicketQuestion) {
  return `${question.repeated}${question.kind === "ganap" ? "-" : ""}${question.root}`;
}

function shuffle<T>(items: readonly T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function buildTicketRun(firstRun: boolean) {
  const pool = firstRun ? QUESTIONS.slice(2) : QUESTIONS;
  const full = shuffle(pool.filter(({ kind }) => kind === "ganap"));
  const partial = shuffle(pool.filter(({ kind }) => kind === "parsiyal"));
  if (firstRun) {
    const extra = Math.random() < 0.5 ? full[1] : partial[1];
    return [...QUESTIONS.slice(0, 2), ...shuffle([full[0], partial[0], extra])];
  }

  const fullCount = Math.random() < 0.5 ? 2 : 3;
  return shuffle([...full.slice(0, fullCount), ...partial.slice(0, TICKET_ROUNDS - fullCount)]);
}
