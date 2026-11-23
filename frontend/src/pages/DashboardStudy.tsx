import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { arcadeRequest } from "@/lib/arcadeApi";
import { StudySurvey } from "./StudySurvey";
import "./dashboard-research.css";

export type StudyStage = "unavailable" | "invited" | "scheduled" | "pretest" | "practice" | "posttest" | "delayedtest" | "completed" | "closed";

interface StudyState {
  state: StudyStage;
  title?: string;
  information?: string;
  opensAt?: string;
  posttestAt?: string;
  closesAt?: string;
  delayedAt?: string;
  surveyDue?: boolean;
  canWithdraw?: boolean;
  questions?: { id: string; prompt: string; choices: string[] }[];
}

export function DashboardStudy({ onStatusChange, onPlay }: {
  onStatusChange?: (state: StudyStage) => void;
  onPlay?: () => void;
}) {
  const [state, setState] = useState<StudyState | null>(null);
  const [checks, setChecks] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    arcadeRequest<StudyState>("study/status", undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setState(result); })
      .catch(() => { if (!controller.signal.aborted) setError("Study status could not load."); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (state) onStatusChange?.(state.state);
  }, [state, onStatusChange]);

  async function change(path: string, body: object, fallback: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await arcadeRequest<StudyState>(path, body);
      setState(result);
      setChecks({});
      setConfirmed(false);
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phase = state?.state === "pretest" ? "pre" : state?.state === "delayedtest" ? "delayed" : "post";
    const choices = (state?.questions ?? []).map((question) => ({ itemId: question.id, choice: checks[question.id] }));
    await change("study/assessment/" + phase + "/submit", { choices }, "Your assessment could not be saved. You can try again.");
  }

  function reload() {
    setError("");
    setRefresh((value) => value + 1);
  }

  if (!state) return (
    <>
      <h2>Study</h2>
      {error
        ? <div className="pwd-study-note"><p role="alert">{error}</p><button type="button" className="pwd-save" onClick={reload}>Try again</button></div>
        : <p role="status">Loading your study status…</p>}
    </>
  );

  const phase = state.state === "pretest" || state.state === "posttest" || state.state === "delayedtest";
  const questions = state.questions ?? [];
  const nextDate = state.state === "scheduled" ? state.opensAt : state.posttestAt;

  return (
    <>
      <h2>{state.title ?? "Study"}</h2>
      <div className="pwd-study-layout">
        {state.state === "unavailable" && <p className="pwd-study-note">A study invitation will appear here when it’s available for your account.</p>}
        {state.state === "invited" && (
          <div className="pwd-study-note">
            <h3>Your study invitation</h3>
            <p className="pwd-study-information">{state.information}</p>
            <p>Participation is optional. You can leave the study from this page.</p>
            <label className="pwd-study-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I have read the study information and want to take part.</label>
            <button type="button" className="pwd-save pwd-study-primary" disabled={!confirmed || busy} onClick={() => void change("study/consent", { participate: true }, "Enrollment is not ready. Contact your study coordinator or try again later.")}>Join study <ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        )}
        {state.state === "scheduled" && (
          <div className="pwd-study-note"><h3>You joined the study</h3><p>Your first assessment opens on {nextDate ? new Date(nextDate).toLocaleString() : "the scheduled date"}.</p><button type="button" className="pwd-save" onClick={reload}>Check status</button></div>
        )}
        {phase && (
          <form className="pwd-study-form" onSubmit={(event) => void submit(event)}>
            <h3>{state.state === "pretest" ? "Pre-assessment" : state.state === "delayedtest" ? "Follow-up assessment" : "Post-assessment"}</h3>
            <p>Choose one answer for each question.</p>
            {questions.map((question, questionIndex) => (
              <fieldset key={question.id} className="pwd-study-note" disabled={busy}>
                <legend>{questionIndex + 1}. {question.prompt}</legend>
                <div className="pwd-study-choices">
                  {question.choices.map((choice, index) => (
                    <label key={choice}><input name={question.id} type="radio" checked={checks[question.id] === index} onChange={() => setChecks((current) => ({ ...current, [question.id]: index }))} required /> {choice}</label>
                  ))}
                </div>
              </fieldset>
            ))}
            <button type="submit" className="pwd-save pwd-study-primary" disabled={busy || questions.length === 0 || Object.keys(checks).length !== questions.length}><ClipboardCheck size={17} aria-hidden="true" /> Submit assessment</button>
          </form>
        )}
        {state.state === "practice" && (
          <div className="pwd-study-note"><h3>Practice in the arcade</h3><p>All study games are available during practice. Your final assessment opens on {nextDate ? new Date(nextDate).toLocaleString() : "the scheduled date"}.</p>{onPlay && <button type="button" className="pwd-save pwd-study-primary" onClick={onPlay}>Go to Games <ArrowRight size={16} aria-hidden="true" /></button>}<button type="button" className="pwd-save" onClick={reload}>Check status</button></div>
        )}
        {state.state === "completed" && state.surveyDue && <StudySurvey respondent="student" onSubmitted={reload} />}
        {state.state === "completed" && !state.surveyDue && (
          <p className="pwd-study-note">
            Your assessments are saved. Thank you for taking part.
            {state.delayedAt && new Date(state.delayedAt) > new Date() && <> A short follow-up assessment opens on {new Date(state.delayedAt).toLocaleString()}.</>}
          </p>
        )}
        {state.state === "closed" && <p className="pwd-study-note">The study window has ended.</p>}
        {state.canWithdraw && (
          <details>
            <summary>Leave the study</summary>
            <p>Your data will be excluded from future study exports. You can still use your arcade account.</p>
            <button type="button" className="pwd-save pwd-study-withdraw" disabled={busy} onClick={() => void change("study/withdraw", {}, "We couldn’t record your withdrawal. Try again or contact your study coordinator.")}>Confirm withdrawal</button>
          </details>
        )}
        {error && <p role="alert" className="pwd-feedback">{error}</p>}
      </div>
    </>
  );
}
