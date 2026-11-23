import { useState, type FormEvent } from "react";
import { Activity, ArrowRight, Download, Eye, EyeOff, FilePlus2, FlaskConical, Settings2, GraduationCap, Plus, Search, Sparkles, Trophy, UserCheck, UserPlus, Users } from "lucide-react";
import { DASHBOARD_LESSONS } from "@/data/dashboardLessons";
import { MINIGAMES } from "@/data/landingData";
import { ArcadeSelect } from "@/components/ui/ArcadeSelect";
import { arcadeRequest, loadAdminStatus, loadClasses, saveStudyOptions } from "@/lib/arcadeApi";
import { formValue, useAdminAction, useRemote } from "./adminActions";
import { downloadFile } from "./downloadFile";
import { LoadState, Modal, Notice, PageHeader, SkeletonStats } from "./StaffKit";

interface Score {
  accountId: string;
  alias: string;
  score: number;
  hidden: boolean;
  gameId: number;
}

interface Cohort {
  id: string;
  title: string;
  protocol: string;
  opensAt: string;
  posttestAt: string;
  closesAt: string;
  delayedAt?: string | null;
  hintThreshold?: number;
  stallWindow?: number;
  assignByClass?: boolean;
  surveys?: number;
  preCount: number;
  postCount: number;
  participants: number;
  sealed: boolean;
}

type Dataset = "assessment" | "attempt" | "hint" | "parameter" | "survey";
const DATASETS: { value: Dataset; label: string }[] = [
  { value: "assessment", label: "Assessment results (with per-skill subscores)" }, { value: "attempt", label: "Game attempts" },
  { value: "hint", label: "Hints shown" }, { value: "parameter", label: "BKT parameter versions" },
  { value: "survey", label: "Usability survey responses" },
];
const day = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function isoDate(form: FormData, field: string) {
  return new Date(formValue(form, field)).toISOString();
}

// datetime-local needs local time without a zone.
function localInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function loadOverview(signal: AbortSignal) {
  const [status, roster] = await Promise.all([loadAdminStatus(signal), loadClasses(signal)]);
  return [
    { label: "Confirmed players", value: status.players, icon: Users },
    { label: "Completed game runs", value: status.completedRuns, icon: Activity },
    { label: "Published best scores", value: status.publishedScores, icon: Trophy },
    { label: "Classes", value: roster.classes.length, icon: GraduationCap },
    { label: "Teachers", value: roster.teachers.length, icon: UserCheck },
    { label: "Students in classes", value: roster.classes.reduce((total, entry) => total + entry.students, 0), icon: Users },
    // Zero AI hints with GEMINI_API_KEY set means every hint fell back to authored text.
    { label: "Hints written by AI", value: `${(status.aiHints ?? 0).toLocaleString()} of ${(status.hints ?? 0).toLocaleString()}`, icon: Sparkles },
  ];
}

