import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Grip, Lightbulb, RotateCcw, Star, Volume2, VolumeX } from "lucide-react";
import { Dialog } from "radix-ui";
import { buildClawRun, CLAW_POINTS, CLAW_ROLES, CLAW_XP, type ClawRole } from "@/data/clawGame";
import { useArcadeSound } from "./useArcadeSound";
import { ArcadeCue, ArcadeScore } from "./ArcadeFeedback";
import "./claw-game.css";

const GAME_ART = `${import.meta.env.BASE_URL}games/`;
const SPARKS = Array.from({ length: 10 }, (_, index) => index);
const GRAB_TIME = 1100;

interface ClawResult {
  role: ClawRole;
  subject: string;
  points: number;
}

function Doll({ role }: { role: ClawRole }) {
  return <img src={`${GAME_ART}claw-${CLAW_ROLES[role].animal}.webp`} alt="" width="260" height="260" />;
}

export function ClawGame({ personalBest, onComplete, onExit }: {
  personalBest: number;
  onComplete: (score: number, xp: number) => void;
  onExit: () => void;
}) {
  const [screen, setScreen] = useState<"intro" | "round" | "results">("intro");
  const [rounds, setRounds] = useState(() => buildClawRun(personalBest === 0));
  const [roundIndex, setRoundIndex] = useState(0);
  const [selected, setSelected] = useState<ClawRole | null>(null);
  const [misses, setMisses] = useState<ClawRole[]>([]);
  const [hintUsed, setHintUsed] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [results, setResults] = useState<ClawResult[]>([]);
  const [celebrating, setCelebrating] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const grabTimeout = useRef<number | null>(null);
  const { muted, play, toggleSound } = useArcadeSound();
  const round = rounds[roundIndex];
  const answer = results[roundIndex];
  const total = results.reduce((points, item) => points + item.points, 0);
  const motion = grabbing ? selected === round.role ? "catch" : "miss" : undefined;
  const lane = selected ? round.options.indexOf(selected) : 1;
  const finalRound = roundIndex === rounds.length - 1;
  const nextLabel = finalRound ? "See results" : "Next round";
  const lastMiss = misses[misses.length - 1];
  const retry = Boolean(lastMiss && selected === lastMiss && !grabbing);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [roundIndex, screen]);

  useEffect(() => {
    if (answer && !celebrating && screen === "round") nextButton.current?.focus({ preventScroll: true });
  }, [answer, celebrating, screen]);

  useEffect(() => () => {
    if (grabTimeout.current !== null) window.clearTimeout(grabTimeout.current);
  }, []);

  function choose(role: ClawRole) {
    if (grabbing || answer || misses.includes(role) || role === selected) return;
    setSelected(role);
    play();
  }

  function move(direction: 1 | -1) {
    if (grabbing || answer) return;
    const options = round.options;
    for (let distance = 1; distance <= options.length; distance++) {
      const role = options[(lane + options.length + direction * distance) % options.length];
      if (!misses.includes(role)) {
        choose(role);
        return;
      }
    }
  }

  function grab() {
    if (!selected || answer || misses.includes(selected) || grabTimeout.current !== null) return;
    const correct = selected === round.role;
    setGrabbing(true);
    play(correct ? "correct" : "miss");
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : GRAB_TIME;
    grabTimeout.current = window.setTimeout(() => {
      grabTimeout.current = null;
      setGrabbing(false);
      if (!correct) {
        setMisses([...misses, selected]);
        return;
      }

      const points = CLAW_POINTS - (hintUsed ? 25 : 0) - (misses.length ? 25 : 0);
      setResults([...results, { role: selected, subject: round.subject, points }]);
      setCelebrating(true);
      if (finalRound) {
        setNewBest(total + points > personalBest);
        onComplete(total + points, CLAW_XP);
      }
    }, delay);
  }

  function resetRound() {
    setSelected(null);
    setMisses([]);
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
    setRounds(buildClawRun(false));
    setResults([]);
    setRoundIndex(0);
    setNewBest(false);
    resetRound();
    setScreen("round");
    play();
  }

  const feedback = grabbing
    ? "The claw is reaching…"
    : answer ? "Prize caught!"
      : selected && selected === lastMiss ? "Try another doll. What role does the subject play?"
        : selected ? `${CLAW_ROLES[selected].label} selected. Press Grab!`
          : "Choose a doll or move the claw with the arrows.";

  return (
    <main className="pop-game claw-game">
      <div className="pop-shell">
        <header className="pop-top">
          <button
            ref={backButton}
            type="button"
            className="pop-button pop-quiet"
            disabled={grabbing}
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
            <Dialog.Content className="pw-modal pop-celebration claw-celebration" onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="pop-celebration-sparks" aria-hidden="true">
                {SPARKS.map((index) => <i key={index} style={{ rotate: `${index * 36}deg` }} />)}
              </div>
              <Doll role={round.role} />
              <Dialog.Title lang="fil">Magaling!</Dialog.Title>
              <Dialog.Description className="claw-answer" lang="fil">
                <strong>{CLAW_ROLES[round.role].label}</strong>
                {round.explanation}
              </Dialog.Description>
              <span className="pop-celebration-score"><Star size={17} aria-hidden="true" /> +{answer?.points} points</span>
              <button type="button" className="pop-button pop-primary" onClick={advance}>{nextLabel} <ArrowRight size={19} aria-hidden="true" /></button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {screen === "intro" && (
          <section className="claw-intro" aria-labelledby="claw-title">
            <div>
              <p className="pop-skill" lang="fil">Pokus ng Pandiwa</p>
              <h1 id="claw-title" ref={heading} tabIndex={-1}>Claw Machine</h1>
              <p className="claw-intro-copy">Read the sentence, then grab the doll that matches the verb focus.</p>
              <div className="pop-example" lang="fil">
                <span>Nagluto si Ana.</span><ArrowRight size={18} aria-hidden="true" /><strong>Tagaganap</strong>
              </div>
              <button type="button" className="pop-button pop-primary" onClick={() => { play(); setScreen("round"); }}>
                Start game <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
            <img src={GAME_ART + "claw-cabinet.webp"} alt="" width="560" height="560" />
          </section>
        )}

        {screen === "round" && (
          <>
            <div className="claw-hud">
              <div className="pop-progress" aria-label={`Round ${roundIndex + 1} of ${rounds.length}`}>
                <strong>Round {roundIndex + 1}/{rounds.length}</strong>
                <div className="pop-pips" aria-hidden="true">
                  {rounds.map((_, index) => <span key={index} data-state={index < results.length ? "done" : index === roundIndex ? "current" : "waiting"} />)}
                </div>
              </div>
              <ArcadeScore points={total} />
            </div>
            <section className="claw-stage" aria-labelledby="claw-prompt">
              <div className="claw-question">
                <div className="claw-prompt">
                  <h1 id="claw-prompt" ref={heading} tabIndex={-1}>What is the verb focus?</h1>
                  <p className="claw-sentence" lang="fil">
                    <strong>{round.verb}</strong>{" "}
                    {round.beforeFocus && `${round.beforeFocus} `}
                    {hintUsed || answer ? <mark>{round.subject}</mark> : round.subject}
                    {round.afterFocus && ` ${round.afterFocus}`}.
                  </p>
                </div>
                <div className="claw-tools">
                  <button
                    type="button"
                    className="pop-button pop-quiet"
                    aria-pressed={hintUsed}
                    disabled={hintUsed || grabbing || Boolean(answer)}
                    onClick={() => { setHintUsed(true); play(); }}
                  >
                    <Lightbulb size={17} aria-hidden="true" /> Hint
                  </button>
                  {hintUsed && !answer && <p className="claw-clue" role="status">The highlighted phrase is the subject. What role does it play?</p>}
                  {answer && !celebrating && (
                    <button ref={nextButton} type="button" className="pop-button pop-primary" onClick={advance}>
                      {nextLabel} <ArrowRight size={19} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="claw-cabinet" data-motion={motion}>
                <div className="claw-window">
                  <div className="claw-crane" style={{ "--claw-lane": lane } as CSSProperties} aria-hidden="true">
                    <span className="claw-hook" />
                  </div>
                  <div className="claw-prizes" role="group" aria-label="Prize dolls">
                    {round.options.map((role) => (
                      <button
                        key={role}
                        type="button"
                        className="claw-prize"
                        data-role={role}
                        data-caught={Boolean(answer) && role === selected}
                        data-missed={misses.includes(role)}
                        aria-pressed={role === selected}
                        aria-description={CLAW_ROLES[role].detail}
                        lang="fil"
                        disabled={grabbing || Boolean(answer) || misses.includes(role)}
                        onClick={() => choose(role)}
                      >
                        <Doll role={role} />
                        <span>{CLAW_ROLES[role].label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="claw-controls">
                  <button type="button" className="pop-button pop-quiet claw-arrow" aria-label="Move claw left" disabled={grabbing || Boolean(answer)} onClick={() => move(-1)}>
                    <ChevronLeft size={23} aria-hidden="true" />
                  </button>
                  <button type="button" className="pop-button pop-primary claw-grab" disabled={!selected || grabbing || Boolean(answer) || misses.includes(selected)} onClick={grab}>
                    <Grip size={20} aria-hidden="true" /> Grab!
                  </button>
                  <button type="button" className="pop-button pop-quiet claw-arrow" aria-label="Move claw right" disabled={grabbing || Boolean(answer)} onClick={() => move(1)}>
                    <ChevronRight size={23} aria-hidden="true" />
                  </button>
                </div>
                <p className="claw-feedback" role="status">
                  {answer || retry ? <ArcadeCue tone={answer ? "correct" : "retry"}>{feedback}</ArcadeCue> : feedback}
                </p>
              </div>
            </section>
          </>
        )}

        {screen === "results" && (
          <section className="pop-results claw-results" aria-labelledby="claw-results-title">
            <img src={GAME_ART + "claw-cabinet.webp"} alt="" width="110" height="110" />
            <h1 id="claw-results-title" ref={heading} tabIndex={-1} lang="fil">Ang galing!</h1>
            <p>You caught all {rounds.length} prizes.</p>
            <div className="pop-result-stats">
              <div><span>Score</span><strong>{total}<small>/{rounds.length * CLAW_POINTS}</small></strong></div>
              <div><span>XP earned</span><strong>+{CLAW_XP}</strong></div>
              <div><span>{newBest ? "New best!" : "Personal best"}</span><strong>{personalBest}</strong></div>
            </div>
            <div className="claw-collection" aria-label="Prizes collected">
              {results.map((item, index) => (
                <div key={index} lang="fil">
                  <Doll role={item.role} />
                  <strong>{CLAW_ROLES[item.role].label}</strong>
                  <span>{item.subject}</span>
                </div>
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
