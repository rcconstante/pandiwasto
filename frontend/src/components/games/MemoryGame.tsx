import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Lightbulb, RotateCcw, Sparkles, Star, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { buildMemoryRun, MEMORY_MAX_SCORE, MEMORY_XP, memoryScore, type CompoundPair, type MemoryCard } from "@/data/memoryGame";
import { useArcadeSound } from "./useArcadeSound";
import { ArcadeCue, ArcadeScore } from "./ArcadeFeedback";
import "./memory-game.css";

interface BoardProgress {
  faceUp: MemoryCard[];
  found: CompoundPair[];
  missed: number;
  moves: number;
  clue: MemoryCard | null;
  feedback: { text: string; tone: "correct" | "retry" | "info" } | null;
}

const EMPTY_BOARD: BoardProgress = { faceUp: [], found: [], missed: 0, moves: 0, clue: null, feedback: null };
const SPARKS = Array.from({ length: 10 }, (_, index) => index);

export function MemoryGame({ personalBest, onComplete, onExit }: {
  personalBest: number;
  onComplete: (score: number, xp: number) => void;
  onExit: () => void;
}) {
  const [screen, setScreen] = useState<"intro" | "board" | "results">("intro");
  const [boards, setBoards] = useState(() => buildMemoryRun(personalBest === 0));
  const [boardIndex, setBoardIndex] = useState(0);
  const [progress, setProgress] = useState(EMPTY_BOARD);
  const [scores, setScores] = useState<number[]>([]);
  const [celebrating, setCelebrating] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  const { muted, play, toggleSound } = useArcadeSound();
  const base = import.meta.env.BASE_URL;
  const board = boards[boardIndex];
  const boardComplete = progress.found.length === board.pairs.length;
  const finalBoard = boardIndex === boards.length - 1;
  const mismatchVisible = progress.faceUp.length === 2;
  const savedScore = scores.reduce((sum, score) => sum + score, 0);
  const liveScore = boardComplete ? savedScore : savedScore + memoryScore(progress.found.length, progress.missed, Boolean(progress.clue));

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [boardIndex, screen]);

  useEffect(() => {
    if (!celebrating && boardComplete && screen === "board") nextButton.current?.focus({ preventScroll: true });
  }, [boardComplete, celebrating, screen]);

  useEffect(() => {
    if (!mismatchVisible || confirmExit) return;
    const timeout = window.setTimeout(() => setProgress((current) => ({ ...current, faceUp: [] })), 1400);
    return () => window.clearTimeout(timeout);
  }, [confirmExit, mismatchVisible]);

  function flip(card: MemoryCard) {
    if (boardComplete || mismatchVisible || progress.found.includes(card.pair)) return;
    const first = progress.faceUp[0];
    if (!first) {
      setProgress({ ...progress, faceUp: [card], feedback: { text: "Choose a second card.", tone: "info" } });
      play();
      return;
    }
    if (first.id === card.id) {
      setProgress({ ...progress, faceUp: [], feedback: null });
      return;
    }
    if (first.pair !== card.pair) {
      setProgress({
        ...progress, faceUp: [first, card], moves: progress.moves + 1, missed: progress.missed + 1,
        feedback: { text: "That pair doesn’t match. Try two other cards.", tone: "retry" },
      });
      play("miss");
      return;
    }

    const found = [...progress.found, card.pair];
    setProgress({ ...progress, faceUp: [], found, moves: progress.moves + 1, feedback: { text: `Magaling! ${card.pair.compound}.`, tone: "correct" } });
    play("correct");
    if (found.length === board.pairs.length) {
      const points = memoryScore(found.length, progress.missed, Boolean(progress.clue));
      setScores([...scores, points]);
      setCelebrating(true);
      if (finalBoard) {
        setNewBest(savedScore + points > personalBest);
        onComplete(savedScore + points, MEMORY_XP);
      }
    }
  }

  function useHint() {
    if (progress.clue || boardComplete || mismatchVisible) return;
    const card = progress.faceUp[0] ?? board.cards.find((item) => !progress.found.includes(item.pair));
    if (!card) return;
    setProgress({ ...progress, clue: card, feedback: null });
    play();
  }

  function advance() {
    setCelebrating(false);
    if (finalBoard) {
      setScreen("results");
    } else {
      setProgress(EMPTY_BOARD);
      setBoardIndex((index) => index + 1);
    }
  }

  function replay() {
    setBoards(buildMemoryRun(false));
    setScores([]);
    setBoardIndex(0);
    setProgress(EMPTY_BOARD);
    setNewBest(false);
    setScreen("board");
    play();
  }

  return (
    <main className="pop-game memory-game">
      <div className="pop-shell">
        <header className="pop-top">
          <button ref={backButton} type="button" className="pop-button pop-quiet" onClick={() => screen === "board" && !(finalBoard && boardComplete) ? setConfirmExit(true) : onExit()}>
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
            <Dialog.Content
              className="pw-modal pop-celebration memory-celebration"
              onOpenAutoFocus={(event) => { event.preventDefault(); reviewTitle.current?.focus({ preventScroll: true }); }}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div className="pop-celebration-sparks" aria-hidden="true">
                {SPARKS.map((index) => <i key={index} style={{ rotate: `${index * 36}deg` }} />)}
              </div>
              <img src={`${base}games/memory-cards.webp`} alt="" width="84" height="84" />
              <Dialog.Title ref={reviewTitle} tabIndex={-1}>Board complete!</Dialog.Title>
              <Dialog.Description>You found all {board.pairs.length} compounds.</Dialog.Description>
              <ul className="memory-summary" lang="fil" aria-label="Mga tambalang salita">
                {progress.found.map((pair) => (
                  <li key={pair.compound}>
                    <strong>{pair.words.join(" + ")} <ArrowRight size={13} aria-hidden="true" /> {pair.compound}</strong>
                    <span>{pair.meaning}</span>
                  </li>
                ))}
              </ul>
              <span className="pop-celebration-score"><Star size={17} aria-hidden="true" /> +{scores[boardIndex]} points</span>
              <button type="button" className="pop-button pop-primary" onClick={advance}>
                {finalBoard ? "See results" : "Next board"} <ArrowRight size={19} aria-hidden="true" />
              </button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {screen === "intro" && (
          <section className="memory-intro" aria-labelledby="memory-title">
            <div>
              <p className="pop-skill" lang="fil">Tambalan</p>
              <h1 id="memory-title" ref={heading} tabIndex={-1}>Memory Match!</h1>
              <p className="memory-intro-copy">Flip two cards. Match the root words that form a Filipino compound.</p>
              <div className="pop-example" lang="fil">
                <span>bahay + kubo</span><ArrowRight size={19} aria-hidden="true" /><strong>bahay-kubo</strong>
              </div>
              <button className="pop-button pop-primary" type="button" onClick={() => { play(); setScreen("board"); }}>
                Start game <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
            <img src={`${base}games/memory-cards.webp`} alt="" width="540" height="540" />
          </section>
        )}

        {screen === "board" && (
          <>
            <div className="memory-hud">
              <div className="pop-progress" aria-label={`Board ${boardIndex + 1} of ${boards.length}`}>
                <strong>Board {boardIndex + 1}/{boards.length}</strong>
                <div className="pop-pips" aria-hidden="true">
                  {boards.map((_, index) => <span key={index} data-state={index < scores.length ? "done" : index === boardIndex ? "current" : "waiting"} />)}
                </div>
              </div>
              <ArcadeScore points={liveScore} />
            </div>

            <section className="memory-stage" aria-labelledby="memory-prompt">
              <div className="memory-board-caption">
                <h1 id="memory-prompt" ref={heading} tabIndex={-1}>Find the word pairs</h1>
                <p>{progress.found.length}/{board.pairs.length} pairs <span aria-hidden="true">·</span> {progress.moves} {progress.moves === 1 ? "move" : "moves"}</p>
              </div>
              <div className="memory-board" data-count={board.cards.length} role="group" aria-label="Word cards" key={boardIndex}>
                {board.cards.map((card, index) => {
                  const matched = progress.found.includes(card.pair);
                  const revealed = matched || progress.faceUp.includes(card);
                  const hinted = progress.clue?.id === card.id && !matched;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className="memory-card"
                      aria-label={revealed ? `Card ${index + 1}: ${card.word}${matched ? ", matched" : ""}` : `Flip card ${index + 1}${hinted ? ", hint" : ""}`}
                      aria-disabled={matched || mismatchVisible || boardComplete}
                      data-revealed={revealed}
                      data-matched={matched}
                      data-hint={hinted || undefined}
                      data-miss={mismatchVisible && revealed && !matched || undefined}
                      onClick={() => flip(card)}
                    >
                      <span className="memory-card-inner" aria-hidden="true">
                        <span className="memory-card-back"><Sparkles size={29} /><small>{index + 1}</small></span>
                        <span className="memory-card-front">
                          {matched && <Check size={15} />}
                          <span className="memory-card-word" lang="fil">{card.word}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="memory-feedback" role="status" data-miss={mismatchVisible || undefined}>
                {progress.feedback
                  ? progress.feedback.tone === "info" ? progress.feedback.text
                    : <ArcadeCue key={progress.moves} tone={progress.feedback.tone}>{progress.feedback.text}</ArcadeCue>
                  : <><CircleHelp size={17} aria-hidden="true" /> Flip any two cards to make a compound.</>}
              </p>
            </section>

            <div className="memory-tools">
              <button type="button" className="pop-button pop-quiet" aria-pressed={Boolean(progress.clue)} disabled={Boolean(progress.clue) || boardComplete || mismatchVisible} onClick={useHint}>
                <Lightbulb size={17} aria-hidden="true" /> Hint
              </button>
              {progress.clue && !progress.found.includes(progress.clue.pair) && (
                <p className="memory-clue" role="status"><strong>Clue:</strong> <span lang="fil">{progress.clue.pair.meaning}</span></p>
              )}
              {boardComplete && !celebrating && (
                <button ref={nextButton} type="button" className="pop-button pop-primary" onClick={advance}>
                  {finalBoard ? "See results" : "Next board"} <ArrowRight size={19} aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        )}

        {screen === "results" && (
          <section className="pop-results memory-results" aria-labelledby="memory-results-title">
            <img src={`${base}games/memory-cards.webp`} alt="" width="100" height="100" />
            <h1 id="memory-results-title" ref={heading} tabIndex={-1}>Ang galing!</h1>
            <p>You matched all {boards.reduce((sum, item) => sum + item.pairs.length, 0)} compound words.</p>
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{savedScore.toLocaleString()}<small>/{MEMORY_MAX_SCORE.toLocaleString()}</small></strong></div>
              <div><span>XP earned</span><strong>+{MEMORY_XP}</strong></div>
              <div><span>{newBest ? "New best!" : "Personal best"}</span><strong>{personalBest.toLocaleString()}</strong></div>
            </div>
            <div className="pop-root-recap" aria-label="Compound words found" lang="fil">
              {boards.flatMap((item) => item.pairs).map((pair) => <span key={pair.compound}>{pair.compound}</span>)}
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
