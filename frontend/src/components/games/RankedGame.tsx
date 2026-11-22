import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { DragDropProvider, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, GripVertical, Hammer, Lightbulb, Moon, Printer, RotateCcw, Sparkles, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { MINIGAMES } from "@/data/landingData";
import { ArcadeRequestError, moveRankedGame, refreshRankedGame, startRankedGame, type RankedMove, type RankedSnapshot } from "@/lib/arcadeApi";
import { ArcadeCue, ArcadeHearts, ArcadeScore } from "./ArcadeFeedback";
import { RoundFeedbackDialog } from "./RoundFeedbackDialog";
import { waitForGameMotion } from "./gameMotion";
import { useArcadeSound } from "./useArcadeSound";
import "./whack-game.css";
import "./toss-game.css";
import "./memory-game.css";
import "./ticket-game.css";
import "./claw-game.css";
import "./fortune-game.css";
import "./ranked-game.css";

const BASE = import.meta.env.BASE_URL + "games/";
const THEMES: Record<number, { theme: string; asset: string; prompt: string }> = {
  2: { theme: "whack", asset: "whack-mole", prompt: "What kind of word is it?" },
  3: { theme: "toss", asset: "toss-basket", prompt: "Complete the sentence" },
  4: { theme: "memory", asset: "memory-cards", prompt: "Find the word pairs" },
  5: { theme: "ticket", asset: "ticket-machine", prompt: "Which ticket fits?" },
  6: { theme: "claw", asset: "claw-cabinet", prompt: "What is the verb focus?" },
  7: { theme: "fortune", asset: "fortune-machine", prompt: "What will the card say?" },
};
const DOLLS: Record<string, string> = { tagaganap: "cat", layon: "turtle", ganapan: "rabbit", tagatanggap: "chick" };
const SLOT = "ranked-toss-slot";
const SENSORS = [PointerSensor];
const MOTION_MS: Record<number, number> = { 2: 580, 3: 360, 4: 620, 5: 650, 6: 1100, 7: 680 };
type Reaction = { tone: "win" | "miss"; choice?: string; hole?: number; answer?: string };

interface PendingMove {
  id: string;
  game: RankedSnapshot;
  action: RankedMove;
}

type Choice = NonNullable<RankedSnapshot["options"]>[number];
type Picker = (id: string) => void;

function Tile({ option, selected, locked, pick }: { option: Choice; selected: boolean; locked: boolean; pick: Picker }) {
  const { ref, isDragging } = useDraggable({ id: option.id, disabled: locked });
  return <button ref={ref} type="button" className="toss-tile" data-type={option.type} data-dragging={isDragging || undefined} aria-pressed={selected} disabled={locked} onClick={() => pick(option.id)}>
    <GripVertical size={17} aria-hidden="true" /> {option.label}
  </button>;
}

function Blank({ selected, locked }: { selected?: Choice; locked: boolean }) {
  const { ref, isDropTarget } = useDroppable({ id: SLOT, disabled: locked });
  return <span ref={ref} className="toss-slot" data-over={isDropTarget || undefined} data-filled={Boolean(selected)}>{selected?.label ?? "Drop tile here"}</span>;
}

function Sentence({ sentence, slot }: { sentence: string; slot: ReactNode }) {
  const parts = sentence.split(/___+|\{blank\}/);
  return <>{parts[0]}{parts.length > 1 && <>{slot}{parts.slice(1).join(" ")}</>}</>;
}

function ClawCabinet({ options, selected, rejected, locked, pick, grab, reaction }: {
  options: Choice[]; selected: string; rejected: string[]; locked: boolean; pick: Picker; grab: () => void; reaction?: Reaction["tone"];
}) {
  const index = options.findIndex((option) => option.id === selected);
  function step(direction: number) {
    if (options.length) pick(options[(Math.max(0, index) + options.length + direction) % options.length].id);
  }
  return <div className="claw-cabinet" data-motion={reaction}>
    <div className="claw-window">
      <div className="claw-crane" style={{ "--claw-lane": Math.max(0, index) } as CSSProperties} aria-hidden="true"><span className="claw-hook" /></div>
      <div className="claw-prizes" role="group" aria-label="Prize dolls">
        {options.map((option) => <button key={option.id} type="button" className="claw-prize" disabled={locked}
          aria-pressed={selected === option.id} data-missed={rejected.includes(option.id)} onClick={() => pick(option.id)}>
          {DOLLS[option.id] && <img src={BASE + "claw-" + DOLLS[option.id] + ".webp"} alt="" width="100" height="100" />}
          <span>{option.label}</span>
        </button>)}
      </div>
    </div>
    <div className="claw-controls">
      <button type="button" className="pop-button pop-quiet claw-arrow" aria-label="Move claw left" disabled={locked} onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></button>
      <button type="button" className="pop-button pop-primary claw-grab" disabled={locked || index < 0} onClick={grab}>Grab!</button>
      <button type="button" className="pop-button pop-quiet claw-arrow" aria-label="Move claw right" disabled={locked} onClick={() => step(1)}><ChevronRight aria-hidden="true" /></button>
    </div>
  </div>;
}

export function RankedGame({ gameId, personalBest, testPlay, onComplete, onExit }: {
  gameId: number; personalBest: number; testPlay: boolean; onComplete: () => void; onExit: () => void;
}) {
  const [run, setRun] = useState<RankedSnapshot | null>(null);
  const [selected, setSelected] = useState("");
  const [practice, setPractice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [retry, setRetry] = useState<PendingMove | null>(null);
  const [quit, setQuit] = useState(false);
  const [review, setReview] = useState(false);
  const [motion, setMotion] = useState<Reaction | null>(null);
  const [time, setTime] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const inflight = useRef(false);
  const beginId = useRef<string | null>(null);
  const ended = useRef<string | null>(null);
  const automaticHint = useRef<string | null>(null);
  const focus = useRef<HTMLHeadingElement>(null);
  const game = MINIGAMES.find((item) => item.id === gameId)!;
  const config = THEMES[gameId];
  const { muted, play, toggleSound } = useArcadeSound();
  const playing = run?.status === "active";
  const round = run?.round;
  const inReview = playing && run.phase === "review";
  const options = run?.options ?? [];
  const rejected = run?.rejected ?? [];
  const locked = !playing || Boolean(inReview) || review || busy || Boolean(retry) || needsRefresh;
  const deadline = playing && !inReview ? run.deadline : null;
  const remaining = deadline ? Math.max(0, deadline - time - offset) : null;
  const faceDown = Boolean(run?.hideAt && time + offset >= run.hideAt);
  const sprite = BASE + config.asset + ".webp";
  const hintVisible = gameId !== 2 && run?.hintAllowed !== false && !inReview;
  const hintLevel = run?.hintLevel ?? 0;
  const selectedOption = options.find((choice) => choice.id === selected);
  const win = run?.feedback?.kind === "correct" || run?.feedback?.kind === "match" || run?.feedback?.kind === "board-complete";
  const afterMiss = run?.feedback?.kind === "wrong" || run?.feedback?.kind === "mismatch";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    focus.current?.focus({ preventScroll: true });
  }, [round, playing]);

  const needClock = Boolean(deadline || (playing && run.hideAt));
  useEffect(() => {
    if (!needClock) return;
    const interval = window.setInterval(() => setTime(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [needClock]);

  const moveOnClock = useEffectEvent((action: RankedMove) => submit(action));
  useEffect(() => {
    if (gameId !== 2 || !deadline || !playing || review || busy || retry || quit || error) return;
    const delay = Math.max(0, deadline - Date.now() - offset) + 120;
    const timer = window.setTimeout(() => moveOnClock({ type: "timeout" }), delay);
    return () => window.clearTimeout(timer);
  }, [deadline, offset, playing, gameId, review, busy, retry, quit, error]);

  useEffect(() => {
    if (gameId === 2 || !playing || locked || quit || error || !afterMiss || !run.studyActive || !run.hintAllowed || hintLevel >= 3) return;
    // One automatic hint per miss: hearts drop once for each wrong answer.
    const key = run.runId + ":" + run.round + ":" + run.hearts;
    if (automaticHint.current === key) return;
    const delay = run.hideAt ? Math.max(0, run.hideAt - Date.now() - offset) + 120 : 0;
    const timer = window.setTimeout(() => {
      automaticHint.current = key;
      moveOnClock({ type: "hint" });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [gameId, playing, locked, quit, error, afterMiss, run, offset, hintLevel]);

  function receive(snapshot: RankedSnapshot, observedAt: number, showFeedback: boolean) {
    if (snapshot.serverNow !== undefined) setOffset(snapshot.serverNow - observedAt);
    setTime(observedAt);
    setRun(snapshot);
    setReview(showFeedback && snapshot.feedback !== null && snapshot.feedback?.kind !== "match");
    if (snapshot.round !== round || snapshot.status !== "active") setSelected("");
    switch (snapshot.feedback?.kind) {
      case "correct": case "match": case "board-complete": play("correct"); break;
      case "wrong": case "mismatch": case "timeout": play("miss"); break;
      default: play(); break;
    }
    if (snapshot.status === "completed" && ended.current !== snapshot.runId) {
      ended.current = snapshot.runId;
      onComplete();
    }
  }

  async function perform(work: () => Promise<RankedSnapshot>, failed: (error: unknown) => void, action?: RankedMove) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError("");
    setNeedsRefresh(false);
    try {
      const snapshot = await work();
      const observedAt = Date.now();
      const played = action?.type === "answer" || action?.type === "timeout" || action?.type === "flip";
      if (played && snapshot.feedback) {
        const missed = ["wrong", "mismatch", "timeout"].includes(snapshot.feedback.kind);
        const activeHole = snapshot.round % 3;
        setMotion({ tone: missed ? "miss" : "win", answer: snapshot.feedback.answer,
          choice: action.type === "answer" ? action.choice : undefined,
          hole: missed ? (activeHole + 1 + Math.floor(Math.random() * 2)) % 3 : activeHole });
        if (gameId === 4) {
          setTime(observedAt);
          setRun(snapshot);
        }
        await waitForGameMotion(MOTION_MS[gameId]);
        setMotion(null);
      }
      receive(snapshot, observedAt, played || (!action && snapshot.phase === "review" && snapshot.status === "active"));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The connection paused. Try again.");
      setNeedsRefresh(problem instanceof ArcadeRequestError && problem.status === 409);
      failed(problem);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  function refreshRun() {
    if (!run) return;
    void perform(() => refreshRankedGame(run), () => setNeedsRefresh(true));
  }

  function start() {
    beginId.current ??= crypto.randomUUID();
    const requestId = beginId.current;
    void perform(async () => {
      const snapshot = await startRankedGame(gameId, requestId, gameId === 2 && practice ? "practice" : "ranked");
      beginId.current = null;
      return snapshot;
    }, () => {});
  }

  function submit(action?: RankedMove) {
    if (!run || !playing || inflight.current || (!action && !retry)) return;
    const pending = retry ?? { game: run, id: crypto.randomUUID(), action: action! };
    void perform(async () => {
      const snapshot = await moveRankedGame(pending.game, pending.id, pending.action);
      setRetry(null);
      if (snapshot.status === "abandoned") onExit();
      return snapshot;
    }, (problem) => {
      // Retry a lost response with the same request ID and move.
      const recoverable = problem instanceof ArcadeRequestError ? problem.status >= 500 || problem.status === 429 : true;
      setRetry(recoverable ? pending : null);
    }, pending.action);
  }

  function pick(choice: string) {
    if (locked) return;
    setSelected(choice);
    play();
  }

  function answer(choice: string) {
    submit({ type: "answer", choice });
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (gameId !== 2 || locked || remaining === 0 || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const option = options[Number(event.key) - 1];
    if (option && options.length) {
      event.preventDefault();
      answer(option.id);
    }
  }

  const blankSlot = <strong className="ticket-blank" aria-label="Patlang">___</strong>;
  const nextMove = () => submit({ type: "next" });
  const remainingHearts = run?.hearts ?? 3;
  const noHearts = remainingHearts === 0;
  const retryWord = !win && !noHearts && (gameId === 2 || run?.phase === "playing");
  const nextLabel = run?.status === "completed" ? "See results" : retryWord ? "Try again" : gameId === 4 ? "Next board" : "Next word";
  const hintButton = hintVisible && <button type="button" className="pop-button pop-quiet" disabled={locked || hintLevel >= 3} onClick={() => submit({ type: "hint" })}><Lightbulb size={17} aria-hidden="true" /> {hintLevel ? "Next hint" : "Hint"}</button>;

  function continueReview() {
    if (needsRefresh) refreshRun();
    else if (retry) submit();
    else if (run?.status !== "active" || !inReview) setReview(false);
    else nextMove();
  }

  return (
    <main className={"pop-game ranked-game " + config.theme + "-game"} onKeyDown={handleKeyboard}>
      <div className="pop-shell">
        <header className="pop-top">
          <button type="button" className="pop-button pop-quiet" disabled={busy} onClick={() => playing ? setQuit(true) : onExit()}><ArrowLeft size={18} aria-hidden="true" /> Games</button>
          <span className="pop-brand">PandiWasto Arcade</span>
          <button type="button" className="pop-button pop-quiet pop-sound" aria-label={muted ? "Turn sound on" : "Mute sound"} onClick={toggleSound}>
            {muted ? <VolumeX size={19} aria-hidden="true" /> : <Volume2 size={19} aria-hidden="true" />}
          </button>
        </header>
        {testPlay && <p className="pop-test-play">Test play · Account XP and scores stay unchanged</p>}

        {(!run || run.status === "abandoned") && <section className={config.theme + "-intro ranked-intro"}>
          <div>
            <p className="pop-skill" lang="fil">{game.lesson}</p>
            <h1 ref={focus} tabIndex={-1}>{game.gameName}</h1>
            <p>{game.description}</p>
            <small>Three hearts per {gameId === 4 ? "board" : "word"}. After three misses, review and move on.</small>
            <div className="ranked-actions">
              <button type="button" className="pop-button pop-primary" disabled={busy} onClick={start}>Start game <ArrowRight size={18} aria-hidden="true" /></button>
              {gameId === 2 && <label className="whack-practice"><input type="checkbox" checked={practice} onChange={(event) => setPractice(event.target.checked)} /> Untimed practice</label>}
            </div>
          </div>
          <img src={sprite} alt="" width="440" height="440" />
        </section>}

        {run && (playing || review || motion) && <div className="ranked-play" data-reaction={motion?.tone} style={{ "--arcade-motion-ms": MOTION_MS[gameId] + "ms" } as CSSProperties}>
          <div className="pop-round-top">
            <span className="pop-progress">{gameId === 4 ? "Board" : "Word"} {run.round + 1}{run.totalRounds && "/" + run.totalRounds}</span>
            <ArcadeHearts lives={remainingHearts} total={3} />
            <span className="ranked-meters">
              {remaining !== null && <span className="pop-progress" aria-label="Time remaining">{(remaining / 1000).toFixed(1)} s</span>}
              <ArcadeScore points={run.score} />
            </span>
          </div>

          {gameId === 2 && <>
            <section className="whack-stage ranked-whack">
              <h1 ref={focus} tabIndex={-1}>{config.prompt}</h1>
              <p className="whack-word" lang="fil">{run.word}</p>
              <div className="whack-holes" aria-hidden="true">
                {[0, 1, 2].map((slot) => <div className="whack-hole" key={slot}><div className="whack-hole-rim" />
                  {slot === run.round % 3 && (remaining !== 0 || motion) && <img className="whack-mole" data-state={motion?.tone === "win" ? "correct" : motion?.tone === "miss" ? "down" : "up"} src={sprite} alt="" width="540" height="540" />}
                  {motion?.hole === slot && <span className="whack-hammer" data-impact={motion.tone}><Hammer aria-hidden="true" /><Sparkles aria-hidden="true" /></span>}
                </div>)}
              </div>
            </section>
            <div className="whack-answers" role="group" aria-label="Word type">
              {options.map((choice, index) => <button type="button" key={choice.id} className="whack-choice" data-type={choice.id} disabled={locked || remaining === 0} onClick={() => answer(choice.id)}>
                <kbd aria-hidden="true">{index + 1}</kbd> <span lang="fil">{choice.label}</span>
              </button>)}
            </div>
            {remaining === 0 && !inReview && <button type="button" className="pop-button pop-primary" disabled={busy || Boolean(retry)} onClick={() => submit({ type: "timeout" })}>Review expired word</button>}
          </>}

          {gameId === 3 && <DragDropProvider sensors={SENSORS} onDragEnd={(event) => {
            if (event.canceled || event.operation.target?.id !== SLOT) return;
            const id = event.operation.source?.id;
            if (typeof id === "string") pick(id);
          }}>
            <section className="toss-stage">
              <div className="toss-board">
                <h1 ref={focus} tabIndex={-1}>{config.prompt}</h1>
                <p className="toss-sentence" lang="fil"><Sentence sentence={run.sentence ?? ""} slot={<Blank selected={selectedOption} locked={locked} />} /></p>
                <p className="toss-root">Root word <strong lang="fil">{run.root}</strong></p>
              </div>
            </section>
            <div className="toss-tile-tray">
              <p>Tap a tile or drag it into the sentence.</p>
              <div className="toss-tiles" role="group" aria-label="Affix tiles">
                {options.map((choice) => <Tile key={choice.id} option={choice} selected={selected === choice.id} locked={locked} pick={pick} />)}
              </div>
            </div>
            <div className="ranked-actions ranked-toss-actions">
              <button type="button" className="pop-button pop-primary" disabled={locked || !selected} onClick={() => answer(selected)}>Check word <Check size={17} aria-hidden="true" /></button>
              <button type="button" className="pop-button pop-quiet" disabled={locked || !selected} onClick={() => setSelected("")}>Clear tile</button>
              {hintButton}
            </div>
          </DragDropProvider>}

          {gameId === 4 && <section className="memory-stage">
            <div className="memory-board-caption"><h1 ref={focus} tabIndex={-1}>{config.prompt}</h1><p>{run.pairsFound}/{run.pairsTotal} pairs · {run.moves} moves</p></div>
            <div className="memory-board" data-count={run.cards?.length} role="group" aria-label="Word cards">
              {run.cards?.map((card, index) => {
                const visible = Boolean(card.word && (card.matched || !faceDown));
                const miss = visible && !card.matched && run.feedback?.kind === "mismatch";
                return <button key={card.id} type="button" className="memory-card" disabled={locked || card.matched || Boolean(run.hideAt && !faceDown)}
                  aria-label={visible ? "Card " + (index + 1) + ": " + card.word : "Flip card " + (index + 1)}
                  data-revealed={visible} data-matched={card.matched} data-miss={miss} data-hint={card.hinted}
                  onClick={() => submit({ type: "flip", cardId: card.id })}>
                  <span className="memory-card-inner" aria-hidden="true">
                    <span className="memory-card-back"><Sparkles size={26} /><small>{index + 1}</small></span>
                    <span className="memory-card-front" lang="fil">{card.matched && <Check size={15} />}<span className="memory-card-word">{visible ? card.word : ""}</span></span>
                  </span>
                </button>;
              })}
            </div>
          </section>}

          {gameId === 5 && <section className="ticket-stage" data-printing={Boolean(motion)}>
            <div className="ticket-machine"><img src={sprite} alt="" width="382" height="382" />{motion?.tone === "win" && <span className="ticket-strip ranked-ticket" aria-hidden="true"><span className="ticket-piece">{motion.answer}</span></span>}</div>
            <div className="ticket-controls">
              <div className="ticket-prompt"><h1 ref={focus} tabIndex={-1}>{config.prompt}</h1>
                <p className="ticket-sentence" lang="fil"><Sentence sentence={run.sentence ?? ""} slot={blankSlot} /></p>
                <p className="ticket-root">Root word <strong lang="fil">{run.root}</strong></p>
              </div>
              <div className="ticket-levers" role="group" aria-label="Print levers">
                {options.map((choice) => <button type="button" key={choice.id} className="ticket-lever" data-kind={choice.id}
                  disabled={locked} data-state={rejected.includes(choice.id) ? "miss" : undefined} data-pulling={motion?.choice === choice.id || undefined} onClick={() => answer(choice.id)}>
                  <span className="ticket-handle" aria-hidden="true"><i /></span><span><strong lang="fil">{choice.label}</strong><small>{choice.id === "ganap" ? "Repeat the whole word" : "Repeat part of the word"}</small></span>
                </button>)}
              </div>
            </div>
          </section>}

          {gameId === 6 && <section className="claw-stage">
            <div className="claw-prompt"><h1 ref={focus} tabIndex={-1}>{config.prompt}</h1>
              <p className="claw-sentence" lang="fil">{run.verb && <strong>{run.verb}</strong>} {run.verb && run.sentence?.startsWith(run.verb) ? run.sentence.slice(run.verb.length).trimStart() : run.sentence}</p>
            </div>
            <ClawCabinet options={options} selected={selected} rejected={rejected} locked={locked} pick={pick} grab={() => answer(selected)} reaction={motion?.tone} />
          </section>}

          {gameId === 7 && <section className="fortune-stage" data-printing={Boolean(motion)}>
            <div className="fortune-machine"><img src={sprite} alt="" width="380" height="380" />{motion?.tone === "win" && <span className="fortune-card" aria-hidden="true"><Moon size={14} /> {motion.answer}</span>}</div>
            <div className="fortune-board"><h1 ref={focus} tabIndex={-1}>{config.prompt}</h1>
              <div className="fortune-pair" lang="fil"><strong>pang-</strong><span>+</span><strong>{run.root}</strong></div>
              <div className="fortune-choices" role="group" aria-label="Predict the word">
                {options.map((choice) => <button type="button" className="fortune-choice" key={choice.id} lang="fil" aria-pressed={selected === choice.id} data-rejected={rejected.includes(choice.id)}
                  disabled={locked} onClick={() => pick(choice.id)}>{choice.label}</button>)}
              </div>
              <button type="button" className="pop-button pop-primary" disabled={locked || !selected} onClick={() => answer(selected)}><Printer size={17} aria-hidden="true" /> Print card</button>
            </div>
          </section>}

          <div className="ranked-actions">
            {gameId !== 3 && hintButton}
            {gameId === 2 && (run.hits ?? 0) > 0 && !inReview && <button type="button" className="pop-button pop-quiet" disabled={busy || Boolean(retry)} onClick={() => submit({ type: "finish" })}>Finish run</button>}
            {inReview && !review && <button type="button" className="pop-button pop-primary" disabled={busy || Boolean(retry)} onClick={nextMove}>{nextLabel} <ArrowRight size={18} aria-hidden="true" /></button>}
          </div>
          {run.feedback && !motion && !review && <p className="pop-feedback" role="status" key={run.version}><ArcadeCue tone={win ? "correct" : "retry"}>{run.feedback.text}</ArcadeCue></p>}
          {run.hint && <p className="ranked-hint" role="status" lang="fil">{run.hint}</p>}
        </div>}

        {run?.status === "completed" && !review && !motion && <section className="pop-results">
          <img src={sprite} alt="" width="100" height="100" />
          <h1 ref={focus} tabIndex={-1}>{run.score > 0 ? "Ang galing!" : "Game complete"}</h1>
          <div className="pop-result-stats">
            <div><span>Score</span><strong>{run.score.toLocaleString()}</strong></div>
            <div><span>{testPlay ? "Test XP" : "XP earned"}</span><strong>+{run.xp.toLocaleString()}</strong></div>
            <div><span>Personal best</span><strong>{Math.max(personalBest, !testPlay && run.mode === "ranked" ? run.score : 0).toLocaleString()}</strong></div>
          </div>
          {run.results.length > 0 && <div className="pop-root-recap" aria-label="Run review">
            {run.results.map((item, index) => <span key={index}>{item.text}</span>)}
          </div>}
          <div className="pop-results-actions">
            <button type="button" className="pop-button pop-primary" disabled={busy} onClick={start}>Play again <RotateCcw size={17} aria-hidden="true" /></button>
            <button type="button" className="pop-button pop-quiet" disabled={busy} onClick={onExit}>Back to games</button>
          </div>
        </section>}

        {!review && !quit && <>
          {error && <p className="pop-feedback" role="alert" data-result="retry">{error}</p>}
          {retry && <button className="pop-button pop-primary" type="button" disabled={busy} onClick={() => submit()}>Retry save</button>}
          {needsRefresh && run && <button className="pop-button pop-primary" type="button" disabled={busy} onClick={refreshRun}>Refresh run</button>}
        </>}

        <RoundFeedbackDialog open={review && !motion} onOpenChange={setReview} won={win}
          title={win ? (gameId === 4 ? "Board complete!" : "Magaling!") : noHearts ? "No hearts left for this " + (gameId === 4 ? "board" : "word") : "Try again!"}
          description={(win || noHearts ? "" : "One heart lost. ") + (run?.feedback?.text ?? "Continue when you’re ready.")}
          answer={run?.feedback?.answer} points={run?.feedback?.points}
          actionLabel={needsRefresh ? "Refresh run" : retry ? "Retry move" : nextLabel} busy={busy} onAction={continueReview}>
          {error && <p role="alert">{error}</p>}
          {gameId === 2 && playing && (run?.hits ?? 0) > 0 && !retry && <button type="button" className="pop-button pop-quiet" disabled={busy} onClick={() => submit({ type: "finish" })}>Finish run</button>}
        </RoundFeedbackDialog>

        <Dialog.Root open={quit} onOpenChange={setQuit}>
          <Dialog.Portal><Dialog.Overlay className="pw-modal-overlay" />
            <Dialog.Content className="pw-modal pop-exit">
              <Dialog.Title>Leave this game?</Dialog.Title>
              <Dialog.Description>{retry || error ? "You can reopen this run later." : "Leaving now ends this run without rewards."}</Dialog.Description>
              <div className="pop-exit-actions">
                <Dialog.Close asChild><button type="button" className="pop-button pop-primary" disabled={busy}>Keep playing</button></Dialog.Close>
                <button type="button" className="pop-button pop-quiet" disabled={busy} onClick={() => retry || error ? onExit() : submit({ type: "abandon" })}>Leave game</button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </main>
  );
}
