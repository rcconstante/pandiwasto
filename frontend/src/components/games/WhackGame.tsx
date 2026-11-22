import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, CircleHelp, Clock3, RotateCcw, Sparkles, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { dealWhackDeck, FIRST_WINDOW_MS, POINTS_PER_HIT, STARTING_LIVES, whackWindow, WORD_TYPES, XP_PER_HIT, type WhackWord, type WordType } from "@/data/whackGame";
import { ArcadeCue, ArcadeHearts, ArcadeScore } from "./ArcadeFeedback";
import { useArcadeSound } from "./useArcadeSound";
import "./whack-game.css";

type Screen = "intro" | "playing" | "feedback" | "results";
type Feedback = "correct" | "wrong" | "timeout";

interface Run {
  screen: Screen;
  deck: WhackWord[];
  index: number;
  turn: number;
  hits: number;
  lives: number;
  untimed: boolean;
  feedback: Feedback | null;
}

type Action =
  | { type: "start"; untimed: boolean; deck: WhackWord[] }
  | { type: "answer"; choice: WordType | null }
  | { type: "next"; deck?: WhackWord[] }
  | { type: "finish" }
  | { type: "intro" };

const INITIAL_RUN: Run = {
  screen: "intro", deck: [], index: 0, turn: 0, hits: 0, lives: STARTING_LIVES, untimed: false, feedback: null,
};

function reduceRun(run: Run, action: Action): Run {
  switch (action.type) {
    case "start":
      return { ...INITIAL_RUN, screen: "playing", untimed: action.untimed, deck: action.deck };
    case "answer": {
      if (run.screen !== "playing") return run;
      const correct = action.choice === run.deck[run.index].type;
      return {
        ...run,
        screen: "feedback",
        hits: run.hits + Number(correct),
        lives: run.lives - Number(!correct),
        feedback: correct ? "correct" : action.choice === null ? "timeout" : "wrong",
      };
    }
    case "next":
      if (run.screen !== "feedback" || run.lives <= 0) return run;
      return {
        ...run,
        screen: "playing",
        feedback: null,
        deck: action.deck ?? run.deck,
        index: action.deck ? 0 : run.index + 1,
        turn: run.turn + 1,
      };
    case "finish":
      return { ...run, screen: "results" };
    case "intro":
      return INITIAL_RUN;
  }
}

const FEEDBACK_TITLES = {
  correct: "Magaling! +100 points",
  wrong: "Try the next one!",
  timeout: "The mole got away!",
};

