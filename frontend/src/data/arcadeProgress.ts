import { BALLOON_GAME_ID } from "./balloonGame";
import { WHACK_GAME_ID } from "./whackGame";
import { TOSS_GAME_ID } from "./tossGame";
import { MEMORY_GAME_ID } from "./memoryGame";
import { TICKET_GAME_ID } from "./ticketGame";
import { CLAW_GAME_ID } from "./clawGame";
import { FORTUNE_GAME_ID } from "./fortuneGame";

export const XP_PER_LEVEL = 100;

export interface ArcadeProgress {
  bestScores: Record<number, number>;
  xp: number;
}

function playerKey(playerId?: string) {
  return playerId ?? "guest";
}

function readNonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function loadArcadeProgress(playerId?: string): ArcadeProgress {
  const key = playerKey(playerId);
  try {
    const saved = JSON.parse(localStorage.getItem(`pandiwasto:arcade-progress:${key}`) ?? "null");
    const legacy = saved ? null : JSON.parse(localStorage.getItem(`pandiwasto:pop-progress:${key}`) ?? "null");
    return {
      bestScores: {
        [BALLOON_GAME_ID]: readNonnegativeInteger(saved?.bestScores?.[BALLOON_GAME_ID] ?? legacy?.bestScore),
        [WHACK_GAME_ID]: readNonnegativeInteger(saved?.bestScores?.[WHACK_GAME_ID]),
        [TOSS_GAME_ID]: readNonnegativeInteger(saved?.bestScores?.[TOSS_GAME_ID]),
        [MEMORY_GAME_ID]: readNonnegativeInteger(saved?.bestScores?.[MEMORY_GAME_ID]),
        [TICKET_GAME_ID]: readNonnegativeInteger(saved?.bestScores?.[TICKET_GAME_ID]),
        [CLAW_GAME_ID]: readNonnegativeInteger(saved?.bestScores?.[CLAW_GAME_ID]),
        [FORTUNE_GAME_ID]: readNonnegativeInteger(saved?.bestScores?.[FORTUNE_GAME_ID]),
      },
      xp: readNonnegativeInteger(saved?.xp ?? legacy?.xp),
    };
  } catch {
    return { bestScores: {}, xp: 0 };
  }
}

export function saveArcadeProgress(progress: ArcadeProgress, playerId?: string) {
  try {
    localStorage.setItem(`pandiwasto:arcade-progress:${playerKey(playerId)}`, JSON.stringify(progress));
  } catch {
    // The current session still works when browser storage is unavailable.
  }
}
