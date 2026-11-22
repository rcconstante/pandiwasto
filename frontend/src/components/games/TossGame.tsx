import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, GripVertical, Lightbulb, RotateCcw, Sparkles, Volume2, VolumeX } from "lucide-react";
import { DragDropProvider, DragOverlay, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/react";
import { Dialog } from "radix-ui";
import { AFFIX_TYPES, applyAffix, buildTossRun, firstTossExample, tileLabel, TOSS_MAX_POINTS, TOSS_ROUNDS, TOSS_XP_PER_ROUND, type AffixTile } from "@/data/tossGame";
import { useArcadeSound } from "./useArcadeSound";
import { ArcadeCue, ArcadeScore } from "./ArcadeFeedback";
import "./toss-game.css";

const SENTENCE_SLOT = "toss-sentence-slot";
const POINTER_SENSORS = [PointerSensor];
const CELEBRATION_SPARKS = Array.from({ length: 10 }, (_, index) => index);

function DraggableTile({ tile, selected, disabled, onSelect }: {
  tile: AffixTile;
  selected: boolean;
  disabled: boolean;
  onSelect: (tile: AffixTile) => void;
}) {
  const { ref, isDragging } = useDraggable({ id: tile.type, disabled });
  return (
    <button
      ref={ref}
      type="button"
      className="toss-tile"
      data-type={tile.type}
      data-dragging={isDragging || undefined}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(tile)}
    >
      <GripVertical size={17} aria-hidden="true" />
      <span lang="fil">{tileLabel(tile)}</span>
    </button>
  );
}

function SentenceSlot({ selected, completedWord }: { selected: AffixTile | null; completedWord?: string }) {
  const { ref, isDropTarget } = useDroppable({ id: SENTENCE_SLOT, disabled: Boolean(completedWord) });
  return (
    <span
      ref={ref}
      className="toss-slot"
      data-over={isDropTarget || undefined}
      data-filled={Boolean(selected) || undefined}
      data-solved={Boolean(completedWord) || undefined}
      aria-label={completedWord ?? (selected ? `Selected tile: ${tileLabel(selected)}` : "Empty sentence slot")}
    >
      {completedWord ?? (selected ? tileLabel(selected) : "Drop tile here")}
    </span>
  );
}

interface TossResult {
  word: string;
  points: number;
}

