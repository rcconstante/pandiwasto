import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Lightbulb, Moon, Printer, RotateCcw, Sparkles, Star, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { buildFortuneRun, FORTUNE_HINTS, FORTUNE_POINTS, FORTUNE_XP } from "@/data/fortuneGame";
import { ArcadeCue, ArcadeScore } from "./ArcadeFeedback";
import { useArcadeSound } from "./useArcadeSound";
import "./fortune-game.css";

const SPARKS = Array.from({ length: 10 }, (_, index) => index);

interface FortuneResult {
  word: string;
  points: number;
}

function FortuneCard({ word }: { word: string }) {
  return (
    <span className="fortune-card" lang="fil">
      <Moon size={17} aria-hidden="true" /> <strong>{word}</strong>
    </span>
  );
}

export function FortuneGame({ personalBest, onComplete, onExit }: {
  personalBest: number;
  onComplete: (score: number, xp: number) => void;
  onExit: () => void;
}) {
  const [screen, setScreen] = useState<"intro" | "round" | "results">("intro");
  const [rounds, setRounds] = useState(() => buildFortuneRun(personalBest === 0));
  const [roundIndex, setRoundIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [hintUsed, setHintUsed] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [results, setResults] = useState<FortuneResult[]>([]);
  const [celebrating, setCelebrating] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const printTimeout = useRef<number | null>(null);
  const { muted, play, toggleSound } = useArcadeSound();
  const machineArt = `${import.meta.env.BASE_URL}games/fortune-machine.webp`;
  const round = rounds[roundIndex];
  const solved = results[roundIndex];
  const total = results.reduce((score, result) => score + result.points, 0);
  const finalRound = roundIndex === rounds.length - 1;
  const nextLabel = finalRound ? "See results" : "Next round";
  const wrongChoice = selected !== null && rejected.includes(selected);
  const explanation = FORTUNE_HINTS[round.prefix];

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [roundIndex, screen]);

  useEffect(() => {
    if (solved && !celebrating && screen === "round") nextButton.current?.focus({ preventScroll: true });
  }, [solved, celebrating, screen]);

  useEffect(() => () => {
    if (printTimeout.current !== null) window.clearTimeout(printTimeout.current);
  }, []);

  function printPrediction() {
    if (!selected || solved || wrongChoice || printTimeout.current !== null) return;
    if (selected !== round.answer) {
      setRejected([...rejected, selected]);
      play("miss");
      return;
    }

    const points = FORTUNE_POINTS - (hintUsed ? 25 : 0) - (rejected.length ? 25 : 0);
    setPrinting(true);
    play("correct");
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 680;
    printTimeout.current = window.setTimeout(() => {
      printTimeout.current = null;
      setPrinting(false);
      setResults([...results, { word: round.answer, points }]);
      setCelebrating(true);
      if (finalRound) {
        setNewBest(total + points > personalBest);
        onComplete(total + points, FORTUNE_XP);
      }
    }, delay);
  }

  function resetRound() {
    setSelected(null);
    setRejected([]);
    setHintUsed(false);
  }

  function advance() {
    setCelebrating(false);
    if (finalRound) {
      setScreen("results");
    } else {
      resetRound();
      setRoundIndex((index) => index + 1);
    }
  }

  function replay() {
    setRounds(buildFortuneRun(false));
    setResults([]);
    setRoundIndex(0);
    setNewBest(false);
    resetRound();
    setScreen("round");
    play();
  }

  return (
    <main className="pop-game fortune-game">
      <div className="pop-shell">
        <header className="pop-top">
          <button
            ref={backButton}
            type="button"
            className="pop-button pop-quiet"
            disabled={printing}
            onClick={() => screen === "round" && results.length < rounds.length ? setConfirmExit(true) : onExit()}
          >
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

        <Dialog.Root open={celebrating} onOpenChange={setCelebrating}>
          <Dialog.Portal>
            <Dialog.Overlay className="pw-modal-overlay pop-celebration-overlay" />
            <Dialog.Content className="pw-modal pop-celebration fortune-celebration" onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="pop-celebration-sparks" aria-hidden="true">
                {SPARKS.map((index) => <i key={index} style={{ rotate: `${index * 36}deg` }} />)}
              </div>
              <FortuneCard word={round.answer} />
              <Dialog.Title lang="fil">Magaling!</Dialog.Title>
              <Dialog.Description lang="fil">{explanation}</Dialog.Description>
              <span className="pop-celebration-score"><Star size={17} aria-hidden="true" /> +{solved?.points} points</span>
              <button type="button" className="pop-button pop-primary" onClick={advance}>{nextLabel} <ArrowRight size={19} aria-hidden="true" /></button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {screen === "intro" && (
          <section className="fortune-intro" aria-labelledby="fortune-title">
            <div>
              <p className="pop-skill" lang="fil">Asimilasyon</p>
              <h1 id="fortune-title" ref={heading} tabIndex={-1}>Fortune Predict</h1>
              <p className="fortune-intro-copy">Pair <strong>pang-</strong> with a root word. Predict how it sounds before the machine prints your card.</p>
              <div className="pop-example" lang="fil"><span>pang- + bansa</span><ArrowRight size={19} aria-hidden="true" /><strong>pambansa</strong></div>
              <button type="button" className="pop-button pop-primary" onClick={() => { play(); setScreen("round"); }}>
                Start game <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
            <img src={machineArt} alt="" width="560" height="560" />
          </section>
        )}

        {screen === "round" && (
          <>
            <div className="fortune-hud">
              <div className="pop-progress" aria-label={`Round ${roundIndex + 1} of ${rounds.length}`}>
                <strong>Round {roundIndex + 1}/{rounds.length}</strong>
                <div className="pop-pips" aria-hidden="true">
                  {rounds.map((_, index) => <span key={index} data-state={index < results.length ? "done" : index === roundIndex ? "current" : "waiting"} />)}
                </div>
              </div>
              <ArcadeScore points={total} />
            </div>

            <section className="fortune-stage" aria-labelledby="fortune-prompt" data-printing={printing}>
              <div className="fortune-machine" aria-hidden="true">
                <img src={machineArt} alt="" width="560" height="560" />
                {(printing || solved) && <FortuneCard word={round.answer} />}
              </div>
              <div className="fortune-board">
                <h1 id="fortune-prompt" ref={heading} tabIndex={-1}>What will the card say?</h1>
                <div className="fortune-pair" lang="fil"><strong>pang-</strong><span>+</span><strong>{round.root}</strong></div>
                <div className="fortune-choices" role="group" aria-label="Predict the word">
                  {round.choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className="fortune-choice"
                      lang="fil"
                      aria-pressed={choice === selected}
                      data-rejected={rejected.includes(choice)}
                      data-right={solved?.word === choice}
                      disabled={printing || Boolean(solved) || rejected.includes(choice)}
                      onClick={() => { setSelected(choice); play(); }}
                    >{choice}</button>
                  ))}
                </div>
                <div className="fortune-actions">
                  {solved && !celebrating ? (
                    <button ref={nextButton} type="button" className="pop-button pop-primary" onClick={advance}>
                      {nextLabel} <ArrowRight size={19} aria-hidden="true" />
                    </button>
                  ) : (
                    <button type="button" className="pop-button pop-primary" disabled={printing || Boolean(solved) || !selected || wrongChoice} onClick={printPrediction}>
                      <Printer size={18} aria-hidden="true" /> Print card
                    </button>
                  )}
                  <button type="button" className="pop-button pop-quiet" aria-pressed={hintUsed} disabled={hintUsed || printing || Boolean(solved)} onClick={() => { setHintUsed(true); play(); }}>
                    <Lightbulb size={17} aria-hidden="true" /> Hint
                  </button>
                </div>
                <p className="fortune-feedback" role="status">
                  {printing ? "Printing your fortune…"
                    : solved ? <ArcadeCue tone="correct">Fortune printed!</ArcadeCue>
                    : wrongChoice ? <ArcadeCue key={selected} tone="retry">Try another word. Listen for the first sound of the root.</ArcadeCue>
                    : "Pick a word, then print your card."}
                </p>
                {hintUsed && !solved && <p className="fortune-clue" role="status" lang="fil">{explanation}</p>}
              </div>
            </section>
          </>
        )}

        {screen === "results" && (
          <section className="pop-results fortune-results" aria-labelledby="fortune-results-title">
            <img src={machineArt} alt="" width="104" height="104" />
            <h1 id="fortune-results-title" ref={heading} tabIndex={-1} lang="fil">Ang galing!</h1>
            <p>You printed all {rounds.length} fortune cards.</p>
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{total}<small>/{rounds.length * FORTUNE_POINTS}</small></strong></div>
              <div><span>XP earned</span><strong>+{FORTUNE_XP}</strong></div>
              <div><span>{newBest ? "New best!" : "Personal best"}</span><strong>{personalBest}</strong></div>
            </div>
            <div className="pop-root-recap" aria-label="Fortune cards collected">
              {results.map(({ word }) => <span key={word} lang="fil"><Sparkles size={14} aria-hidden="true" /> {word}</span>)}
            </div>
            <div className="pop-results-actions">
              <button type="button" className="pop-button pop-primary" onClick={replay}>Play again <RotateCcw size={18} aria-hidden="true" /></button>
              <button type="button" className="pop-button pop-quiet" onClick={onExit}>Back to games</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
