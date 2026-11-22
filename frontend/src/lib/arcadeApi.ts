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
  hintLevel?: number;
  hadMiss?: boolean;
  studyActive?: boolean;
  hintAllowed?: boolean;
}

type PopTap = PopRun & (
  { outcome: "continue" }
  | { outcome: "miss"; root?: string; roundHearts?: number }
  | { outcome: "solved" | "skip"; root: string; points: number; roundHearts?: number }
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
export const setDeveloperMode = (enabled: boolean) => arcadeRequest<ArcadeProgress>("developer/mode", { enabled });
export const resetDeveloperProgress = (scope: "xp" | "gameplay", requestId: string) =>
  arcadeRequest<ArcadeProgress>("developer/reset", { scope, requestId });
export interface SkillMastery {
  skillId: string;
  mastery: number;
  attempts: number;
  mastered: boolean;
}

export const loadMastery = (signal?: AbortSignal) => arcadeRequest<{ skills: SkillMastery[] }>("mastery", undefined, signal);
export const loadRoles = (signal?: AbortSignal) => arcadeRequest<{ admin: boolean; teacher: boolean }>("roles", undefined, signal);
export const loadAdminStatus = (signal?: AbortSignal) =>
  arcadeRequest<{ players: number; completedRuns: number; publishedScores: number; hints?: number; aiHints?: number }>("admin/status", undefined, signal);

export const checkHintProvider = () => arcadeRequest<{
  configured: boolean; ok: boolean; model?: string | null; text?: string; error?: string; latencyMs?: number; available?: string[];
}>("admin/hints/check", {});

export type AccountRole ="student" | "teacher" | "admin";

export interface Account {
  id: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
  role: AccountRole;
  suspended: boolean;
  createdAt: string;
  lastSignInAt: string | null;
}

export interface ClassSummary {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
  students: number;
}

export interface StudentSummary {
  id: string;
  name: string;
  alias: string;
  avatar?: string | null;
  xp: number;
  lastActive: string | null;
  skills: SkillMastery[];
}

export interface StudentDetail extends StudentSummary {
  bestScores: Record<string, number>;
  hints: number;
  answers: {
    gameId: number;
    skillId: string;
    item: string;
    correct: boolean;
    firstAttempt: boolean;
    hintUsed: boolean;
    timedOut: boolean;
    responseMs: number;
    masteryBefore: number | null;
    masteryAfter: number | null;
    at: string;
  }[];
}

export const listAccounts = (search: string, page: number, signal?: AbortSignal) =>
  arcadeRequest<{ accounts: Account[]; hasMore: boolean }>("admin/accounts/list", { search, page }, signal);
export const createAccount = (account: { email: string; password: string; firstName: string; lastName: string; displayName: string; role: AccountRole }) =>
  arcadeRequest<{ accountId: string }>("admin/accounts/create", account);
export const setAccountRole = (accountId: string, role: AccountRole) => arcadeRequest<{ role: AccountRole }>("admin/accounts/role", { accountId, role });
export const setAccountSuspended = (accountId: string, suspended: boolean) =>
  arcadeRequest<{ suspended: boolean }>("admin/accounts/suspend", { accountId, suspended });
export const loadClasses = (signal?: AbortSignal) =>
  arcadeRequest<{ classes: ClassSummary[]; teachers: { id: string; name: string }[] }>("admin/classes", undefined, signal);
export const saveClass = (classId: string | null, name: string, teacherId: string | null) =>
  arcadeRequest<{ classId: string }>("admin/classes/save", { classId, name, teacherId });
export const deleteClass = (classId: string) => arcadeRequest<{ deleted: true }>("admin/classes/delete", { classId });
export const setClassMember = (classId: string, lookup: string, add: boolean) =>
  arcadeRequest<{ students: number }>("admin/classes/member", { classId, lookup, add });
export const loadTeacherClasses = (signal?: AbortSignal) =>
  arcadeRequest<{ classes: { id: string; name: string; students: number }[] }>("teacher/classes", undefined, signal);
export const loadClassRoster = (classId: string, signal?: AbortSignal) =>
  arcadeRequest<{ name: string; students: StudentSummary[] }>("teacher/class", { classId }, signal);
export const loadStudent = (classId: string, studentId: string, signal?: AbortSignal) =>
  arcadeRequest<StudentDetail>("teacher/student", { classId, studentId }, signal);
export const startPopRun = (requestId: string) => arcadeRequest<PopRun>("pop/start", { requestId });
export const tapPopRun = (runId: string, tap: { tapId: string; expectedRound: number; removed: number[] }) =>
  arcadeRequest<PopTap>(`pop/${runId}/tap`, tap);
export const hintPopRun = (runId: string, expectedRound: number, level: number) =>
  arcadeRequest<{ text: string; level: number }>(`pop/${runId}/hint`, { expectedRound, level });
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
  hintLevel?: number;
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
