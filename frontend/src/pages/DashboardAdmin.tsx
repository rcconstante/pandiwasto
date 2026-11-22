import { useEffect, useState, type FormEvent } from "react";
import { Download, Eye, EyeOff, Search } from "lucide-react";
import { MINIGAMES } from "@/data/landingData";
import { arcadeRequest, loadAdminStatus } from "@/lib/arcadeApi";
import "./dashboard-research.css";

interface AdminStatus {
  players: number;
  completedRuns: number;
  publishedScores: number;
}

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
  preCount: number;
  postCount: number;
  participants: number;
  sealed: boolean;
}

const SKILLS = [
  ["salitang-ugat", "Salitang-Ugat"], ["kayarian-ng-salita", "Kayarian ng Salita"], ["unlapi", "Unlapi"],
  ["gitlapi", "Gitlapi"], ["hulapi", "Hulapi"], ["kabilaan", "Kabilaan"], ["tambalan", "Tambalan"],
  ["pag-uulit", "Pag-uulit"], ["pokus-ng-pandiwa", "Pokus ng Pandiwa"], ["asimilasyon", "Asimilasyon"],
];

function value(form: FormData, field: string) {
  return String(form.get(field) ?? "").trim();
}

function isoDate(form: FormData, field: string) {
  return new Date(value(form, field)).toISOString();
}