export function AdminOverview({ onOpen }: { onOpen: (section: "accounts" | "classes" | "progress" | "study" | "settings") => void }) {
  const overview = useRemote(loadOverview, "overview");
  const shortcuts = [
    { section: "accounts" as const, title: "Create accounts", text: "Add students and teachers, and set roles.", icon: UserPlus },
    { section: "classes" as const, title: "Set up classes", text: "Assign a teacher and add students.", icon: GraduationCap },
    { section: "progress" as const, title: "Review progress", text: "See BKT mastery for each class.", icon: Activity },
    { section: "study" as const, title: "Run the study", text: "Cohorts, assessments, and exports.", icon: FlaskConical },
    { section: "settings" as const, title: "Tune BKT and hints", text: "Parameters, hint policy, AI check.", icon: Sparkles },
  ];
  return (
    <>
      <PageHeader title="Overview" description="Players, game activity, classes, and teachers at a glance." />
      {overview.state.status !== "ready" ? <LoadState status={overview.state.status} what="the overview" onRetry={overview.reload} skeleton={<SkeletonStats count={7} />} /> : (
        <dl className="st-stats">
          {overview.state.data.map(({ label, value, icon: Icon }) => (
            <div key={label}><dt><span className="st-stat-icon"><Icon size={17} aria-hidden="true" /></span>{label}</dt><dd>{value.toLocaleString()}</dd></div>
          ))}
        </dl>
      )}
      <h2 className="st-section-title">Quick actions</h2>
      <div className="st-shortcuts">
        {shortcuts.map(({ section, title, text, icon: Icon }) => (
          <button key={section} type="button" className="st-shortcut" onClick={() => onOpen(section)}>
            <span className="st-list-icon"><Icon size={18} aria-hidden="true" /></span>
            <span><strong>{title}</strong><small>{text}</small></span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  );
}

export function AdminScores() {
  const [result, setResult] = useState<Score | null>(null);
  const { busy, message, run } = useAdminAction();

  function lookupScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const gameId = Number(formValue(form, "gameId"));
    setResult(null);
    void run(async () => {
      const response = await arcadeRequest<Omit<Score, "gameId">>("admin/scores/lookup", { gameId, lookup: formValue(form, "lookup") });
      setResult({ ...response, gameId });
      return "Score found.";
    }, "Couldn’t find a score for that game and player.");
  }

  function moderateScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result) return;
    const form = event.currentTarget;
    const reason = formValue(new FormData(form), "reason");
    const hidden = !result.hidden;
    void run(async () => {
      const response = await arcadeRequest<{ hidden: boolean }>("admin/scores/moderate", {
        gameId: result.gameId, targetAccountId: result.accountId, hidden, reason,
      });
      setResult({ ...result, hidden: response.hidden });
      form.reset();
      return response.hidden ? "Score hidden from Rankings. Reason recorded." : "Score restored to Rankings. Reason recorded.";
    }, "Couldn’t update the ranking entry. Check admin access and try again.");
  }

  return (
    <>
      <Notice message={message} />
      <section className="st-card" aria-labelledby="st-moderation">
        <h2 id="st-moderation" className="st-card-title">Moderate a score</h2>
        <p className="st-muted st-card-intro">Find a player's best score and hide or restore it in Rankings. Every change records a reason.</p>
        <form className="st-inline-form st-inline-form-3" onSubmit={lookupScore}>
          <ArcadeSelect className="st-select" label="Game" hideLabel name="gameId" defaultValue={String(MINIGAMES[0].id)} options={MINIGAMES.map(({ id, gameName }) => ({ value: String(id), label: gameName }))} />
          <label><span className="sr-only">Player alias or account ID</span><input name="lookup" required maxLength={64} autoComplete="off" placeholder="Player alias (Player 012345ABCD) or account ID" /></label>
          <button className="st-button st-button-primary" disabled={busy}><Search size={16} aria-hidden="true" /> Find score</button>
        </form>
        {result && (
          <form className="st-form st-result" onSubmit={moderateScore}>
            <div className="st-card-head">
              <div><h2>{result.alias}</h2><p>{MINIGAMES.find((game) => game.id === result.gameId)?.gameName} · {result.score.toLocaleString()} points</p></div>
              <span className={result.hidden ? "st-badge st-badge-danger" : "st-badge st-badge-success"}>{result.hidden ? "Hidden" : "Published"}</span>
            </div>
            <label>Reason<textarea name="reason" required maxLength={300} rows={2} placeholder="Why this score is being changed" /></label>
            <button className={result.hidden ? "st-button st-button-primary" : "st-button st-button-danger"} disabled={busy}>
              {result.hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{result.hidden ? "Restore score" : "Hide score"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}

type StudyDialog = "cohort" | "question" | "invite" | "options" | null;

export function AdminStudy() {
  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<StudyDialog>(null);
  const [dataset, setDataset] = useState<Dataset>("assessment");
  const [page, setPage] = useState(0);
  const { busy, message, setMessage, run } = useAdminAction();
  const cohorts = useRemote((signal) => arcadeRequest<{ cohorts: Cohort[] }>("admin/study", undefined, signal), "cohorts");
  const list = cohorts.state.status === "ready" ? cohorts.state.data.cohorts : [];
  const cohort = list.find((entry) => entry.id === selectedId) ?? list[0];

  function openDialog(next: StudyDialog) {
    setMessage(null);
    setDialog(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>, action: (fields: FormData) => Promise<string>, failure: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (await run(() => action(fields), failure)) setDialog(null);
  }

  const createCohort = (fields: FormData) => arcadeRequest<{ cohortId: string }>("admin/study/create", {
    title: formValue(fields, "title"), protocol: formValue(fields, "protocol"), approvalReference: formValue(fields, "approval"),
    information: formValue(fields, "information"), opensAt: isoDate(fields, "opens"), posttestAt: isoDate(fields, "post"), closesAt: isoDate(fields, "closes"),
  }).then((response) => {
    setSelectedId(response.cohortId);
    cohorts.reload();
    return "Cohort created. Add reviewed questions and invite approved participants.";
  });

  const addQuestion = (fields: FormData) => arcadeRequest("admin/study/question", {
    cohortId: cohort!.id, phase: formValue(fields, "phase"), skillId: formValue(fields, "skill"), prompt: formValue(fields, "prompt"),
    choices: ["choice1", "choice2", "choice3"].map((field) => formValue(fields, field)), answer: Number(formValue(fields, "answer")),
  }).then(() => { cohorts.reload(); return "Assessment question added."; });

  const invite = (fields: FormData) => arcadeRequest("admin/study/participant", {
    cohortId: cohort!.id, lookup: formValue(fields, "participant"), consentKind: formValue(fields, "consent"), verified: fields.get("verified") === "on",
  }).then(() => { cohorts.reload(); return "Invitation saved. The player must still agree in their Study tab."; });

  const saveOptions = (fields: FormData) => saveStudyOptions({
    cohortId: cohort!.id, hintThreshold: Number(formValue(fields, "threshold")) / 100, stallWindow: Number(formValue(fields, "stall")),
    assignByClass: fields.get("byClass") === "on", delayedAt: formValue(fields, "delayed") ? isoDate(fields, "delayed") : null,
  }).then(() => { cohorts.reload(); return "Study options saved."; });

  function exportPage() {
    if (!cohort) return;
    void run(async () => {
      const response = await arcadeRequest<{ records: Record<string, unknown>[]; hasMore: boolean }>("admin/study/export", { cohortId: cohort.id, dataset, page });
      downloadFile("pandiwasto-" + dataset + "-page-" + (page + 1) + ".json", JSON.stringify({
        protocol: cohort.protocol, cohortId: cohort.id, dataset, page, ...response,
      }, null, 2), "application/json");
      return response.records.length + " " + dataset + " records exported." + (response.hasMore ? " Continue to the next page for more." : "");
    }, "Couldn’t export the dataset.");
  }

  const dialogNotice = message?.error && <Notice message={message} />;
  const actions = (cancelLabel: string) => (
    <div className="st-modal-actions st-span">
      <button type="button" className="st-button" onClick={() => setDialog(null)}>Cancel</button>
      <button className="st-button st-button-primary" disabled={busy}>{cancelLabel}</button>
    </div>
  );

  return (
    <>
      <PageHeader title="Study" description="Cohorts, parallel assessments, invitations, and pseudonymized research exports."
        actions={(
          <>
            {list.length > 0 && (
              <ArcadeSelect className="st-select st-select-header" label="Cohort" hideLabel value={cohort?.id}
                onValueChange={(value) => { setSelectedId(value); setPage(0); }} options={list.map((entry) => ({ value: entry.id, label: entry.title }))} />
            )}
            <button type="button" className="st-button st-button-primary" onClick={() => openDialog("cohort")}><Plus size={17} aria-hidden="true" /> New cohort</button>
          </>
        )} />
      {dialog === null && <Notice message={message} />}

      {cohorts.state.status !== "ready" ? <LoadState status={cohorts.state.status} what="study cohorts" onRetry={cohorts.reload} skeleton={<SkeletonStats count={4} />} />
        : !cohort ? <section className="st-card"><p className="st-empty">No cohorts yet. Create one to set up assessments and invite participants.</p></section> : (
          <>
            <dl className="st-stats">
              <div><dt>Protocol</dt><dd className="st-stat-text">{cohort.protocol}</dd></div>
              <div><dt>Pre-assessment opens</dt><dd className="st-stat-text">{day(cohort.opensAt)}</dd></div>
              <div><dt>Post-assessment opens</dt><dd className="st-stat-text">{day(cohort.posttestAt)}</dd></div>
              {cohort.delayedAt && <div><dt>Follow-up assessment opens</dt><dd className="st-stat-text">{day(cohort.delayedAt)}</dd></div>}
              <div><dt>Closes</dt><dd className="st-stat-text">{day(cohort.closesAt)}</dd></div>
            </dl>
            <div className="st-grid-3">
              <section className="st-card">
                <h2 className="st-card-title">Assessments</h2>
                <p className="st-muted">{cohort.preCount} pre-assessment · {cohort.postCount} post-assessment items</p>
                {cohort.sealed ? <span className="st-badge">Sealed after the first assent</span>
                  : <button type="button" className="st-button" onClick={() => openDialog("question")}><FilePlus2 size={16} aria-hidden="true" /> Add question</button>}
              </section>
              <section className="st-card">
                <h2 className="st-card-title">Participants</h2>
                <p className="st-muted">{cohort.participants} invited and not withdrawn</p>
                <button type="button" className="st-button" onClick={() => openDialog("invite")}><UserPlus size={16} aria-hidden="true" /> Invite participant</button>
              </section>
              <section className="st-card">
                <h2 className="st-card-title">Hint rules and assignment</h2>
                <p className="st-muted">
                  Group A hints below {Math.round((cohort.hintThreshold ?? 0.7) * 100)}% mastery or after {cohort.stallWindow ?? 3} answers without progress
                  · {cohort.assignByClass ? "whole classes share a group" : "each student is assigned on their own"}
                  · {cohort.surveys ?? 0} survey responses
                </p>
                <button type="button" className="st-button" onClick={() => openDialog("options")}><Settings2 size={16} aria-hidden="true" /> Edit options</button>
              </section>
              <section className="st-card">
                <h2 className="st-card-title">Export</h2>
                <div className="st-form">
                  <ArcadeSelect className="st-select" label="Dataset" value={dataset} options={DATASETS}
                    onValueChange={(value) => { setDataset(DATASETS.find((entry) => entry.value === value)?.value ?? "assessment"); setPage(0); }} />
                  <label>Page<input type="number" value={page + 1} min={1} max={10001} onChange={(event) => setPage(Math.max(0, Number(event.target.value) - 1))} /></label>
                  <button type="button" className="st-button" disabled={busy} onClick={exportPage}><Download size={16} aria-hidden="true" /> Download JSON</button>
                </div>
              </section>
            </div>
          </>
        )}

      <Modal open={dialog === "cohort"} onOpenChange={(open) => setDialog(open ? "cohort" : null)} title="New study cohort" description="Dates must run in order: pre-assessment, post-assessment, close.">
        <form className="st-form st-form-grid" onSubmit={(event) => void submit(event, createCohort, "Couldn’t create the cohort. Check the approval information and date order.")}>
          {dialogNotice && <div className="st-span">{dialogNotice}</div>}
          <label className="st-span">Study title<input name="title" required maxLength={100} /></label>
          <label>Protocol version<input name="protocol" required maxLength={60} /></label>
          <label>Approval reference<input name="approval" required maxLength={120} /></label>
          <label>Pre-assessment opens<input type="datetime-local" name="opens" required /></label>
          <label>Post-assessment opens<input type="datetime-local" name="post" required /></label>
          <label>Study closes<input type="datetime-local" name="closes" required /></label>
          <label className="st-span">Participant information<textarea name="information" required maxLength={1200} rows={4} /></label>
          {actions("Create cohort")}
        </form>
      </Modal>

      <Modal open={dialog === "question"} onOpenChange={(open) => setDialog(open ? "question" : null)} title="Add an assessment question" description="Pre- and post-assessments need the same number of items per skill.">
        <form className="st-form st-form-grid" onSubmit={(event) => void submit(event, addQuestion, "Couldn’t add the question. Confirm the form is open and the prompt and choices are distinct.")}>
          {dialogNotice && <div className="st-span">{dialogNotice}</div>}
          <ArcadeSelect className="st-select" label="Form" name="phase" defaultValue="pre" options={[{ value: "pre", label: "Pre-assessment" }, { value: "post", label: "Post-assessment" }]} />
          <ArcadeSelect className="st-select" label="Skill" name="skill" defaultValue={DASHBOARD_LESSONS[0].id} options={DASHBOARD_LESSONS.map(({ id, title }) => ({ value: id, label: title }))} />
          <label className="st-span">Question<textarea name="prompt" required maxLength={300} rows={2} /></label>
          {[1, 2, 3].map((index) => <label key={index}>Choice {index}<input name={"choice" + index} required maxLength={120} /></label>)}
          <ArcadeSelect className="st-select" label="Correct choice" name="answer" defaultValue="0" options={[0, 1, 2].map((index) => ({ value: String(index), label: `Choice ${index + 1}` }))} />
          {actions("Add question")}
        </form>
      </Modal>

      <Modal open={dialog === "options"} onOpenChange={(open) => setDialog(open ? "options" : null)} title="Study options"
        description={cohort?.sealed ? "Hint rules and assignment are locked after the first assent. You can still set the follow-up date." : "Hint rules and assignment lock after the first assent."}>
        {cohort && (
          <form className="st-form st-form-grid" onSubmit={(event) => void submit(event, saveOptions, "Couldn’t save the options. The follow-up date must fall between the post-assessment and the close date.")}>
            {dialogNotice && <div className="st-span">{dialogNotice}</div>}
            <label>Group A mastery threshold (%)<input type="number" name="threshold" min={5} max={95} step={1} required disabled={cohort.sealed} defaultValue={Math.round((cohort.hintThreshold ?? 0.7) * 100)} /></label>
            <label>Stall window (answers)<input type="number" name="stall" min={2} max={10} step={1} required disabled={cohort.sealed} defaultValue={cohort.stallWindow ?? 3} /></label>
            <label className="st-check st-span"><input type="checkbox" name="byClass" disabled={cohort.sealed} defaultChecked={cohort.assignByClass ?? false} /> Assign whole classes to the same group</label>
            <label className="st-span">Follow-up (delayed) assessment opens — optional<input type="datetime-local" name="delayed" defaultValue={localInput(cohort.delayedAt)} /></label>
            {cohort.sealed && <>
              <input type="hidden" name="threshold" value={Math.round((cohort.hintThreshold ?? 0.7) * 100)} />
              <input type="hidden" name="stall" value={cohort.stallWindow ?? 3} />
              {cohort.assignByClass && <input type="hidden" name="byClass" value="on" />}
            </>}
            {actions("Save options")}
          </form>
        )}
      </Modal>

      <Modal open={dialog === "invite"} onOpenChange={(open) => setDialog(open ? "invite" : null)} title="Invite a participant" description="The player must still agree in their Study tab.">
        <form className="st-form" onSubmit={(event) => void submit(event, invite, "Couldn’t invite that player. Check the confirmed account and study dates.")}>
          {dialogNotice}
          <label>Player alias or account ID<input name="participant" required maxLength={64} autoComplete="off" /></label>
          <ArcadeSelect className="st-select" label="External consent verified" name="consent" defaultValue="guardian" options={[{ value: "guardian", label: "Parent or guardian" }, { value: "adult", label: "Adult participant" }]} />
          <label className="st-check"><input type="checkbox" name="verified" required /> I verified this consent outside the app.</label>
          {actions("Invite player")}
        </form>
      </Modal>
    </>
  );
}