export function WhackGame({ personalBest, onComplete, onExit }: {
  personalBest: number;
  onComplete: (score: number | null, xp: number) => void;
  onExit: () => void;
}) {
  const [run, dispatch] = useReducer(reduceRun, INITIAL_RUN);
  const [untimed, setUntimed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(FIRST_WINDOW_MS);
  const [confirmExit, setConfirmExit] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const remaining = useRef(FIRST_WINDOW_MS);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const { muted, play, toggleSound } = useArcadeSound();
  const base = import.meta.env.BASE_URL;
  const word = run.deck[run.index];
  const correctType = WORD_TYPES.find((type) => type.id === word?.type);
  const points = run.hits * POINTS_PER_HIT;
  const xp = run.hits * XP_PER_HIT;
  const windowSize = whackWindow(run.hits);
  const timerMax = run.feedback === "correct" ? whackWindow(run.hits - 1) : windowSize;
  const inRound = run.screen === "playing" || run.screen === "feedback";
  const moleVisible = run.screen === "playing" || run.feedback === "correct";

  useEffect(() => {
    if (run.screen === "intro" || run.screen === "results") {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (run.screen !== "feedback") heading.current?.focus({ preventScroll: true });
  }, [run.screen, run.turn]);

  useEffect(() => {
    if (run.screen === "feedback" && run.feedback !== "correct") nextButton.current?.focus({ preventScroll: true });
  }, [run.feedback, run.screen]);

  useEffect(() => {
    if (run.screen !== "playing" || run.untimed || confirmExit) return;
    let lastTick = performance.now();
    function resetClock() {
      lastTick = performance.now();
    }
    const ticker = window.setInterval(() => {
      const now = performance.now();
      if (!document.hidden) {
        remaining.current = Math.max(0, remaining.current - (now - lastTick));
        setTimeLeft(remaining.current);
        if (remaining.current === 0) {
          window.clearInterval(ticker);
          dispatch({ type: "answer", choice: null });
          play("miss");
        }
      }
      lastTick = now;
    }, 60);
    document.addEventListener("visibilitychange", resetClock);
    return () => {
      window.clearInterval(ticker);
      document.removeEventListener("visibilitychange", resetClock);
    };
  }, [confirmExit, play, run.screen, run.turn, run.untimed]);

  useEffect(() => {
    if (run.screen !== "feedback" || run.feedback !== "correct" || confirmExit) return;
    const timer = window.setTimeout(() => {
      remaining.current = windowSize;
      setTimeLeft(windowSize);
      dispatch({ type: "next", deck: run.index === run.deck.length - 1 ? dealWhackDeck(word.text) : undefined });
    }, 780);
    return () => window.clearTimeout(timer);
  }, [confirmExit, run.deck.length, run.feedback, run.index, run.screen, windowSize, word]);

  function start() {
    remaining.current = FIRST_WINDOW_MS;
    setTimeLeft(FIRST_WINDOW_MS);
    setNewBest(false);
    dispatch({ type: "start", untimed, deck: dealWhackDeck(word?.text) });
    play();
  }

  function answer(choice: WordType) {
    if (run.screen !== "playing" || confirmExit) return;
    dispatch({ type: "answer", choice });
    play(choice === word.type ? "correct" : "miss");
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const type = WORD_TYPES[Number(event.key) - 1];
    if (type && run.screen === "playing" && !confirmExit) {
      event.preventDefault();
      answer(type.id);
    }
  }

  function finish() {
    if (!inRound) return;
    const score = run.untimed ? null : points;
    setNewBest(score !== null && score > personalBest);
    onComplete(score, xp);
    dispatch({ type: "finish" });
  }

  function next() {
    if (run.lives === 0) {
      finish();
      return;
    }
    remaining.current = windowSize;
    setTimeLeft(windowSize);
    dispatch({ type: "next", deck: run.index === run.deck.length - 1 ? dealWhackDeck(word.text) : undefined });
  }

  return (
    <main className="pop-game whack-game" onKeyDown={handleKeyboard}>
      <div className="pop-shell">
        <header className="pop-top">
          <button ref={backButton} type="button" className="pop-button pop-quiet" onClick={() => inRound ? setConfirmExit(true) : onExit()}>
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
              <Dialog.Description>This run will end without saving its score or XP.</Dialog.Description>
              <div className="pop-exit-actions">
                <Dialog.Close asChild><button type="button" className="pop-button pop-primary">Keep playing</button></Dialog.Close>
                <button type="button" className="pop-button pop-quiet" onClick={onExit}>Leave game</button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {run.screen === "intro" && (
          <section className="whack-intro" aria-labelledby="whack-title">
            <div>
              <p className="pop-skill" lang="fil">Kayarian ng Salita</p>
              <h1 id="whack-title" ref={heading} tabIndex={-1}>Whack-a-Word!</h1>
              <p className="whack-intro-copy">A mole pops up with a word. Pick its type before the mole ducks away!</p>
              <dl className="whack-examples" lang="fil">
                {WORD_TYPES.map((type) => (
                  <div key={type.id} data-type={type.id}><dt>{type.label}</dt><dd>{type.example}</dd></div>
                ))}
              </dl>
              <div className="whack-intro-actions">
                <button type="button" className="pop-button pop-primary" onClick={start}>Start game <ArrowRight size={19} aria-hidden="true" /></button>
                <label className="whack-practice"><input type="checkbox" checked={untimed} onChange={(event) => setUntimed(event.target.checked)} /> Untimed practice</label>
              </div>
            </div>
            <img src={`${base}games/whack-mole.webp`} alt="" width="540" height="540" />
          </section>
        )}

        {inRound && word && (
          <>
            <div className="whack-hud">
              <ArcadeHearts lives={run.lives} total={STARTING_LIVES} />
              <div className="whack-timer">
                {run.untimed ? <span>Untimed practice</span> : (
                  <>
                    <Clock3 size={17} aria-hidden="true" />
                    <progress max={timerMax} value={timeLeft} aria-label="Time left for this word" />
                    <span>{Math.ceil(timeLeft / 1000)}s</span>
                  </>
                )}
              </div>
              <ArcadeScore points={points} />
            </div>

            <section className="whack-stage" aria-labelledby="whack-prompt">
              <h1 id="whack-prompt" ref={heading} tabIndex={-1}>What kind of word is it?</h1>
              <p className="whack-word" aria-live="polite" lang="fil" key={run.turn}>{word.text}</p>
              <div className="whack-holes" aria-hidden="true">
                {[0, 1, 2].map((slot) => (
                  <div className="whack-hole" key={slot}>
                    <div className="whack-hole-rim" />
                    {slot === (run.turn + 1) % 3 && (
                      <>
                        <img key={run.turn} className="whack-mole" data-state={moleVisible ? run.feedback ?? "up" : "down"} src={`${base}games/whack-mole.webp`} alt="" width="540" height="540" />
                        {run.feedback === "correct" && <Sparkles className="whack-hit-spark" aria-hidden="true" />}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <div className="whack-answers" role="group" aria-label="Word type">
              {WORD_TYPES.map((type, index) => (
                <button
                  key={type.id}
                  type="button"
                  className="whack-choice"
                  data-type={type.id}
                  data-correct={run.screen === "feedback" && type.id === word.type || undefined}
                  disabled={run.screen !== "playing"}
                  onClick={() => answer(type.id)}
                >
                  <kbd aria-hidden="true">{index + 1}</kbd><span lang="fil">{type.label}</span>
                </button>
              ))}
            </div>
            <div className="whack-feedback" data-result={run.feedback ?? undefined}>
              <p role="status">
                {run.feedback ? (
                  <ArcadeCue key={run.turn} tone={run.feedback === "correct" ? "correct" : "retry"}>
                    <strong>{FEEDBACK_TITLES[run.feedback]}</strong> <span lang="fil">{word.text} ay <strong>{correctType?.label}</strong>. {correctType?.explanation}</span>
                  </ArcadeCue>
                ) : (
                  <><CircleHelp size={17} aria-hidden="true" /> Tap a word type, or press 1–4.</>
                )}
              </p>
              {run.screen === "feedback" && run.feedback !== "correct" ? (
                <button type="button" ref={nextButton} className="pop-button pop-primary" onClick={next}>
                  {run.lives === 0 ? "See results" : "Next word"} <ArrowRight size={17} aria-hidden="true" />
                </button>
              ) : run.hits > 0 && run.screen === "playing" && (
                <button type="button" className="pop-button pop-quiet" onClick={finish}>Finish run</button>
              )}
            </div>
          </>
        )}

        {run.screen === "results" && (
          <section className="pop-results whack-results" aria-labelledby="whack-results-title">
            <img src={`${base}games/whack-mole.webp`} alt="" width="100" height="100" />
            <h1 id="whack-results-title" ref={heading} tabIndex={-1}>Great work!</h1>
            <p>You matched {run.hits} {run.hits === 1 ? "word" : "words"}.</p>
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{points.toLocaleString()}</strong></div>
              <div><span>XP earned</span><strong>+{xp}</strong></div>
              <div><span>{newBest ? "New best!" : "Timed best"}</span><strong>{Math.max(personalBest, run.untimed ? 0 : points).toLocaleString()}</strong></div>
            </div>
            {run.untimed && <p>Practice earns XP. Timed runs count toward rankings.</p>}
            <div className="pop-results-actions">
              <button type="button" className="pop-button pop-primary" onClick={start}>Play again <RotateCcw size={18} aria-hidden="true" /></button>
              <button type="button" className="pop-button pop-quiet" onClick={() => dispatch({ type: "intro" })}>Change mode <Sparkles size={16} aria-hidden="true" /></button>
              <button type="button" className="pop-button pop-quiet" onClick={onExit}>Back to games</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