export function TossGame({ personalBest, onComplete, onExit }: {
  personalBest: number;
  onComplete: (score: number, xp: number) => void;
  onExit: () => void;
}) {
  const [screen, setScreen] = useState<"intro" | "round" | "results">("intro");
  const [rounds, setRounds] = useState(() => buildTossRun(personalBest === 0));
  const [roundIndex, setRoundIndex] = useState(0);
  const [selected, setSelected] = useState<AffixTile | null>(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [missed, setMissed] = useState(false);
  const [showError, setShowError] = useState(false);
  const [results, setResults] = useState<TossResult[]>([]);
  const [celebrating, setCelebrating] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const { muted, play, toggleSound } = useArcadeSound();
  const base = import.meta.env.BASE_URL;
  const round = rounds[roundIndex];
  const answerType = AFFIX_TYPES.find((type) => type.id === round.answerTile.type);
  const [sentenceStart, sentenceEnd] = round.sentence.split("___");
  const solved = results[roundIndex];
  const completedWord = applyAffix(round.root, round.answerTile);
  const total = results.reduce((points, result) => points + result.points, 0);
  const finalRound = roundIndex === rounds.length - 1;
  const xp = TOSS_XP_PER_ROUND * TOSS_ROUNDS;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [screen, roundIndex]);

  useEffect(() => {
    if (solved && !celebrating && screen === "round") nextButton.current?.focus({ preventScroll: true });
  }, [celebrating, screen, solved]);

  function chooseTile(tile: AffixTile) {
    if (solved) return;
    setSelected(tile);
    setShowError(false);
    play();
  }

  function resetRound() {
    setSelected(null);
    setHintUsed(false);
    setShowError(false);
    setMissed(false);
  }

  function clearTile() {
    setSelected(null);
    setShowError(false);
  }

  function checkAnswer() {
    if (!selected || solved) return;
    if (selected.type !== round.answerTile.type) {
      setMissed(true);
      setShowError(true);
      play("miss");
      return;
    }
    const points = TOSS_MAX_POINTS - (hintUsed ? 25 : 0) - (missed ? 25 : 0);
    setResults([...results, { word: completedWord, points }]);
    setCelebrating(true);
    play("correct");
    if (finalRound) {
      setNewBest(total + points > personalBest);
      onComplete(total + points, xp);
    }
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
    setRounds(buildTossRun(false));
    setRoundIndex(0);
    setResults([]);
    setNewBest(false);
    resetRound();
    setScreen("round");
    play();
  }

  const example = firstTossExample();

  return (
    <main className="pop-game toss-game">
      <div className="pop-shell">
        <header className="pop-top">
          <button ref={backButton} type="button" className="pop-button pop-quiet" onClick={() => screen === "round" && results.length < rounds.length ? setConfirmExit(true) : onExit()}>
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
            <Dialog.Content className="pw-modal pop-celebration toss-celebration" onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="pop-celebration-sparks" aria-hidden="true">
                {CELEBRATION_SPARKS.map((index) => <i key={index} style={{ rotate: `${index * 36}deg` }} />)}
              </div>
              <img src={`${base}games/toss-basket.webp`} alt="" width="92" height="92" />
              <Dialog.Title>Magaling!</Dialog.Title>
              <Dialog.Description className="pop-celebration-description">
                <span lang="fil">{answerType?.label}</span>
                <strong lang="fil">{completedWord}</strong>
              </Dialog.Description>
              <p className="toss-explanation" lang="fil">{answerType?.clue}</p>
              <span className="pop-celebration-score"><Sparkles size={17} aria-hidden="true" /> +{solved?.points} points</span>
              <button type="button" className="pop-button pop-primary" onClick={advance}>
                {finalRound ? "See results" : "Next round"} <ArrowRight size={19} aria-hidden="true" />
              </button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {screen === "intro" && (
          <section className="toss-intro" aria-labelledby="toss-title">
            <div>
              <p className="pop-skill" lang="fil">Mga Panlapi</p>
              <h1 id="toss-title" ref={heading} tabIndex={-1}>Toss-a-Lapi!</h1>
              <p className="toss-intro-copy">Pick the right affix tile to finish the Filipino sentence.</p>
              <div className="pop-example" lang="fil">
                <span>{tileLabel(example.answerTile)} + {example.root}</span><ArrowRight size={19} aria-hidden="true" /><strong>{applyAffix(example.root, example.answerTile)}</strong>
              </div>
              <button type="button" className="pop-button pop-primary" onClick={() => { play(); setScreen("round"); }}>
                Start game <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
            <img src={`${base}games/toss-basket.webp`} alt="" width="540" height="540" />
          </section>
        )}

        {screen === "round" && (
          <>
            <div className="pop-round-top">
              <div className="pop-progress" aria-label={`Round ${roundIndex + 1} of ${rounds.length}`}>
                <strong>Round {roundIndex + 1}/{rounds.length}</strong>
                <div className="pop-pips" aria-hidden="true">
                  {rounds.map((item, index) => <span key={item.sentence} data-state={index < results.length ? "done" : index === roundIndex ? "current" : "waiting"} />)}
                </div>
              </div>
              <ArcadeScore points={total} />
            </div>

            <DragDropProvider sensors={POINTER_SENSORS} onDragEnd={(event) => {
              if (event.canceled || event.operation.target?.id !== SENTENCE_SLOT) return;
              const tile = round.choices.find((choice) => choice.type === event.operation.source?.id);
              if (tile) chooseTile(tile);
            }}>
              <section className="toss-stage" aria-labelledby="toss-prompt">
                <div className="toss-board">
                  <h1 id="toss-prompt" ref={heading} tabIndex={-1}>Complete the sentence</h1>
                  <p className="toss-sentence" lang="fil">
                    {sentenceStart}<SentenceSlot selected={selected} completedWord={solved?.word} />{sentenceEnd}
                  </p>
                  <p className="toss-root">Root word <strong lang="fil">{round.root}</strong></p>
                </div>
              </section>
              <div className="toss-tile-tray">
                <p>Tap a tile or drag it into the sentence.</p>
                <div className="toss-tiles" role="group" aria-label="Affix tiles">
                  {round.choices.map((tile) => (
                    <DraggableTile key={tile.type} tile={tile} selected={selected?.type === tile.type} disabled={Boolean(solved)} onSelect={chooseTile} />
                  ))}
                </div>
              </div>
              <DragOverlay dropAnimation={null}>
                {(source) => {
                  const tile = round.choices.find((choice) => choice.type === source.id);
                  return tile ? <div className="toss-tile toss-tile-overlay" data-type={tile.type} aria-hidden="true">{tileLabel(tile)}</div> : null;
                }}
              </DragOverlay>
            </DragDropProvider>

            <div className="toss-toolbar">
              <button type="button" className="pop-button pop-quiet" aria-pressed={hintUsed} disabled={Boolean(solved)} onClick={() => setHintUsed(true)}>
                <Lightbulb size={17} aria-hidden="true" /> Hint
              </button>
              <button type="button" className="pop-button pop-quiet" disabled={!selected || Boolean(solved)} onClick={clearTile}>
                <RotateCcw size={17} aria-hidden="true" /> Clear tile
              </button>
              {solved && !celebrating ? (
                <button type="button" ref={nextButton} className="pop-button pop-primary toss-check" onClick={advance}>
                  {finalRound ? "See results" : "Next round"} <ArrowRight size={19} aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="pop-button pop-primary toss-check" disabled={!selected || Boolean(solved)} onClick={checkAnswer}>
                  Check word <Check size={19} aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="toss-feedback" role="status" data-error={showError || undefined}>
              {solved ? <ArcadeCue tone="correct"><span lang="fil">Magaling! <strong>{completedWord}</strong></span></ArcadeCue>
                : showError ? <ArcadeCue tone="retry">Try again. Which affix makes the sentence sound right?</ArcadeCue>
                : hintUsed ? <span lang="fil">{answerType?.clue}</span>
                : selected ? `Tile placed: ${tileLabel(selected)}` : ""}
            </p>
          </>
        )}

        {screen === "results" && (
          <section className="pop-results toss-results" aria-labelledby="toss-results-title">
            <img src={`${base}games/toss-basket.webp`} alt="" width="100" height="100" />
            <h1 id="toss-results-title" ref={heading} tabIndex={-1}>Ang galing!</h1>
            <p>You completed all {TOSS_ROUNDS} sentences.</p>
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{total}<small>/{TOSS_ROUNDS * TOSS_MAX_POINTS}</small></strong></div>
              <div><span>XP earned</span><strong>+{xp}</strong></div>
              <div><span>{newBest ? "New best!" : "Personal best"}</span><strong>{personalBest}</strong></div>
            </div>
            <div className="pop-root-recap" aria-label="Words you made" lang="fil">{results.map((result, index) => <span key={rounds[index].sentence}>{result.word}</span>)}</div>
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
