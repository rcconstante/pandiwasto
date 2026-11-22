import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Lightbulb, RotateCcw, Star, Undo2, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { AFFIX_HINTS, buildBalloonRun, MAX_ROUND_SCORE, XP_PER_ROUND } from "@/data/balloonGame";
import { answerPopRun, endPopRun, hintPopRun, startPopRun, type PopRun } from "@/lib/arcadeApi";
import { ArcadeCue, ArcadeHearts, ArcadeScore } from "./ArcadeFeedback";
import { useArcadeSound } from "./useArcadeSound";
import "./balloon-game.css";

interface RoundResult {
  root: string;
  score: number;
}

const COLORS = ["grape", "coral", "aqua", "gold"];
const CELEBRATION_SPARKS = Array.from({ length: 12 }, (_, index) => index);
const STARTING_HEARTS = 3;

export function BalloonGame({ personalBest, onComplete, onExit, accountPlay = false }: {
  personalBest: number;
  onComplete: (score: number, xp: number) => void;
  onExit: () => void;
  accountPlay?: boolean;
}) {
  const [screen, setScreen] = useState<"intro" | "round" | "results">("intro");
  const [words, setWords] = useState(() => buildBalloonRun(personalBest === 0));
  const [roundIndex, setRoundIndex] = useState(0);
  const [popped, setPopped] = useState<number[]>([]);
  const [hintUsed, setHintUsed] = useState(false);
  const [missed, setMissed] = useState(false);
  const [showError, setShowError] = useState(false);
  const [lives, setLives] = useState(STARTING_HEARTS);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [newBest, setNewBest] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [run, setRun] = useState<PopRun | null>(null);
  const [wordFromServer, setWordFromServer] = useState("");
  const [hintFromServer, setHintFromServer] = useState("");
  const [serverResult, setServerResult] = useState<RoundResult | null>(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [retryAnswer, setRetryAnswer] = useState(false);
  const requestPending = useRef(false);
  const startRequest = useRef<string | null>(null);
  const answerRequest = useRef<string | null>(null);
  const automaticHint = useRef<string | null>(null);
  const { muted, play: sound, toggleSound } = useArcadeSound();
  const focusTarget = useRef<HTMLElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);
  const nextButton = useRef<HTMLButtonElement | null>(null);

  const puzzle = words[roundIndex];
  const word = accountPlay ? wordFromServer : puzzle.word;
  const roundCount = run?.totalRounds ?? words.length;
  const letters = [...word];
  const answer = letters.filter((_, index) => !popped.includes(index)).join("");
  const roundResult = accountPlay ? serverResult : results[roundIndex];
  const roundSolved = Boolean(roundResult);
  const points = run?.score ?? results.reduce((total, result) => total + result.score, 0);
  const maxPoints = roundCount * MAX_ROUND_SCORE;
  const earnedXp = run?.xp ?? results.length * XP_PER_ROUND;
  const solvedCount = earnedXp / XP_PER_ROUND;
  const hint = accountPlay ? hintFromServer : AFFIX_HINTS[puzzle.affix];
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    focusTarget.current?.focus({ preventScroll: true });
  }, [screen, roundIndex]);

  useEffect(() => {
    if (roundSolved && !celebrating && screen === "round") nextButton.current?.focus({ preventScroll: true });
  }, [celebrating, roundSolved, screen]);

  const showStudyHint = useEffectEvent(() => requestHint());
  useEffect(() => {
    if (!accountPlay || !showError || screen !== "round" || run?.status !== "active" || !run.studyActive || !run.hintAllowed || hintUsed || networkBusy || retryAnswer || confirmExit) return;
    const key = run.runId + ":" + roundIndex + ":" + run.hearts;
    if (automaticHint.current === key) return;
    const timer = window.setTimeout(() => {
      automaticHint.current = key;
      showStudyHint();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accountPlay, showError, screen, run, hintUsed, networkBusy, retryAnswer, confirmExit, roundIndex]);

  function resetRound() {
    setPopped([]);
    setHintUsed(false);
    setMissed(false);
    setShowError(false);
    setServerResult(null);
    setHintFromServer("");
    setRetryAnswer(false);
  }

  function toggleLetter(index: number) {
    if (roundSolved || networkBusy || retryAnswer) return;
    if (!popped.includes(index)) sound("pop");
    setPopped((previous) => previous.includes(index)
      ? previous.filter((pressed) => pressed !== index)
      : [...previous, index]);
    setShowError(false);
  }

  function finishRun(finalScore: number, xp: number) {
    setNewBest(finalScore > personalBest);
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
      setNetworkError(error instanceof Error && error.name === "Error" ? error.message : "The connection timed out. Try again.");
    } finally {
      requestPending.current = false;
      setNetworkBusy(false);
    }
  }

  function start() {
    sound();
    if (!accountPlay) {
      setScreen("round");
      return;
    }
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
        setHintUsed(Boolean(snapshot.hintUsed));
        setScreen("round");
      } else {
        if (snapshot.status !== "completed") throw new Error("This run ended. Start a new game.");
        finishRun(snapshot.score, snapshot.xp);
        setScreen("results");
      }
    });
  }

  function requestHint() {
    if (!accountPlay) {
      setHintUsed(true);
    } else if (run) {
      void withServer(async () => {
        const data = await hintPopRun(run.runId, roundIndex);
        setHintFromServer(data.text);
        setHintUsed(true);
      });
    }
  }

  function submitOnlineAnswer() {
    if (!run) return;
    void withServer(async () => {
      setRetryAnswer(true);
      answerRequest.current ??= crypto.randomUUID();
      const result = await answerPopRun(run.runId, { answerId: answerRequest.current, expectedRound: roundIndex, response: answer });
      answerRequest.current = null;
      setRetryAnswer(false);
      setRun(result);
      setLives(result.hearts);
      if (result.correct && result.root) {
        const solved = { root: result.root, score: result.points };
        setServerResult(solved);
        setResults((previous) => [...previous, solved]);
        setCelebrating(true);
        sound("correct");
      } else {
        setShowError(true);
        sound("miss");
      }
      if (result.status === "completed") {
        finishRun(result.score, result.xp);
        if (!result.correct) setScreen("results");
      }
    });
  }

  function checkWord() {
    if (roundSolved || !popped.length || showError || lives === 0 || networkBusy) return;
    if (accountPlay) {
      submitOnlineAnswer();
      return;
    }
    if (answer !== puzzle.root) {
      const remaining = lives - 1;
      setLives(remaining);
      setMissed(true);
      setShowError(true);
      sound("miss");
      if (remaining === 0) {
        finishRun(points, earnedXp);
        setScreen("results");
      }
      return;
    }
    const score = MAX_ROUND_SCORE - (hintUsed ? 25 : 0) - (missed ? 25 : 0);
    const next = [...results, { root: puzzle.root, score }];
    setResults(next);
    setCelebrating(true);
    sound("correct");

    if (next.length === words.length) {
      finishRun(points + score, next.length * XP_PER_ROUND);
    }
  }

  function advance() {
    setCelebrating(false);
    if (run?.status === "completed" || roundIndex === roundCount - 1) {
      setScreen("results");
    } else {
      resetRound();
      setRoundIndex(run?.round ?? roundIndex + 1);
      if (run?.word) setWordFromServer(run.word);
    }
  }

  function replay() {
    if (accountPlay) {
      start();
      return;
    }
    setWords(buildBalloonRun(false));
    setRoundIndex(0);
    setResults([]);
    setLives(STARTING_HEARTS);
    setNewBest(false);
    resetRound();
    setScreen("round");
  }

  function leaveRun() {
    if (run?.status === "active" && !retryAnswer && !networkError) {
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

        <Dialog.Root open={confirmExit} onOpenChange={setConfirmExit}>
          <Dialog.Portal>
            <Dialog.Overlay className="pw-modal-overlay" />
            <Dialog.Content className="pw-modal pop-exit" onCloseAutoFocus={(event) => { event.preventDefault(); backButton.current?.focus(); }}>
              <Dialog.Title>Leave this game?</Dialog.Title>
              <Dialog.Description>{accountPlay && (networkError || retryAnswer) ? "You can return to Games and reopen this run." : "Leave before finishing to end this run without rewards."}</Dialog.Description>
              {networkError && <p className="pop-feedback" role="alert">{networkError}</p>}
              <div className="pop-exit-actions">
                <Dialog.Close asChild><button type="button" className="pop-button pop-primary">Keep playing</button></Dialog.Close>
                <button type="button" className="pop-button pop-quiet" disabled={networkBusy} onClick={leaveRun}>Leave game</button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={celebrating} onOpenChange={setCelebrating}>
          <Dialog.Portal>
            <Dialog.Overlay className="pw-modal-overlay pop-celebration-overlay" />
            <Dialog.Content className="pw-modal pop-celebration" onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="pop-celebration-sparks" aria-hidden="true">
                {CELEBRATION_SPARKS.map((index) => <i key={index} style={{ rotate: `${index * 30}deg` }} />)}
              </div>
              <img src={`${base}pandiwasto-mascot.webp`} alt="" width="92" height="92" />
              <Dialog.Title>Magaling!</Dialog.Title>
              <Dialog.Description className="pop-celebration-description">
                You found the root word.
                <strong lang="fil">{roundResult?.root}</strong>
              </Dialog.Description>
              <div className="pop-celebration-answer" aria-label={`${word} becomes ${roundResult?.root ?? ""}`}>
                {word} <ArrowRight size={16} aria-hidden="true" /> {roundResult?.root}
              </div>
              <span className="pop-celebration-score"><Star size={17} aria-hidden="true" /> +{roundResult?.score} points</span>
              <button type="button" className="pop-button pop-primary" onClick={advance}>
                {roundIndex === roundCount - 1 ? "See results" : "Next round"} <ArrowRight size={19} aria-hidden="true" />
              </button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {screen === "intro" && (
          <section className="pop-intro" aria-labelledby="pop-title">
            <div>
              <p className="pop-skill">Salitang-Ugat</p>
              <h1 id="pop-title" ref={(node) => { focusTarget.current = node; }} tabIndex={-1}>Pop Goes<br />the Word!</h1>
              <p className="pop-intro-copy">Pop the extra letters to keep the root word. Each wrong answer costs one of your three hearts.</p>
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
                    aria-label={`${popped.includes(index) ? "Restore" : "Pop"} ${letter}, letter ${index + 1}`}
                    aria-pressed={popped.includes(index)}
                    onClick={() => toggleLetter(index)}
                    disabled={roundSolved || networkBusy || retryAnswer}
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
                {run?.hintAllowed !== false && <button type="button" className="pop-button pop-quiet" aria-pressed={hintUsed} disabled={roundSolved || networkBusy || retryAnswer} onClick={requestHint}>
                  <Lightbulb size={17} aria-hidden="true" /> Hint
                </button>}
                <button type="button" className="pop-button pop-quiet" disabled={!popped.length || roundSolved || networkBusy || retryAnswer} onClick={() => { setPopped((previous) => previous.slice(0, -1)); setShowError(false); }}>
                  <Undo2 size={17} aria-hidden="true" /> Undo
                </button>
                <button type="button" className="pop-button pop-quiet" disabled={!popped.length || roundSolved || networkBusy || retryAnswer} onClick={() => { setPopped([]); setShowError(false); }}>
                  <RotateCcw size={17} aria-hidden="true" /> Reset
                </button>
              </div>
              {roundSolved && !celebrating ? (
                <button ref={nextButton} type="button" className="pop-button pop-primary" onClick={advance}>
                  {roundIndex === roundCount - 1 ? "See results" : "Next round"} <ArrowRight size={19} aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="pop-button pop-primary" disabled={roundSolved || !popped.length || showError || networkBusy} onClick={checkWord}>
                  {retryAnswer && !networkBusy ? "Retry check" : "Check word"} <Check size={19} aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="pop-feedback" aria-live="polite" data-result={roundSolved ? "correct" : showError ? "retry" : undefined}>
              {roundSolved ? (
                <ArcadeCue tone="correct">Magaling! <strong>{roundResult?.root}</strong> is the root word.</ArcadeCue>
              ) : showError ? (
                <>
                  <ArcadeCue tone="retry">One heart lost. Tap a popped balloon to bring it back and try again.</ArcadeCue>
                  {hintUsed && hint && <span lang="fil">{hint}</span>}
                </>
              ) : hintUsed && hint ? (
                <><Lightbulb size={18} aria-hidden="true" /> <span lang="fil">{hint}</span></>
              ) : (
                <><CircleHelp size={18} aria-hidden="true" /> Tap a balloon to pop it. Tap it again to bring it back.</>
              )}
            </p>
          </>
        )}

        {screen === "results" && (
          <section className="pop-results" aria-labelledby="pop-results-title">
            <img src={`${base}pandiwasto-mascot.webp`} alt="" width="92" height="92" />
            <h1 id="pop-results-title" tabIndex={-1} ref={(node) => { focusTarget.current = node; }}>{lives > 0 ? "Ang galing!" : "Out of hearts"}</h1>
            {lives > 0 ? <p>You found all {roundCount} root words.</p> : (
              <>
                <ArcadeHearts lives={lives} total={STARTING_HEARTS} />
                <p>You found {solvedCount} of {roundCount} root words. Ready to try again?</p>
              </>
            )}
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{points}<small>/{maxPoints}</small></strong></div>
              <div><span>XP earned</span><strong>+{earnedXp}</strong></div>
              <div><span>{newBest ? "New best!" : "Personal best"}</span><strong>{personalBest}</strong></div>
            </div>
            <div className="pop-root-recap" aria-label="Root words found">{results.map((result, index) => <span key={index}>{result.root}</span>)}</div>
            <div className="pop-results-actions">
              <button type="button" className="pop-button pop-primary" disabled={networkBusy} onClick={replay}>Play again <RotateCcw size={18} aria-hidden="true" /></button>
              <button type="button" className="pop-button pop-quiet" onClick={onExit}>Back to games</button>
            </div>
          </section>
        )}
        {networkBusy && <p className="pop-feedback" role="status">Saving to your account…</p>}
        {networkError && !confirmExit && <p className="pop-feedback" role="alert" data-result="retry">{networkError}</p>}
      </div>
    </main>
  );
}
