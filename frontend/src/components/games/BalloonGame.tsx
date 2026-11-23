import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Lightbulb, RotateCcw, Undo2, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { MAX_ROUND_SCORE, XP_PER_ROUND } from "@/data/balloonGame";
import { HintRating } from "./HintRating";
import { ArcadeRequestError, endPopRun, hintPopRun, startPopRun, tapPopRun, type PopRun } from "@/lib/arcadeApi";
import { ArcadeCue, ArcadeHearts, ArcadeScore } from "./ArcadeFeedback";
import { RoundFeedbackDialog } from "./RoundFeedbackDialog";
import { waitForGameMotion } from "./gameMotion";
import { useArcadeSound } from "./useArcadeSound";
import "./balloon-game.css";

interface RoundResult {
  root: string;
  score: number;
}

const COLORS = ["grape", "coral", "aqua", "gold"];
const POP_MOTION_MS = 280;
const STARTING_HEARTS = 3;

export function BalloonGame({ personalBest, testPlay, onComplete, onExit }: {
  personalBest: number;
  testPlay: boolean;
  onComplete: (score: number, xp: number) => void;
  onExit: () => void;
}) {
  const [screen, setScreen] = useState<"intro" | "round" | "results">("intro");
  const [roundIndex, setRoundIndex] = useState(0);
  const [popped, setPopped] = useState<number[]>([]);
  const [hintLevel, setHintLevel] = useState(0);
  const hintUsed = hintLevel > 0;
  const [showError, setShowError] = useState(false);
  const [lives, setLives] = useState(STARTING_HEARTS);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [missedBalloon, setMissedBalloon] = useState<number>();
  const [newBest, setNewBest] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [run, setRun] = useState<PopRun | null>(null);
  const [wordFromServer, setWordFromServer] = useState("");
  const [hintFromServer, setHintFromServer] = useState("");
  const [hintId, setHintId] = useState<number | null>(null);
  const [serverResult, setServerResult] = useState<RoundResult | null>(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [retryTap, setRetryTap] = useState(false);
  const requestPending = useRef(false);
  const startRequest = useRef<string | null>(null);
  const pendingTap = useRef<{ tapId: string; expectedRound: number; removed: number[] } | null>(null);
  const automaticHint = useRef<string | null>(null);
  const { muted, play: sound, toggleSound } = useArcadeSound();
  const focusTarget = useRef<HTMLElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);
  const nextButton = useRef<HTMLButtonElement | null>(null);

  const word = wordFromServer;
  const roundCount = run?.totalRounds ?? 5;
  const letters = [...word];
  const answer = letters.filter((_, index) => !popped.includes(index)).join("");
  const roundResult = serverResult;
  const roundOver = roundResult !== null;
  const roundWon = Boolean(roundResult?.score);
  const nextLabel = roundIndex === roundCount - 1 || run?.status === "completed" ? "See results" : "Next word";
  const points = run?.score ?? results.reduce((total, result) => total + result.score, 0);
  const maxPoints = roundCount * MAX_ROUND_SCORE;
  const earnedXp = run?.xp ?? results.length * XP_PER_ROUND;
  const solvedCount = earnedXp / XP_PER_ROUND;
  const hint = hintFromServer;
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    focusTarget.current?.focus({ preventScroll: true });
  }, [screen, roundIndex]);

  useEffect(() => {
    if (roundOver && !celebrating && screen === "round") nextButton.current?.focus({ preventScroll: true });
  }, [celebrating, roundOver, screen]);

  function resetRound() {
    setPopped([]);
    setHintLevel(0);
    setShowError(false);
    setServerResult(null);
    setMissedBalloon(undefined);
    setHintFromServer("");
    setHintId(null);
    pendingTap.current = null;
    setRetryTap(false);
  }

  function finishRun(finalScore: number, xp: number) {
    setNewBest(!testPlay && finalScore > personalBest);
    onComplete(finalScore, xp);
  }

  async function withServer(action: () => Promise<void>) {
    if (requestPending.current) return;
    requestPending.current = true;
    setNetworkBusy(true);
    setNetworkError("");
    try {
      await action();
    } catch (error) {
      setNetworkError(error instanceof Error ? error.message : "The connection timed out. Try again.");
    } finally {
      requestPending.current = false;
      setNetworkBusy(false);
    }
  }

  function start() {
    sound();
    void withServer(async () => {
      startRequest.current ??= crypto.randomUUID();
      const snapshot = await startPopRun(startRequest.current);
      startRequest.current = null;
      resetRound();
      setRun(snapshot);
      setRoundIndex(snapshot.round);
      setLives(snapshot.hearts);
      setWordFromServer(snapshot.word ?? "");
      setResults([]);
      setNewBest(false);
      if (snapshot.status === "active" && snapshot.word) {
        setHintLevel(snapshot.hintLevel ?? 0);
        setScreen("round");
      } else {
        if (snapshot.status !== "completed") throw new Error("This run ended. Start a new game.");
        finishRun(snapshot.score, snapshot.xp);
        setScreen("results");
      }
    });
  }

  function requestHint(auto = false) {
    if (!run) return;
    void withServer(async () => {
      const data = await hintPopRun(run.runId, roundIndex, hintLevel + 1, auto);
      setHintFromServer(data.text);
      setHintId(data.hintId ?? null);
      setHintLevel(data.level);
    });
  }

  const showStudyHint = useEffectEvent(() => requestHint(true));
  useEffect(() => {
    if (!showError || roundOver || screen !== "round" || run?.status !== "active" || !run.studyActive || !run.hintAllowed || hintLevel >= 3 || networkBusy || retryTap || confirmExit) return;
    const key = run.runId + ":" + roundIndex + ":" + run.hearts;
    if (automaticHint.current === key) return;
    const timer = window.setTimeout(() => {
      automaticHint.current = key;
      showStudyHint();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showError, roundOver, screen, run, hintLevel, networkBusy, retryTap, confirmExit, roundIndex]);

  function popLetter(index: number) {
    if (roundOver || requestPending.current || retryTap || networkError) return;
    if (popped.includes(index)) {
      setPopped((previous) => previous.filter((position) => position !== index));
      setShowError(false);
      return;
    }
    submitTap([...popped, index]);
  }

  function submitTap(removed?: number[]) {
    if (!run) return;
    void withServer(async () => {
      if (removed) pendingTap.current = { tapId: crypto.randomUUID(), expectedRound: roundIndex, removed };
      const next = pendingTap.current;
      if (!next) return;
      setRetryTap(true);
      let result;
      try {
        result = await tapPopRun(run.runId, next);
      } catch (error) {
        if (error instanceof ArcadeRequestError && error.status === 409) {
          resetRound();
          setScreen("intro");
        }
        throw error;
      }
      pendingTap.current = null;
      setRetryTap(false);
      setRun(result);
      if (result.outcome === "continue") {
        setPopped(next.removed);
        sound("pop");
        setShowError(false);
        return;
      }

      setLives(result.roundHearts ?? result.hearts);
      const won = result.outcome === "solved";
      const endedRound = won || result.outcome === "skip" || result.status === "completed";
      setShowError(!won);
      if (won) setPopped(next.removed);
      else setMissedBalloon(next.removed.at(-1));
      sound(won ? "correct" : "miss");
      await waitForGameMotion(POP_MOTION_MS);
      setMissedBalloon(undefined);
      if (endedRound) {
        const resolved = { root: result.root ?? "", score: result.outcome === "solved" ? result.points : 0 };
        setServerResult(resolved);
        if (resolved.root) setResults((previous) => [...previous, resolved]);
      }
      setCelebrating(true);
      if (result.status === "completed") finishRun(result.score, result.xp);
    });
  }

  function advance() {
    setCelebrating(false);
    if (run?.status === "completed" || roundIndex === roundCount - 1) {
      setScreen("results");
    } else {
      resetRound();
      setRoundIndex(run?.round ?? roundIndex + 1);
      setLives(run?.hearts ?? STARTING_HEARTS);
      if (run?.word) setWordFromServer(run.word);
    }
  }

  function leaveRun() {
    if (run?.status === "active" && !retryTap && !networkError) {
      void withServer(async () => {
        await endPopRun(run.runId);
        onExit();
      });
    } else {
      onExit();
    }
  }

  return (
    <main className="pop-game">
      <div className="pop-shell">
        <header className="pop-top">
          <button ref={backButton} type="button" className="pop-button pop-quiet" disabled={networkBusy} onClick={() => screen === "round" && run?.status !== "completed" && results.length < roundCount ? setConfirmExit(true) : onExit()}>
            <ArrowLeft size={18} aria-hidden="true" /> Games
          </button>
          <span className="pop-brand">PandiWasto Arcade</span>
          <button type="button" className="pop-button pop-quiet pop-sound" aria-label={muted ? "Turn sound on" : "Mute sound"} onClick={toggleSound}>
            {muted ? <VolumeX size={19} aria-hidden="true" /> : <Volume2 size={19} aria-hidden="true" />}
          </button>
        </header>
        {testPlay && <p className="pop-test-play">Test play · Account XP and scores stay unchanged</p>}

        <Dialog.Root open={confirmExit} onOpenChange={setConfirmExit}>
          <Dialog.Portal>
            <Dialog.Overlay className="pw-modal-overlay" />
            <Dialog.Content className="pw-modal pop-exit" onCloseAutoFocus={(event) => { event.preventDefault(); backButton.current?.focus(); }}>
              <Dialog.Title>Leave this game?</Dialog.Title>
              <Dialog.Description>{(networkError || retryTap) ? "You can return to Games and reopen this run." : "Leave before finishing to end this run without rewards."}</Dialog.Description>
              {networkError && <p className="pop-feedback" role="alert">{networkError}</p>}
              <div className="pop-exit-actions">
                <Dialog.Close asChild><button type="button" className="pop-button pop-primary">Keep playing</button></Dialog.Close>
                <button type="button" className="pop-button pop-quiet" disabled={networkBusy} onClick={leaveRun}>Leave game</button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <RoundFeedbackDialog open={celebrating} onOpenChange={setCelebrating} won={roundWon}
          title={roundWon ? "Magaling!" : roundOver ? "No hearts left for this word" : "Try again!"}
          description={roundWon ? "You found the root word." : roundOver ? "Review the root word and keep learning." : "One heart lost. Keep that letter and pop a different one."}
          answer={roundResult?.root} points={roundResult?.score}
          actionLabel={roundOver ? nextLabel : "Try again"} onAction={roundOver ? advance : () => setCelebrating(false)}>
          {!roundOver && hintUsed && hint && <p lang="fil">{hint}</p>}
        </RoundFeedbackDialog>

        {screen === "intro" && (
          <section className="pop-intro" aria-labelledby="pop-title">
            <div>
              <p className="pop-skill">Salitang-Ugat</p>
              <h1 id="pop-title" ref={(node) => { focusTarget.current = node; }} tabIndex={-1}>Pop Goes<br />the Word!</h1>
              <p className="pop-intro-copy">Pop the extra letters to keep the root word. You get three hearts for each word. Popping a letter needed for the root costs one heart.</p>
              <div className="pop-example" aria-label="Example: sumakay becomes sakay">
                <span>S<span className="pop-strike">UM</span>AKAY</span><ArrowRight size={19} aria-hidden="true" /><strong>SAKAY</strong>
              </div>
              <button type="button" className="pop-button pop-primary" disabled={networkBusy} onClick={start}>Start game <ArrowRight size={20} aria-hidden="true" /></button>
            </div>
            <img className="pop-intro-art" src={`${base}landing/balloons.webp`} alt="" width="444" height="444" />
          </section>
        )}

        {screen === "round" && (
          <>
            <div className="pop-round-top">
              <div className="pop-progress" aria-label={`Round ${roundIndex + 1} of ${roundCount}`}>
                <strong>Round {roundIndex + 1}/{roundCount}</strong>
                <div className="pop-pips" aria-hidden="true">
                  {Array.from({ length: roundCount }, (_, index) => <span key={index} data-state={index < solvedCount ? "done" : index === roundIndex ? "current" : "waiting"} />)}
                </div>
              </div>
              <ArcadeHearts lives={lives} total={STARTING_HEARTS} />
              <ArcadeScore points={points} />
            </div>

            <section className="pop-arena" aria-labelledby="pop-prompt">
              <div className="pop-prompt">
                <h1 id="pop-prompt" tabIndex={-1} ref={(node) => { focusTarget.current = node; }}>Find the root word</h1>
                <p>Pop the letters that were added.</p>
              </div>
              <div className="pop-balloon-row" role="group" aria-label={`Letter balloons for ${word}`}>
                {letters.map((letter, index) => (
                  <button
                    key={index}
                    type="button"
                    className="pop-balloon"
                    data-color={COLORS[(index + roundIndex) % COLORS.length]}
                    data-miss={missedBalloon === index || undefined}
                    aria-label={`${popped.includes(index) ? "Restore" : "Pop"} ${letter}, letter ${index + 1}`}
                    aria-pressed={popped.includes(index)}
                    onClick={() => popLetter(index)}
                    disabled={roundOver || celebrating || networkBusy || retryTap || Boolean(networkError)}
                  >
                    <span className="pop-balloon-art">
                      <img src={`${base}games/pop-balloon.webp`} alt="" width="192" height="192" />
                      <span className="pop-balloon-letter">{letter}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <div className="pop-tray">
              <div className="pop-answer">
                <span>Letters left</span>
                <output aria-live="polite">{answer || "—"}</output>
              </div>
              <div className="pop-tools">
                {run?.hintAllowed !== false && <button type="button" className="pop-button pop-quiet" aria-pressed={hintUsed} disabled={roundOver || networkBusy || retryTap || hintLevel >= 3} onClick={() => requestHint()}>
                  <Lightbulb size={17} aria-hidden="true" /> {hintUsed ? "Next hint" : "Hint"}
                </button>}
                <button type="button" className="pop-button pop-quiet" disabled={!popped.length || roundOver || networkBusy || retryTap} onClick={() => { setPopped((previous) => previous.slice(0, -1)); setShowError(false); }}>
                  <Undo2 size={17} aria-hidden="true" /> Undo
                </button>
                <button type="button" className="pop-button pop-quiet" disabled={!popped.length || roundOver || networkBusy || retryTap} onClick={() => { setPopped([]); setShowError(false); }}>
                  <RotateCcw size={17} aria-hidden="true" /> Reset
                </button>
              </div>
              {roundOver && !celebrating && (
                <button ref={nextButton} type="button" className="pop-button pop-primary" onClick={advance}>
                  {nextLabel} <ArrowRight size={19} aria-hidden="true" />
                </button>
              )}
              {retryTap && !networkBusy && <button type="button" className="pop-button pop-primary" onClick={() => submitTap()}>Retry pop <Check size={19} aria-hidden="true" /></button>}
              {networkError && !retryTap && <button type="button" className="pop-button pop-quiet" onClick={() => setNetworkError("")}>Dismiss</button>}
            </div>
            <p className="pop-feedback" aria-live="polite" data-result={roundWon ? "correct" : showError ? "retry" : undefined}>
              {roundOver ? (
                <ArcadeCue tone={roundWon ? "correct" : "retry"}><strong>{roundResult?.root}</strong> is the root word.</ArcadeCue>
              ) : showError ? (
                <>
                  <ArcadeCue tone="retry">One heart lost. Keep that letter and try popping a different one.</ArcadeCue>
                  {hintUsed && hint && <span lang="fil">{hint}</span>}
                </>
              ) : hintUsed && hint ? (
                <><Lightbulb size={18} aria-hidden="true" /> <span lang="fil">{hint}</span></>
              ) : (
                <><CircleHelp size={18} aria-hidden="true" /> Pop an added letter. The game checks each pop.</>
              )}
            </p>
            {run && hintUsed && hint && hintId !== null && <HintRating runId={run.runId} hintId={hintId} />}
          </>
        )}

        {screen === "results" && (
          <section className="pop-results" aria-labelledby="pop-results-title">
            <img src={`${base}pandiwasto-mascot.webp`} alt="" width="92" height="92" />
            <h1 id="pop-results-title" tabIndex={-1} ref={(node) => { focusTarget.current = node; }}>Ang galing!</h1>
            <p>You found {solvedCount} of {roundCount} root words.</p>
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{points}<small>/{maxPoints}</small></strong></div>
              <div><span>{testPlay ? "Test XP" : "XP earned"}</span><strong>+{earnedXp}</strong></div>
              <div><span>{newBest ? "New best!" : "Personal best"}</span><strong>{personalBest}</strong></div>
            </div>
            <div className="pop-root-recap" aria-label="Root words reviewed">{results.map((result, index) => <span key={index}>{result.root}</span>)}</div>
            <div className="pop-results-actions">
              <button type="button" className="pop-button pop-primary" disabled={networkBusy} onClick={start}>Play again <RotateCcw size={18} aria-hidden="true" /></button>
              <button type="button" className="pop-button pop-quiet" onClick={onExit}>Back to games</button>
            </div>
          </section>
        )}
        {networkError && !confirmExit && <p className="pop-feedback" role="alert" data-result="retry">{networkError}</p>}
      </div>
    </main>
  );
}
