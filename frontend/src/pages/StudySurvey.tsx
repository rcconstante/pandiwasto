import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { submitSurvey } from "@/lib/arcadeApi";
import { STUDENT_SURVEY, SURVEY_SCALE, TEACHER_SURVEY } from "@/data/surveyItems";

/** 1–5 agreement survey; students answer in Filipino, teachers in English. */
export function StudySurvey({ respondent, onSubmitted }: { respondent: "student" | "teacher"; onSubmitted: () => void }) {
  const items = respondent === "student" ? STUDENT_SURVEY : TEACHER_SURVEY;
  const scale = SURVEY_SCALE[respondent];
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const student = respondent === "student";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await submitSurvey(answers, comment);
      onSubmitted();
    } catch {
      setError(student ? "Hindi na-save ang sagot. Subukan muli." : "Your answers could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pwd-study-form" onSubmit={(event) => void submit(event)} lang={student ? "fil" : "en"}>
      <h3>{student ? "Maikling tanong tungkol sa app" : "Feedback on PandiWasto"}</h3>
      <p>{student ? "Pumili ng isang sagot sa bawat pahayag." : "Choose one answer for each statement. This takes about a minute."}</p>
      {items.map((item, itemIndex) => (
        <fieldset key={item.id} className="pwd-study-note" disabled={busy}>
          <legend>{itemIndex + 1}. {item.prompt}</legend>
          <div className="pwd-study-choices">
            {scale.map((label, index) => (
              <label key={label}><input name={item.id} type="radio" checked={answers[item.id] === index + 1} onChange={() => setAnswers((current) => ({ ...current, [item.id]: index + 1 }))} required /> {label}</label>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="pwd-study-note pwd-study-comment">
        <span>{student ? "May gusto ka pang sabihin? (opsiyonal)" : "Anything else? (optional)"}</span>
        <textarea value={comment} maxLength={1000} rows={3} disabled={busy} onChange={(event) => setComment(event.target.value)} />
      </label>
      <button type="submit" className="pwd-save pwd-study-primary" disabled={busy || Object.keys(answers).length !== items.length}><Send size={16} aria-hidden="true" /> {student ? "Ipadala" : "Send feedback"}</button>
      {error && <p role="alert" className="pwd-feedback">{error}</p>}
    </form>
  );
}
