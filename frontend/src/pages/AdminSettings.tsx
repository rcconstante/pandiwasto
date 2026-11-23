import { useState, type FormEvent } from "react";
import { Pencil, Sparkles } from "lucide-react";
import { DASHBOARD_LESSONS } from "@/data/dashboardLessons";
import { checkHintProvider, loadResearchSettings, loadSkills, updateResearchSettings, updateSkill, type SkillParameters } from "@/lib/arcadeApi";
import { formValue, useAdminAction, useRemote } from "./adminActions";
import { LoadState, Modal, Notice, PageHeader, SkeletonTable } from "./StaffKit";

const skillName = (id: string) => DASHBOARD_LESSONS.find((lesson) => lesson.id === id)?.title ?? id;
const fixed = (value: number) => value.toFixed(2);

const FIELDS = [
  { name: "initial", label: "P(L0) prior", hint: "Used when a learner has no pretest subscore. 0.01–0.99.", min: 0.01, max: 0.99 },
  { name: "learn", label: "P(T) learning", hint: "Chance of learning after each answer. 0–0.99.", min: 0, max: 0.99 },
  { name: "guess", label: "P(G) guess", hint: "The game's chance level, for example 0.25 for four options.", min: 0.01, max: 0.99 },
  { name: "slip", label: "P(S) slip", hint: "Keep below 0.30 to avoid degenerate fits.", min: 0.01, max: 0.49 },
  { name: "masteryThreshold", label: "Mastery threshold", hint: "0.95 is the classic value.", min: 0.51, max: 1 },
] as const;

/** Sends one fixed sample request to the hint provider and shows the result or the exact error. */
function HintCheck() {
  const { busy, message, run } = useAdminAction();
  return (
    <section className="st-card">
      <div className="st-card-head">
        <div>
          <h2 className="st-card-title">AI hints</h2>
          <p className="st-muted">Sends one sample hint request to Gemini. No learner data is sent.</p>
        </div>
        <button type="button" className="st-button" disabled={busy} onClick={() => void run(async () => {
          const result = await checkHintProvider();
          if (!result.configured) throw new Error(result.error);
          if (!result.ok) throw new Error(`${result.model}: ${result.error}`);
          return `${result.model} answered in ${((result.latencyMs ?? 0) / 1000).toFixed(1)} s: “${result.text}”`;
        }, (error) => error instanceof Error && error.message ? error.message : "The check could not run.")}>
          <Sparkles size={16} aria-hidden="true" /> {busy ? "Testing…" : "Test AI hints"}
        </button>
      </div>
      {message && <div className="st-card-notice"><Notice message={message} /></div>}
    </section>
  );
}

function ScoringRules() {
  const settings = useRemote(loadResearchSettings, "research-settings");
  const { busy, message, run } = useAdminAction();
  const toggle = (timeoutAsWrong: boolean) => void run(async () => {
    await updateResearchSettings(timeoutAsWrong);
    settings.reload();
    return timeoutAsWrong ? "Timed-out answers now count as wrong for mastery." : "Timed-out answers no longer change mastery.";
  }, "Couldn’t save the setting.");
  return (
    <section className="st-card">
      <h2 className="st-card-title">Mastery scoring</h2>
      <p className="st-muted">First attempts update mastery, including hinted ones (they are flagged for analysis). Choose how a Whack-a-Word timeout counts.</p>
      {settings.state.status !== "ready" ? <LoadState status={settings.state.status} what="scoring settings" onRetry={settings.reload} /> : (
        <label className="st-check">
          <input type="checkbox" checked={settings.state.data.timeoutAsWrong} disabled={busy || settings.state.refreshing} onChange={(event) => toggle(event.target.checked)} />
          Count timeouts as wrong answers
        </label>
      )}
      {message && <div className="st-card-notice"><Notice message={message} /></div>}
    </section>
  );
}

