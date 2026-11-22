import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft, ArrowRight, ChevronDown, ClipboardCheck, Lock, LogOut, Play, Settings, ShieldCheck, Star, Trophy, UserRound } from "lucide-react";
import { DropdownMenu, Tabs } from "radix-ui";
import { authClient } from "@/lib/auth";
import { ArcadeRequestError, getStudyState, loadAccountProgress, loadAdminStatus, loadMastery } from "@/lib/arcadeApi";
import { BalloonGame } from "@/components/games/BalloonGame";
import { XP_PER_LEVEL, type ArcadeProgress } from "@/data/arcadeProgress";
import { BALLOON_GAME_ID } from "@/data/balloonGame";
import { DASHBOARD_LESSONS } from "@/data/dashboardLessons";
import { MINIGAMES } from "@/data/landingData";
import { avatarSrc, type ProfileDetails, readProfile } from "@/data/dashboardProfile";
import { DashboardProfile } from "./DashboardProfile";
import { DashboardAdmin } from "./DashboardAdmin";
import { DashboardStudy, type StudyStage } from "./DashboardStudy";
import { DashboardRankings } from "./DashboardRankings";
import { DashboardSettings } from "./DashboardSettings";
import "./dashboard.css";

const TABS = [
  { id: "games", label: "Games" },
  { id: "lessons", label: "Lessons" },
  { id: "rankings", label: "Rankings" },
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
  { id: "study", label: "Study" },
];
const RankedGame = lazy(async () => ({ default: (await import("@/components/games/RankedGame")).RankedGame }));

const GAME_GUIDES: Record<number, string> = {
  [BALLOON_GAME_ID]: "Find the root word in five rounds.",
  2: "Match each word to its type before the mole ducks.",
  3: "Choose a panlapi to complete each sentence.",
  4: "Flip cards to make Filipino compound words.",
  5: "Pull the lever that completes the Filipino sentence.",
  6: "Grab the doll that matches the verb focus.",
  7: "Predict the word made with pang- before the card prints.",
};

