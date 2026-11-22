export const XP_PER_LEVEL = 100;

export interface ArcadeProgress {
  bestScores: Record<number, number>;
  xp: number;
  developer?: { available: boolean; enabled: boolean };
}