export function AdminSettings() {
  const [editing, setEditing] = useState<SkillParameters | null>(null);
  const skills = useRemote(loadSkills, "skills");
  const { busy, message, setMessage, run } = useAdminAction();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const fields = new FormData(event.currentTarget);
    const number = (name: string) => Number(formValue(fields, name));
    const done = await run(async () => {
      const { paramVersion } = await updateSkill({
        skillId: editing.skillId, initial: number("initial"), learn: number("learn"), guess: number("guess"),
        slip: number("slip"), masteryThreshold: number("masteryThreshold"),
      });
      skills.reload();
      return `${skillName(editing.skillId)} now uses parameter version ${paramVersion}. Earlier answers keep the version they were scored with.`;
    }, "Couldn’t save the parameters. Check that each value is in its range.");
    if (done) setEditing(null);
  }

  return (
    <>
      <PageHeader title="Settings" description="BKT parameters, mastery scoring, hint policy, and the AI hint provider." />
      {editing === null && <Notice message={message} />}

      <section className="st-card">
        <div className="st-card-head st-card-head-gap">
          <div>
            <h2 className="st-card-title">BKT parameters</h2>
            <p className="st-muted">Change these after fitting pilot data (scripts/fit-bkt.ts). Every change creates a new version for the research export.</p>
          </div>
        </div>
        {skills.state.status !== "ready" ? <LoadState status={skills.state.status} what="BKT parameters" onRetry={skills.reload} skeleton={<SkeletonTable rows={6} cols={7} />} /> : (
          <div className="st-table-wrap">
            <table className="st-table">
              <thead>
                <tr><th scope="col">Skill</th><th scope="col">P(L0)</th><th scope="col">P(T)</th><th scope="col">P(G)</th><th scope="col">P(S)</th><th scope="col">Mastery</th><th scope="col">Version</th><th scope="col"><span className="sr-only">Edit</span></th></tr>
              </thead>
              <tbody>
                {skills.state.data.skills.map((skill) => (
                  <tr key={skill.skillId}>
                    <th scope="row"><strong>{skillName(skill.skillId)}</strong></th>
                    <td>{fixed(skill.initial)}</td><td>{fixed(skill.learn)}</td>
                    <td>{fixed(skill.guess)}{skill.guess >= 0.3 && <span className="st-badge st-badge-warning" title="Chance level of a game with few options">high</span>}</td>
                    <td>{fixed(skill.slip)}</td><td>{fixed(skill.masteryThreshold)}</td>
                    <td><span className="st-badge">v{skill.paramVersion}</span></td>
                    <td className="st-cell-actions">
                      <button type="button" className="st-button st-button-small" onClick={() => { setMessage(null); setEditing(skill); }}><Pencil size={14} aria-hidden="true" /> Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="st-grid-3">
        <section className="st-card">
          <h2 className="st-card-title">Hint policy</h2>
          <ul className="st-policy">
            <li><strong>Group A</strong> A hint after a wrong answer when mastery is below the study’s threshold (default 0.70), or has stalled below mastery over the study’s window (default three updates). Set both per study.</li>
            <li><strong>Group B</strong> A hint after two misses in a row on the same skill.</li>
            <li><strong>Group C</strong> No hints.</li>
            <li><strong>All groups</strong> At most four hints per run. Levels 1–2 are AI-rephrased from reviewed text; level 3 is the lesson example.</li>
          </ul>
        </section>
        <ScoringRules />
        <HintCheck />
      </div>

      <Modal open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}
        title={editing ? `Edit ${skillName(editing.skillId)}` : "Edit skill"} description="Saving creates a new parameter version for this skill.">
        {editing && (
          <form key={editing.skillId} className="st-form st-form-grid" onSubmit={(event) => void save(event)}>
            {message?.error && <div className="st-span"><Notice message={message} /></div>}
            {FIELDS.map(({ name, label, hint, min, max }) => (
              <label key={name}>{label}
                <input name={name} type="number" required step="any" min={min} max={max} defaultValue={editing[name]} />
                <small>{hint}</small>
              </label>
            ))}
            <div className="st-modal-actions st-span">
              <button type="button" className="st-button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="st-button st-button-primary" disabled={busy}>Save new version</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
