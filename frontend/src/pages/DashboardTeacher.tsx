import { useCallback, useState } from "react";
import { Check, Download } from "lucide-react";
import { ArcadeSelect } from "@/components/ui/ArcadeSelect";
import { XP_PER_LEVEL } from "@/data/arcadeProgress";
import { DASHBOARD_LESSONS } from "@/data/dashboardLessons";
import { MINIGAMES } from "@/data/landingData";
import { loadClassRoster, loadStudent, loadTeacherClasses, type SkillMastery, type StudentSummary } from "@/lib/arcadeApi";
import { useRemote } from "./adminActions";
import { downloadFile } from "./downloadFile";
import { Avatar, LoadState, Modal, PageHeader, SearchField, SkeletonList, SkeletonStats, SkeletonTable } from "./StaffKit";

const percent = (value: number) => Math.round(value * 100) + "%";
const level = (xp: number) => 1 + Math.floor(xp / XP_PER_LEVEL);
const gameName = (id: number) => MINIGAMES.find((game) => game.id === id)?.gameName ?? "Game " + id;
const skillName = (id: string) => DASHBOARD_LESSONS.find((lesson) => lesson.id === id)?.title ?? id;
const when = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never";

function band(skill?: SkillMastery) {
  if (!skill) return "none";
  if (skill.mastered) return "mastered";
  return skill.mastery < 0.4 ? "low" : skill.mastery < 0.7 ? "medium" : "high";
}

function MasteryCell({ skill }: { skill?: SkillMastery }) {
  return (
    <td className="st-mastery" data-band={band(skill)}>
      {skill ? <span>{percent(skill.mastery)}{skill.mastered && <Check size={13} aria-label="mastered" />}<small>{skill.attempts}</small></span> : "—"}
    </td>
  );
}

function rosterCsv(students: StudentSummary[]) {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = ["Student", "Level", "XP", ...DASHBOARD_LESSONS.flatMap((lesson) => [lesson.title + " P(L)", lesson.title + " answers", lesson.title + " mastered"])];
  const rows = students.map((student) => [student.name, level(student.xp), student.xp, ...DASHBOARD_LESSONS.flatMap((lesson) => {
    const skill = student.skills.find((entry) => entry.skillId === lesson.id);
    return skill ? [skill.mastery.toFixed(4), skill.attempts, skill.mastered ? "yes" : "no"] : ["", 0, "no"];
  })]);
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
}

