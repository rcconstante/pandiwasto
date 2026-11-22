import type { ArcadeProgress } from "@/data/arcadeProgress";
import { supabaseClient } from "./auth";

export interface PopRun {
  runId: string;
  status: "active" | "completed" | "abandoned";
  round: number;
  totalRounds: number;
  hearts: number;
  score: number;
  xp: number;
  word?: string;
  hintUsed?: boolean;
  hadMiss?: boolean;
  studyActive?: boolean;
  hintAllowed?: boolean;
}

type PopTap = PopRun & (
  { outcome: "continue" }
  | { outcome: "miss"; root?: string }
  | { outcome: "solved"; root: string; points: number }
);

export class ArcadeRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function arcadeRequest<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  if (!supabaseClient) throw new Error("Account play is unavailable.");
  const { data: session, error: authError } = await supabaseClient.auth.getSession();
  if (authError || !session.session) throw new Error("Sign in again to use account play.");
  const timeout = AbortSignal.timeout(12_000);
  const { data, error } = await supabaseClient.functions.invoke<T>(`arcade/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${session.session.access_token}`,
    },
    body,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!error && data !== null) return data;
  const status = error?.context instanceof Response ? error.context.status : 503;
  if (status === 401) throw new ArcadeRequestError("Sign in again to use account play.", 401);
  if (status === 403) throw new ArcadeRequestError("This action is unavailable for your account.", 403);
  if (status === 409) throw new ArcadeRequestError("This changed on the server. Reopen this game to continue.", 409);
  if (status === 429) throw new ArcadeRequestError("Wait a moment, then try again.", 429);
  throw new ArcadeRequestError("The arcade server could not complete this request. Try again.", status);
}

export const loadAccountProgress = (signal?: AbortSignal) => arcadeRequest<ArcadeProgress>("progress", undefined, signal);
export const loadMastery = (signal?: AbortSignal) =>
  arcadeRequest<{ skills: { skillId: string; mastery: number; attempts: number }[] }>("mastery", undefined, signal);
export const loadAdminStatus = (signal?: AbortSignal) =>
  arcadeRequest<{ players: number; completedRuns: number; publishedScores: number }>("admin/status", undefined, signal);
export const startPopRun = (requestId: string) => arcadeRequest<PopRun>("pop/start", { requestId });
export const tapPopRun = (runId: string, tap: { tapId: string; expectedRound: number; removed: number[] }) =>
  arcadeRequest<PopTap>(`pop/${runId}/tap`, tap);
export const hintPopRun = (runId: string, expectedRound: number) => arcadeRequest<{ text: string }>(`pop/${runId}/hint`, { expectedRound });
export const endPopRun = (runId: string) => arcadeRequest(`pop/${runId}/end`, {});

export type RankedMove =
  | { type: "answer"; choice: string }
  | { type: "flip"; cardId: number }
  | { type: "hint" | "next" | "timeout" | "finish" | "abandon" };

export interface RankedSnapshot {
  gameId: number;
  runId: string;
  version: number;
  status: "active" | "completed" | "abandoned";
  phase: "playing" | "review";
  mode: "ranked" | "practice";
  score: number;
  xp: number;
  round: number;
  totalRounds: number | null;
  feedback: { kind: "correct" | "wrong" | "timeout" | "match" | "mismatch" | "board-complete"; text: string; points: number; answer?: string } | null;
  results: { text: string; points: number; meaning?: string }[];
  options?: { id: string; label: string; type?: string; affix?: string; suffix?: string }[];
  rejected?: string[];
  hint?: string | null;
  studyActive?: boolean;
  hintAllowed?: boolean;
  word?: string;
  root?: string;
  verb?: string;
  sentence?: string;
  hearts?: number;
  hits?: number;
  deadline?: number | null;
  serverNow?: number;
  hideAt?: number | null;
  pairsFound?: number;
  pairsTotal?: number;
  moves?: number;
  cards?: { id: number; word: string | null; matched: boolean; hinted: boolean }[];
}

export const startRankedGame = (id: number, requestId: string, mode: RankedSnapshot["mode"]) =>
  arcadeRequest<RankedSnapshot>(`games/${id}/start`, { requestId, mode });

export const moveRankedGame = (game: RankedSnapshot, requestId: string, action: RankedMove) =>
  arcadeRequest<RankedSnapshot>(`games/${game.gameId}/${game.runId}/move`, { requestId, version: game.version, action });

export const refreshRankedGame = (game: RankedSnapshot) =>
  arcadeRequest<RankedSnapshot>(`games/${game.gameId}/${game.runId}`);

export const getStudyState = (signal?: AbortSignal) => arcadeRequest<{
  state: "unavailable" | "invited" | "scheduled" | "pretest" | "practice" | "posttest" | "completed" | "closed";
}>("study/status", undefined, signal);