export function Dashboard({ user, onHome }: {
  user: User;
  onHome: () => void;
}) {
  const [tab, setTab] = useState("games");
  const [gameIndex, setGameIndex] = useState(0);
  const [gameDirection, setGameDirection] = useState(0);
  const [gameOpen, setGameOpen] = useState(false);
  const [accountProgress, setAccountProgress] = useState<ArcadeProgress | null>(null);
  const [accountError, setAccountError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [mastery, setMastery] = useState<Awaited<ReturnType<typeof loadMastery>>["skills"]>([]);
  const [admin, setAdmin] = useState<Awaited<ReturnType<typeof loadAdminStatus>> | null>(null);
  const [studyState, setStudyState] = useState<StudyStage>("unavailable");
  const [profile, setProfile] = useState<ProfileDetails>(() => readProfile(user));
  const [exitError, setExitError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const gamesTab = useRef<HTMLButtonElement>(null);
  const rankingsTab = useRef<HTMLButtonElement>(null);
  const profileTab = useRef<HTMLButtonElement>(null);
  const settingsTab = useRef<HTMLButtonElement>(null);
  const menuFocus = useRef<HTMLButtonElement | null>(null);
  const currentCard = useRef<HTMLButtonElement>(null);
  const base = import.meta.env.BASE_URL;
  const currentGame = MINIGAMES[gameIndex];
  const canStartGames = accountProgress !== null && !accountError;
  const gameStatus = accountError ? "Games unavailable" : canStartGames ? "Ready to play" : "Loading account progress…";
  const tabs = admin ? [...TABS, { id: "admin", label: "Admin" }] : TABS;
  const studyPractice = studyState === "practice";
  const level = accountProgress ? 1 + Math.floor(accountProgress.xp / XP_PER_LEVEL) : null;
  const playerName = profile.displayName || "Player";
  const firstName = profile.firstName || playerName.split(/\s+/)[0];
  const locked = level !== null && !studyPractice && currentGame.unlockLevel > level;
  const personalBest = accountProgress?.bestScores[currentGame.id] ?? 0;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!gameOpen) title.current?.focus({ preventScroll: true });
  }, [gameOpen]);

  useEffect(() => {
    const abort = new AbortController();
    void loadAccountProgress(abort.signal).then((data) => {
      if (abort.signal.aborted) return;
      setAccountProgress(data);
      setAccountError("");
    }).catch((error: unknown) => {
      if (abort.signal.aborted) return;
      setAccountError(error instanceof ArcadeRequestError && error.status === 404
        ? "The arcade function has not been deployed to this Supabase project."
        : "Account progress is temporarily unavailable.");
    });
    return () => abort.abort();
  }, [refresh]);

  useEffect(() => {
    if (tab !== "games") return;
    const abort = new AbortController();
    void getStudyState(abort.signal).then((result) => {
      if (!abort.signal.aborted) setStudyState(result.state);
    }).catch(() => {});
    return () => abort.abort();
  }, [refresh, tab]);

  useEffect(() => {
    if (tab !== "lessons") return;
    const abort = new AbortController();
    void loadMastery(abort.signal).then((result) => {
      if (!abort.signal.aborted) setMastery(result.skills);
    }).catch(() => {});
    return () => abort.abort();
  }, [refresh, tab]);

  useEffect(() => {
    const abort = new AbortController();
    void loadAdminStatus(abort.signal).then((status) => {
      if (!abort.signal.aborted) setAdmin(status);
    }).catch(() => {
      if (!abort.signal.aborted) setAdmin(null);
    });
    return () => abort.abort();
  }, [refresh]);

  function chooseGame(index: number, direction = Math.sign(index - gameIndex)) {
    setGameDirection(direction);
    setGameIndex((index + MINIGAMES.length) % MINIGAMES.length);
  }

  function openCard(index: number, direction: number) {
    const game = MINIGAMES[index];
    chooseGame(index, direction);
    if (canStartGames && level !== null && (studyPractice || game.unlockLevel <= level)) {
      setGameOpen(true);
    } else if (index !== gameIndex) {
      requestAnimationFrame(() => currentCard.current?.focus());
    }
  }

  function showRelatedGame(gameId: number) {
    const index = MINIGAMES.findIndex((game) => game.id === gameId);
    if (index < 0) return;
    chooseGame(index);
    setTab("games");
    requestAnimationFrame(() => gamesTab.current?.focus());
  }

  async function exit() {
    setLeaving(true);
    setExitError("");
    try {
      const result = await authClient?.signOut({ scope: "local" });
      if (result?.error) throw result.error;
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch {
      setExitError("We couldn’t sign you out. Try again.");
    } finally {
      setLeaving(false);
    }
  }

  if (gameOpen) {
    if (currentGame.id === BALLOON_GAME_ID) {
      return <BalloonGame accountPlay personalBest={personalBest} onComplete={() => setRefresh((count) => count + 1)} onExit={() => setGameOpen(false)} />;
    }
    return (
      <Suspense fallback={<main className="pw-dashboard"><p className="pwd-content" role="status">Opening the game…</p></main>}>
        <RankedGame gameId={currentGame.id} personalBest={personalBest} onComplete={() => setRefresh((count) => count + 1)} onExit={() => setGameOpen(false)} />
      </Suspense>
    );
  }

  return (
    <main className="pw-dashboard">
      <header className="pwd-header">
        <div className="pwd-header-inner">
          <button type="button" className="pwd-brand" aria-label="PandiWasto home" onClick={onHome}>
            <img src={`${base}pandiwasto-mascot.webp`} alt="" width="48" height="48" />
            <span>PandiWasto</span>
          </button>
          <div className="pwd-header-actions">
            {accountProgress && <span className="pwd-level"><Star size={17} aria-hidden="true" /> Level {level} <span>· {accountProgress.xp} XP</span></span>}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="pwd-header-profile" aria-label={`Player menu for ${firstName}`}>
                <img src={avatarSrc(profile.avatar)} alt="" width="32" height="32" />
                <span>{firstName}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="pwd-header-menu" align="end" sideOffset={8} onCloseAutoFocus={(event) => {
                  if (!menuFocus.current) return;
                  event.preventDefault();
                  menuFocus.current.focus();
                  menuFocus.current = null;
                }}>
                  <DropdownMenu.Item onSelect={() => { setTab("profile"); menuFocus.current = profileTab.current; }}>
                    <UserRound size={18} aria-hidden="true" /> View profile
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => { setTab("settings"); menuFocus.current = settingsTab.current; }}>
                    <Settings size={18} aria-hidden="true" /> Settings
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="pwd-menu-separator" />
                  <DropdownMenu.Item disabled={leaving} onSelect={() => void exit()}>
                    <LogOut size={18} aria-hidden="true" /> Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </header>

      <div className="pwd-content">
        <h1 ref={title} tabIndex={-1}>{profile.displayName || profile.firstName ? `Kumusta, ${firstName}!` : "Tara, laro tayo!"}</h1>
        {exitError && <p role="alert">{exitError}</p>}
        {accountError && <p role="alert">{accountError} <button type="button" className="pwd-text-action" onClick={() => setRefresh((count) => count + 1)}>Retry</button></p>}
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="pwd-tabs" aria-label="Dashboard pages">
            {tabs.map(({ id, label }) => (
              <Tabs.Trigger key={id} value={id} className="pwd-tab" ref={id === "games" ? gamesTab : id === "rankings" ? rankingsTab : id === "profile" ? profileTab : id === "settings" ? settingsTab : undefined}>
                {id === "rankings"
                  ? <Trophy className="pwd-tab-trophy" aria-hidden="true" />
                  : id === "profile" ? <UserRound className="pwd-tab-profile" aria-hidden="true" />
                    : id === "admin" ? <ShieldCheck className="pwd-tab-profile" aria-hidden="true" />
                      : id === "study" ? <ClipboardCheck className="pwd-tab-profile" aria-hidden="true" />
                        : <img src={`${base}dashboard/${id}.webp`} alt="" width="44" height="44" />}
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="games" className="pwd-games">
            <h2 className="sr-only">Choose a game</h2>
            {studyPractice && canStartGames && <p className="pwd-game-message" role="status">Study practice is open. All seven games are available.</p>}
            <div className="pwd-carousel" role="region" aria-label="Games carousel">
              <button type="button" className="pwd-arrow" aria-label="Previous game" onClick={() => chooseGame(gameIndex - 1)}><ArrowLeft aria-hidden="true" /></button>
              <div key={gameIndex} className="pwd-game-row" data-direction={gameDirection || undefined}>
                {[-1, 0, 1].map((offset) => {
                  const index = (gameIndex + offset + MINIGAMES.length) % MINIGAMES.length;
                  const game = MINIGAMES[index];
                  const isLocked = level !== null && !studyPractice && game.unlockLevel > level;
                  const card = (
                    <>
                      <span className="pwd-game-lesson">{game.lesson}</span>
                      <img src={`${base}landing/${game.art}.webp`} alt="" width="444" height="444" />
                      <span className="pwd-game-name">{game.gameName}</span>
                      <span className="pwd-game-status">
                        {isLocked ? <><Lock size={14} aria-hidden="true" /> Level {game.unlockLevel}</> : gameStatus}
                      </span>
                    </>
                  );
                  return (
                    <button
                      key={game.id}
                      ref={offset === 0 ? currentCard : undefined}
                      type="button"
                      className={`pwd-game-card ${offset === 0 ? "pwd-current" : "pwd-side"}`}
                      onClick={() => openCard(index, offset)}
                      aria-label={isLocked ? `${game.gameName}, locked until Level ${game.unlockLevel}` : `${canStartGames ? "Play" : "View"} ${game.gameName}`}
                    >
                      {card}
                    </button>
                  );
                })}
              </div>
              <button type="button" className="pwd-arrow" aria-label="Next game" onClick={() => chooseGame(gameIndex + 1)}><ArrowRight aria-hidden="true" /></button>
            </div>

            <div className="pwd-dots" role="group" aria-label="Pick a game">
              {MINIGAMES.map((game, index) => (
                <button key={game.id} type="button" aria-label={`Show ${game.gameName}`} aria-current={index === gameIndex ? "true" : undefined} onClick={() => chooseGame(index)} />
              ))}
            </div>
            <p className="pwd-game-message" role="status">
              <span className="sr-only">{currentGame.gameName}. </span>
              {locked ? `Reach Level ${currentGame.unlockLevel} to unlock this game.`
                : personalBest > 0 ? `Personal best: ${personalBest} points` : GAME_GUIDES[currentGame.id]}
            </p>
            <div className="pwd-game-links">
              {canStartGames && !locked && (
                <button type="button" className="pwd-save pwd-game-play" onClick={() => setGameOpen(true)}>
                  <Play size={17} aria-hidden="true" /> Play now
                </button>
              )}
              <button type="button" className="pwd-save" onClick={() => {
                setTab("rankings");
                requestAnimationFrame(() => rankingsTab.current?.focus());
              }}>
                <Trophy size={17} aria-hidden="true" /> View leaderboard
              </button>
            </div>
          </Tabs.Content>

          <Tabs.Content value="lessons" className="pwd-panel">
            <h2>Learn a word skill</h2>
            <div className="pwd-lessons">
              {DASHBOARD_LESSONS.map((lesson) => (
                <details key={lesson.title} name="pw-lessons">
                  <summary><span>{lesson.title} <small>{lesson.gloss}</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
                  <div lang="fil">
                    <p>{lesson.explanation}</p>
                    <p className="pwd-example">{lesson.example}</p>
                  </div>
                  {mastery.filter((skill) => skill.skillId === lesson.id && skill.attempts > 0).map((skill) => (
                    <p key={skill.skillId} className="pwd-ranking-scope">Estimated mastery {Math.round(skill.mastery * 100)}% · {skill.attempts} {skill.attempts === 1 ? "answer" : "answers"}</p>
                  ))}
                  <button type="button" className="pwd-text-action" onClick={() => showRelatedGame(lesson.gameId)}>View related game <ArrowRight size={16} aria-hidden="true" /></button>
                </details>
              ))}
            </div>
          </Tabs.Content>

          <Tabs.Content value="rankings" className="pwd-panel">
            <DashboardRankings initialGameId={currentGame.id} />
          </Tabs.Content>

          <Tabs.Content value="profile" className="pwd-panel">
            <DashboardProfile profile={profile} level={level} xp={accountProgress?.xp ?? null} onEdit={() => {
              setTab("settings");
              requestAnimationFrame(() => settingsTab.current?.focus());
            }} />
          </Tabs.Content>

          <Tabs.Content value="settings" className="pwd-panel">
            <DashboardSettings
              profile={profile}
              onSaveProfile={setProfile}
              user={user}
              onLeave={exit}
              leaving={leaving}
            />
          </Tabs.Content>
          <Tabs.Content value="study" className="pwd-panel">
            <DashboardStudy onStatusChange={setStudyState} onPlay={() => {
              setTab("games");
              requestAnimationFrame(() => gamesTab.current?.focus());
            }} />
          </Tabs.Content>
          {admin && (
            <Tabs.Content value="admin" className="pwd-panel">
              <DashboardAdmin summary={admin} />
            </Tabs.Content>
          )}
        </Tabs.Root>
      </div>
    </main>
  );
}