function StudentDetail({ classId, studentId }: { classId: string; studentId: string }) {
  const record = useRemote((signal) => loadStudent(classId, studentId, signal), `student:${classId}:${studentId}`);
  if (record.state.status !== "ready") {
    return <LoadState status={record.state.status} what="the student record" onRetry={record.reload}
      skeleton={<div className="st-detail"><SkeletonStats count={4} /><SkeletonList rows={5} /></div>} />;
  }
  const student = record.state.data;
  return (
    <div className="st-detail">
      <dl className="st-stats st-stats-compact">
        <div><dt>Level</dt><dd>{level(student.xp)}</dd></div>
        <div><dt>XP</dt><dd>{student.xp.toLocaleString()}</dd></div>
        <div><dt>Hints shown</dt><dd>{student.hints.toLocaleString()}</dd></div>
        <div><dt>Skills mastered</dt><dd>{student.skills.filter((skill) => skill.mastered).length} / {DASHBOARD_LESSONS.length}</dd></div>
      </dl>
      <div className="st-two-col">
        <section>
          <h3>Skill mastery</h3>
          <ul className="st-bars">
            {DASHBOARD_LESSONS.map((lesson) => {
              const skill = student.skills.find((entry) => entry.skillId === lesson.id);
              return (
                <li key={lesson.id} data-band={band(skill)}>
                  <span>{lesson.title}</span>
                  <span className="st-bar"><span style={{ width: skill ? percent(skill.mastery) : "0%" }} /></span>
                  <span>{skill ? `${percent(skill.mastery)} · ${skill.attempts}` : "—"}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h3>Best scores</h3>
          <ul className="st-scores">
            {MINIGAMES.map((game) => <li key={game.id}><span>{game.gameName}</span><strong>{student.bestScores[game.id]?.toLocaleString() ?? "—"}</strong></li>)}
          </ul>
        </section>
      </div>
      <h3>Latest answers</h3>
      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Game</th><th scope="col">Skill</th><th scope="col">Item</th><th scope="col">Result</th><th scope="col">Time</th><th scope="col">P(L) before → after</th></tr>
          </thead>
          <tbody>
            {student.answers.map((answer, index) => (
              <tr key={answer.at + index}>
                <td>{when(answer.at)}</td>
                <td>{gameName(answer.gameId)}</td>
                <td>{skillName(answer.skillId)}</td>
                <td lang="fil">{answer.item}</td>
                <td>
                  <span className={answer.correct ? "st-badge st-badge-success" : "st-badge st-badge-danger"}>{answer.timedOut ? "Timed out" : answer.correct ? "Correct" : "Wrong"}</span>
                  {!answer.firstAttempt && <span className="st-badge">Retry</span>}
                  {answer.hintUsed && <span className="st-badge">Hint</span>}
                </td>
                <td>{(answer.responseMs / 1000).toFixed(1)} s</td>
                <td>{answer.masteryBefore === null || answer.masteryAfter === null ? "Not scored" : percent(answer.masteryBefore) + " → " + percent(answer.masteryAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!student.answers.length && <p className="st-empty">No answers yet.</p>}
      </div>
    </div>
  );
}

export function DashboardTeacher() {
  const [chosenClass, setChosenClass] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<StudentSummary | null>(null);
  const classes = useRemote(loadTeacherClasses, "teacher-classes");
  const list = classes.state.status === "ready" ? classes.state.data.classes : [];
  // Default to the first class until the teacher picks one.
  const classId = chosenClass || list[0]?.id || "";
  const roster = useRemote((signal) => classId ? loadClassRoster(classId, signal) : Promise.resolve(null), `class:${classId}`);
  const onFilter = useCallback((value: string) => setFilter(value.toLocaleLowerCase()), []);
  const data = roster.state.status === "ready" ? roster.state.data : null;
  const students = (data?.students ?? []).filter((student) => !filter || (student.name + " " + student.alias).toLocaleLowerCase().includes(filter));

  return (
    <>
      <PageHeader title="Class progress" description="BKT mastery P(L) per skill, with the number of scored answers. A check marks a mastered skill."
        actions={list.length > 0 && (
          <>
            <ArcadeSelect className="st-select st-select-header" label="Class" hideLabel value={classId}
              onValueChange={(value) => { setChosenClass(value); setOpen(null); }}
              options={list.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.students}` }))} />
            <button type="button" className="st-button" disabled={!data?.students.length}
              onClick={() => data && downloadFile("pandiwasto-" + data.name.replace(/[^\p{L}\p{N}]+/gu, "-") + ".csv", rosterCsv(data.students), "text/csv")}>
              <Download size={16} aria-hidden="true" /> Download CSV
            </button>
          </>
        )} />

      <section className="st-card" aria-label="Class mastery">
        {classes.state.status !== "ready" ? <LoadState status={classes.state.status} what="your classes" onRetry={classes.reload} skeleton={<SkeletonTable rows={4} cols={8} />} />
          : !list.length ? <p className="st-empty">No classes yet. An admin assigns teachers to classes.</p>
          : roster.state.status !== "ready" ? <LoadState status={roster.state.status} what="the class" onRetry={roster.reload} skeleton={<SkeletonTable rows={4} cols={8} />} /> : (
            <>
              <div className="st-toolbar">
                <SearchField label="Search students" placeholder="Search students" onSearch={onFilter} />
                <ul className="st-legend" aria-label="Legend">
                  <li data-band="low">Below 40%</li><li data-band="medium">40–69%</li><li data-band="high">70% or more</li><li data-band="mastered">Mastered</li>
                </ul>
              </div>
              <div className="st-table-wrap">
                <table className="st-table st-mastery-table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th><th scope="col">Level</th><th scope="col">Last played</th>
                      {DASHBOARD_LESSONS.map((lesson) => <th key={lesson.id} scope="col">{lesson.title}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((entry) => (
                      <tr key={entry.id}>
                        <th scope="row">
                          <button type="button" className="st-person st-person-button" onClick={() => setOpen(entry)}>
                            <Avatar name={entry.name} student avatar={entry.avatar} size={30} />
                            <span><strong>{entry.name}</strong><small>{entry.alias}</small></span>
                          </button>
                        </th>
                        <td>{level(entry.xp)}</td>
                        <td>{when(entry.lastActive)}</td>
                        {DASHBOARD_LESSONS.map((lesson) => <MasteryCell key={lesson.id} skill={entry.skills.find((skill) => skill.skillId === lesson.id)} />)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!students.length && <p className="st-empty">{data?.students.length ? "No students match your search." : "No students in this class yet."}</p>}
              </div>
            </>
          )}
      </section>

      <Modal wide open={open !== null} onOpenChange={(isOpen) => { if (!isOpen) setOpen(null); }} title={open?.name ?? "Student"} description={open ? `${open.alias} · last played ${when(open.lastActive)}` : undefined}>
        {open && classId && <StudentDetail classId={classId} studentId={open.id} />}
      </Modal>
    </>
  );
}
