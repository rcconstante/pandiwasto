import type { ArcadeProgress } from "@/data/arcadeProgress";
import { authClient } from "./auth";

export const arcadeApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "") ?? "";

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

export interface PopAnswer extends PopRun {
  correct: boolean;
  root?: string;
  points: number;
  roundWord: string;
}

export class ArcadeRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function arcadeRequest<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  if (!arcadeApiUrl || !authClient) throw new Error("Account play is unavailable.");
  const { data, error } = await authClient.getSession();
  if (error || !data.session) throw new Error("Sign in again to use account play.");
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(`${arcadeApiUrl}/api/arcade/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (response.status === 401) throw new ArcadeRequestError("Sign in again to use account play.", 401);
  if (response.status === 403) throw new ArcadeRequestError("This action is unavailable for your account.", 403);
  if (response.status === 409) throw new ArcadeRequestError("This changed on the server. Reopen this game to continue.", 409);
  if (response.status === 429) throw new ArcadeRequestError("Wait a moment, then try again.", 429);
  if (!response.ok) throw new ArcadeRequestError("The server could not save this request. Try again.", response.status);
  return response.json() as Promise<T>;
}

export const loadAccountProgress = (signal?: AbortSignal) => arcadeRequest<ArcadeProgress>("progress", undefined, signal);
export const loadMastery = (signal?: AbortSignal) =>
  arcadeRequest<{ skills: { skillId: string; mastery: number; attempts: number }[] }>("mastery", undefined, signal);
export const loadAdminStatus = (signal?: AbortSignal) =>
  arcadeRequest<{ players: number; completedRuns: number; publishedScores: number }>("admin/status", undefined, signal);
export const startPopRun = (requestId: string) => arcadeRequest<PopRun>("pop/start", { requestId });
export const answerPopRun = (runId: string, answer: { answerId: string; expectedRound: number; response: string }) =>
  arcadeRequest<PopAnswer>(`pop/${runId}/answer`, answer);
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
