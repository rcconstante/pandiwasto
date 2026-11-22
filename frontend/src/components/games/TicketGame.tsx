import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Lightbulb, RotateCcw, Star, Ticket, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { buildTicketRun, TICKET_LEVERS, TICKET_POINTS, TICKET_ROUNDS, TICKET_XP, ticketWord, type TicketKind } from "@/data/ticketGame";
import { useArcadeSound } from "./useArcadeSound";
import { ArcadeCue, ArcadeScore } from "./ArcadeFeedback";
import "./ticket-game.css";

const SPARKS = Array.from({ length: 10 }, (_, index) => index);

interface TicketResult {
  word: string;
  kind: TicketKind;
  points: number;
}

function PrintedTickets({ repeated, root, kind }: { repeated: string; root: string; kind: TicketKind }) {
  return (
    <span className="ticket-strip" data-kind={kind} aria-hidden="true">
      <span className="ticket-piece ticket-repeat">{repeated}</span>
      <span className="ticket-piece">{root}</span>
    </span>
  );
}

export function TicketGame({ personalBest, onComplete, onExit }: {
  personalBest: number;
  onComplete: (score: number, xp: number) => void;
  onExit: () => void;
}) {
  const [screen, setScreen] = useState<"intro" | "round" | "results">("intro");
  const [rounds, setRounds] = useState(() => buildTicketRun(personalBest === 0));
  const [roundIndex, setRoundIndex] = useState(0);
  const [hintUsed, setHintUsed] = useState(false);
  const [wrongChoice, setWrongChoice] = useState<TicketKind | null>(null);
  const [printing, setPrinting] = useState(false);
  const [results, setResults] = useState<TicketResult[]>([]);
  const [celebrating, setCelebrating] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const printTimeout = useRef<number | null>(null);
  const { muted, play, toggleSound } = useArcadeSound();
  const machineArt = `${import.meta.env.BASE_URL}games/ticket-machine.webp`;
  const round = rounds[roundIndex];
  const [sentenceStart, sentenceEnd] = round.sentence.split("___");
  const word = ticketWord(round);
  const sentenceWord = sentenceStart ? word : word.charAt(0).toUpperCase() + word.slice(1);
  const answer = results[roundIndex];
  const total = results.reduce((points, result) => points + result.points, 0);
  const finalRound = roundIndex === rounds.length - 1;
  const explanation = round.kind === "ganap"
    ? `Buong salitang ${round.root} ang inulit.`
    : `Ang ${round.repeated}, bahagi ng salitang ${round.root}, ang inulit.`;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [roundIndex, screen]);

  useEffect(() => {
    if (answer && !celebrating && screen === "round") nextButton.current?.focus({ preventScroll: true });
  }, [answer, celebrating, screen]);

  useEffect(() => () => {
    if (printTimeout.current !== null) window.clearTimeout(printTimeout.current);
  }, []);

  function pullLever(kind: TicketKind) {
    if (printTimeout.current !== null || answer || wrongChoice === kind) return;
    if (kind !== round.kind) {
      setWrongChoice(kind);
      play("miss");
      return;
    }

    const points = TICKET_POINTS - (hintUsed ? 25 : 0) - (wrongChoice ? 25 : 0);
    setPrinting(true);
    play("correct");
    const printDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650;
    printTimeout.current = window.setTimeout(() => {
      printTimeout.current = null;
      setPrinting(false);
      setResults([...results, { word, kind, points }]);
      setCelebrating(true);
      if (finalRound) {
        setNewBest(total + points > personalBest);
        onComplete(total + points, TICKET_XP);
      }
    }, printDelay);
  }

  function resetRound() {
    setHintUsed(false);
    setWrongChoice(null);
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
    setRounds(buildTicketRun(false));
    setResults([]);
    setRoundIndex(0);
    setNewBest(false);
    resetRound();
    setScreen("round");
    play();
  }

  const nextLabel = finalRound ? "See results" : "Next round";

  return (
    <main className="pop-game ticket-game">
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
            <Dialog.Content className="pw-modal pop-celebration ticket-celebration" onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="pop-celebration-sparks" aria-hidden="true">
                {SPARKS.map((index) => <i key={index} style={{ rotate: `${index * 36}deg` }} />)}
              </div>
              <PrintedTickets repeated={round.repeated} root={round.root} kind={round.kind} />
              <Dialog.Title lang="fil">Magaling!</Dialog.Title>
              <Dialog.Description className="ticket-answer" lang="fil">
                <strong>{word}</strong>
                {explanation}
              </Dialog.Description>
              <span className="pop-celebration-score"><Star size={17} aria-hidden="true" /> +{answer?.points} points</span>
              <button type="button" className="pop-button pop-primary" onClick={advance}>{nextLabel} <ArrowRight size={19} aria-hidden="true" /></button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {screen === "intro" && (
          <section className="ticket-intro" aria-labelledby="ticket-title">
            <div>
              <p className="pop-skill" lang="fil">Pag-uulit</p>
              <h1 id="ticket-title" ref={heading} tabIndex={-1}>Ticket Stub Dispenser</h1>
              <p className="ticket-intro-copy">Read the sentence and pull a lever to repeat the whole word or just part of it.</p>
              <ul className="ticket-examples" lang="fil">
                <li><strong>Ganap</strong><span>gabi + gabi → gabi-gabi</span></li>
                <li><strong>Parsiyal</strong><span>su + sulat → susulat</span></li>
              </ul>
              <button type="button" className="pop-button pop-primary" onClick={() => { play(); setScreen("round"); }}>
                Start game <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
            <img src={machineArt} alt="" width="560" height="560" />
          </section>
        )}

        {screen === "round" && (
          <>
            <div className="ticket-hud">
              <div className="pop-progress" aria-label={`Round ${roundIndex + 1} of ${rounds.length}`}>
                <strong>Round {roundIndex + 1}/{rounds.length}</strong>
                <div className="pop-pips" aria-hidden="true">
                  {rounds.map((_, index) => <span key={index} data-state={index < results.length ? "done" : index === roundIndex ? "current" : "waiting"} />)}
                </div>
              </div>
              <ArcadeScore points={total} />
            </div>
            <section className="ticket-stage" aria-labelledby="ticket-prompt" data-printing={printing} data-solved={Boolean(answer)}>
              <div className="ticket-machine" aria-hidden="true">
                <img src={machineArt} alt="" width="560" height="560" />
                {printing || answer ? <PrintedTickets repeated={round.repeated} root={round.root} kind={round.kind} /> : null}
              </div>
              <div className="ticket-controls">
                <div className="ticket-prompt">
                  <h1 id="ticket-prompt" ref={heading} tabIndex={-1}>Which ticket fits?</h1>
                  <p className="ticket-sentence" lang="fil">
                    {sentenceStart}
                    <strong className="ticket-blank">
                      {answer ? sentenceWord : <><span aria-hidden="true">___</span><span className="sr-only">patlang</span></>}
                    </strong>
                    {sentenceEnd}
                  </p>
                  <p className="ticket-root">Root word <strong lang="fil">{round.root}</strong></p>
                </div>
                <div className="ticket-levers" role="group" aria-label="Print levers">
                  {TICKET_LEVERS.map((lever) => (
                    <button
                      key={lever.kind}
                      type="button"
                      className="ticket-lever"
                      data-kind={lever.kind}
                      data-state={wrongChoice === lever.kind ? "miss" : round.kind === lever.kind && (printing || answer) ? "pulled" : undefined}
                      disabled={Boolean(answer) || printing || wrongChoice === lever.kind}
                      onClick={() => pullLever(lever.kind)}
                    >
                      <span className="ticket-handle" aria-hidden="true"><i /></span>
                      <span><strong lang="fil">{lever.label}</strong><small>{lever.detail}</small></span>
                    </button>
                  ))}
                </div>
                <p className="ticket-feedback" role="status" data-miss={Boolean(wrongChoice && !printing && !answer)}>
                  {printing ? "Printing your ticket…"
                    : answer ? <ArcadeCue tone="correct">Ticket printed!</ArcadeCue>
                    : wrongChoice ? <ArcadeCue tone="retry">That ticket doesn’t fit the sentence. Try the other lever.</ArcadeCue>
                    : "Pull a lever to print your answer."}
                </p>
              </div>
            </section>
            <div className="ticket-tools">
              <button
                type="button"
                className="pop-button pop-quiet"
                aria-pressed={hintUsed}
                disabled={hintUsed || printing || Boolean(answer)}
                onClick={() => { setHintUsed(true); play(); }}
              >
                <Lightbulb size={17} aria-hidden="true" /> Hint
              </button>
              {hintUsed && !answer && <p className="ticket-clue" role="status" lang="fil">{explanation}</p>}
              {answer && !celebrating && (
                <button ref={nextButton} type="button" className="pop-button pop-primary" onClick={advance}>
                  {nextLabel} <ArrowRight size={19} aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        )}

        {screen === "results" && (
          <section className="pop-results ticket-results" aria-labelledby="ticket-results-title">
            <img src={machineArt} alt="" width="110" height="110" />
            <h1 id="ticket-results-title" ref={heading} tabIndex={-1} lang="fil">Ang galing!</h1>
            <p>You printed all {rounds.length} tickets.</p>
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{total}<small>/{TICKET_ROUNDS * TICKET_POINTS}</small></strong></div>
              <div><span>XP earned</span><strong>+{TICKET_XP}</strong></div>
              <div><span>{newBest ? "New best!" : "Personal best"}</span><strong>{personalBest}</strong></div>
            </div>
            <div className="pop-root-recap" aria-label="Tickets printed" lang="fil">
              {results.map((result) => (
                <span key={result.word} data-kind={result.kind}><Ticket size={15} aria-hidden="true" /> {result.word}</span>
              ))}
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