function downloadResearchData(name: string, data: object) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DashboardAdmin({ summary }: { summary: AdminStatus }) {
  const [counts, setCounts] = useState(summary);
  const [result, setResult] = useState<Score | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [dataset, setDataset] = useState<"assessment" | "attempt">("assessment");
  const [page, setPage] = useState(0);
  const cohort = cohorts.find((entry) => entry.id === selectedId);

  useEffect(() => {
    const controller = new AbortController();
    arcadeRequest<{ cohorts: Cohort[] }>("admin/study", undefined, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setCohorts(response.cohorts); })
      .catch(() => { if (!controller.signal.aborted) setMessage({ text: "Study cohorts could not load.", error: true }); });
    return () => controller.abort();
  }, [refresh]);

  async function runAction(action: () => Promise<string>, failure: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ text: await action() });
    } catch {
      setMessage({ text: failure, error: true });
    } finally {
      setBusy(false);
    }
  }

  function lookupScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const gameId = Number(value(form, "gameId"));
    setResult(null);
    void runAction(async () => {
      const response = await arcadeRequest<Omit<Score, "gameId">>("admin/scores/lookup", { gameId, lookup: value(form, "lookup") });
      setResult({ ...response, gameId });
      return "Score found.";
    }, "Couldn’t find a score for that game and player.");
  }

  function moderateScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result) return;
    const form = event.currentTarget;
    const reason = value(new FormData(form), "reason");
    const hidden = !result.hidden;
    void runAction(async () => {
      const response = await arcadeRequest<{ hidden: boolean }>("admin/scores/moderate", {
        gameId: result.gameId, targetAccountId: result.accountId, hidden, reason,
      });
      setResult({ ...result, hidden: response.hidden });
      form.reset();
      loadAdminStatus().then(setCounts).catch(() => {});
      return response.hidden ? "Score hidden from Rankings. Reason recorded." : "Score restored to Rankings. Reason recorded.";
    }, "Couldn’t update the ranking entry. Check admin access and try again.");
  }

  function createCohort(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void runAction(async () => {
      const response = await arcadeRequest<{ cohortId: string }>("admin/study/create", {
        title: value(fields, "title"), protocol: value(fields, "protocol"), approvalReference: value(fields, "approval"),
        information: value(fields, "information"), opensAt: isoDate(fields, "opens"), posttestAt: isoDate(fields, "post"), closesAt: isoDate(fields, "closes"),
      });
      setSelectedId(response.cohortId);
      setPage(0);
      setRefresh((current) => current + 1);
      form.reset();
      return "Cohort created. Add reviewed questions and invite approved participants.";
    }, "Couldn’t create the cohort. Check the approval information and date order.");
  }

  function addQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cohort) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    void runAction(async () => {
      await arcadeRequest("admin/study/question", {
        cohortId: cohort.id, phase: value(fields, "phase"), skillId: value(fields, "skill"), prompt: value(fields, "prompt"),
        choices: ["choice1", "choice2", "choice3"].map((field) => value(fields, field)), answer: Number(value(fields, "answer")),
      });
      setRefresh((current) => current + 1);
      form.reset();
      return "Assessment question added.";
    }, "Couldn’t add the question. Confirm the form is open and the prompt and choices are distinct.");
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cohort) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    void runAction(async () => {
      await arcadeRequest("admin/study/participant", {
        cohortId: cohort.id, lookup: value(fields, "participant"), consentKind: value(fields, "consent"), verified: fields.get("verified") === "on",
      });
      setRefresh((current) => current + 1);
      form.reset();
      return "Invitation saved. The player must still agree in their Study tab.";
    }, "Couldn’t invite that player. Check the confirmed account and study dates.");
  }

  function exportPage() {
    if (!cohort) return;
    void runAction(async () => {
      const response = await arcadeRequest<{ records: Record<string, unknown>[]; hasMore: boolean }>("admin/study/export", { cohortId: cohort.id, dataset, page });
      downloadResearchData("pandiwasto-" + dataset + "-page-" + (page + 1) + ".json", {
        protocol: cohort.protocol, cohortId: cohort.id, dataset, page, ...response,
      });
      return response.records.length + " " + dataset + " records exported." + (response.hasMore ? " Continue to the next page for more." : "");
    }, "Couldn’t export the dataset.");
  }

  return (
    <>
      <h2>Arcade administration</h2>
      <dl className="pwd-admin-stats">
        <div><dt>Confirmed players</dt><dd>{counts.players.toLocaleString()}</dd></div>
        <div><dt>Completed account runs</dt><dd>{counts.completedRuns.toLocaleString()}</dd></div>
        <div><dt>Published best scores</dt><dd>{counts.publishedScores.toLocaleString()}</dd></div>
      </dl>

      <div className="pwd-admin-columns">
        <section className="pwd-admin-panel" aria-labelledby="pwd-moderation-heading">
          <h3 id="pwd-moderation-heading">Moderate a leaderboard score</h3>
          <form className="pwd-study-form" onSubmit={lookupScore}>
            <label>Game<select name="gameId">{MINIGAMES.map(({ id, gameName }) => <option key={id} value={id}>{gameName}</option>)}</select></label>
            <label>Player alias or account ID<input name="lookup" required maxLength={64} autoComplete="off" placeholder="Player 012345ABCD" /></label>
            <button className="pwd-save" disabled={busy}><Search size={16} aria-hidden="true" /> Find score</button>
          </form>
          {result && (
            <form className="pwd-study-form pwd-study-note" onSubmit={moderateScore}>
              <p><strong>{result.alias}</strong> · {result.score.toLocaleString()} pts · {result.hidden ? "Hidden" : "Published"}</p>
              <label>Reason<textarea name="reason" required maxLength={300} rows={2} /></label>
              <button className="pwd-save" disabled={busy}>{result.hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{result.hidden ? "Restore score" : "Hide score"}</button>
            </form>
          )}
        </section>

        <section className="pwd-admin-panel" aria-labelledby="pwd-cohort-heading">
          <h3 id="pwd-cohort-heading">Study cohorts</h3>
          <details>
            <summary>Create a cohort</summary>
            <form className="pwd-study-form" onSubmit={createCohort}>
              <label>Study title<input name="title" required maxLength={100} /></label>
              <label>Protocol version<input name="protocol" required maxLength={60} /></label>
              <label>Approval reference<input name="approval" required maxLength={120} /></label>
              <label>Participant information<textarea name="information" required maxLength={1200} rows={4} /></label>
              <label>Pre-assessment opens<input type="datetime-local" name="opens" required /></label>
              <label>Post-assessment opens<input type="datetime-local" name="post" required /></label>
              <label>Study closes<input type="datetime-local" name="closes" required /></label>
              <button className="pwd-save" disabled={busy}>Create cohort</button>
            </form>
          </details>
          <label className="pwd-study-cohort-label">Manage a cohort<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setPage(0); }}>
            <option value="">Choose a cohort</option>
            {cohorts.map((entry) => <option value={entry.id} key={entry.id}>{entry.title}</option>)}
          </select></label>
          {cohort && (
            <>
              <p>{cohort.preCount} pre-assessment items · {cohort.postCount} post-assessment items · {cohort.participants} invited</p>
              {cohort.sealed ? <p>Assessment forms are sealed.</p> : (
                <details>
                  <summary>Add reviewed assessment items</summary>
                  <form className="pwd-study-form" onSubmit={addQuestion}>
                    <label>Form<select name="phase"><option value="pre">Pre-assessment</option><option value="post">Post-assessment</option></select></label>
                    <label>Skill<select name="skill">{SKILLS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                    <label>Question<textarea name="prompt" required maxLength={300} rows={2} /></label>
                    {[1, 2, 3].map((index) => <label key={index}>Choice {index}<input name={"choice" + index} required maxLength={120} /></label>)}
                    <label>Correct choice<select name="answer"><option value="0">Choice 1</option><option value="1">Choice 2</option><option value="2">Choice 3</option></select></label>
                    <button className="pwd-save" disabled={busy}>Add question</button>
                  </form>
                </details>
              )}
              <details>
                <summary>Invite a participant</summary>
                <form className="pwd-study-form" onSubmit={invite}>
                  <label>Player alias or account ID<input name="participant" required maxLength={64} autoComplete="off" /></label>
                  <label>External consent verified<select name="consent"><option value="guardian">Parent or guardian</option><option value="adult">Adult participant</option></select></label>
                  <label className="pwd-study-confirm"><input type="checkbox" name="verified" required /> I verified this consent outside the app.</label>
                  <button className="pwd-save" disabled={busy}>Invite player</button>
                </form>
              </details>
              <details>
                <summary>Export pseudonymized study data</summary>
                <div className="pwd-study-form">
                  <label>Dataset<select value={dataset} onChange={(event) => { setDataset(event.target.value === "attempt" ? "attempt" : "assessment"); setPage(0); }}>
                    <option value="assessment">Assessment results</option><option value="attempt">Game attempts</option>
                  </select></label>
                  <label>Page<input type="number" value={page + 1} min={1} max={10001} onChange={(event) => setPage(Math.max(0, Number(event.target.value) - 1))} /></label>
                  <button type="button" className="pwd-save" disabled={busy} onClick={exportPage}><Download size={16} aria-hidden="true" /> Download JSON</button>
                </div>
              </details>
            </>
          )}
        </section>
      </div>

      {message && <p className="pwd-feedback pwd-admin-status" role={message.error ? "alert" : "status"}>{message.text}</p>}
    </>
  );
}
