import { useCallback, useState, type FormEvent } from "react";
import { GraduationCap, Pencil, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { ArcadeSelect } from "@/components/ui/ArcadeSelect";
import { deleteClass, loadClasses, loadClassRoster, saveClass, setClassMember, type ClassSummary } from "@/lib/arcadeApi";
import { formValue, isConflict, useAdminAction, useRemote } from "./adminActions";
import { Avatar, ConfirmModal, LoadState, Modal, Notice, PageHeader, SearchField, SkeletonList } from "./StaffKit";

const NO_TEACHER = "none";
type Dialog = "create" | "edit" | "delete" | null;

/** Admins manage every class and assign teachers; teachers manage only their own classes. */
export function AdminClasses({ admin }: { admin: boolean }) {
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const { busy, message, setMessage, run } = useAdminAction();
  const classes = useRemote(loadClasses, "classes");
  const roster = useRemote((signal) => selectedId ? loadClassRoster(selectedId, signal) : Promise.resolve(null), `roster:${selectedId}`);
  const members = roster.state.status === "ready" ? roster.state.data?.students ?? [] : [];
  const onFilter = useCallback((value: string) => setFilter(value.toLocaleLowerCase()), []);

  const data = classes.state.status === "ready" ? classes.state.data : null;
  const selected = data?.classes.find((entry) => entry.id === selectedId);
  const visible = data?.classes.filter((entry) => !filter || (entry.name + " " + (entry.teacherName ?? "")).toLocaleLowerCase().includes(filter)) ?? [];
  const teacherOptions = [{ value: NO_TEACHER, label: "No teacher yet" }, ...(data?.teachers ?? []).map(({ id, name }) => ({ value: id, label: name }))];

  function teacherFrom(fields: FormData) {
    const value = formValue(fields, "teacher");
    return value && value !== NO_TEACHER ? value : null;
  }

  function openDialog(next: Dialog) {
    setMessage(null);
    setDialog(next);
  }

  async function save(event: FormEvent<HTMLFormElement>, classId: string | null) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const done = await run(async () => {
      const saved = await saveClass(classId, formValue(fields, "name"), teacherFrom(fields));
      setSelectedId(saved.classId);
      classes.reload();
      return classId ? "Class saved." : "Class created. Add students by email, alias, or account ID.";
    }, "Couldn’t save the class.");
    if (done) setDialog(null);
  }

  function member(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const lookup = formValue(new FormData(form), "student");
    void run(async () => {
      await setClassMember(selected.id, lookup, true);
      form.reset();
      classes.reload();
      roster.reload();
      return "Student added.";
    }, (error) => isConflict(error)
      ? "That account can’t join: it is a staff account, or the alias matches more than one player (use the email)."
      : "Couldn’t find a confirmed account for that student.");
  }

  function removeMember(studentId: string, name: string) {
    if (!selected) return;
    void run(async () => {
      await setClassMember(selected.id, studentId, false);
      classes.reload();
      roster.reload();
      return `${name} removed from ${selected.name}.`;
    }, "Couldn’t remove the student.");
  }

  async function remove() {
    if (!selected) return;
    const done = await run(async () => {
      await deleteClass(selected.id);
      setSelectedId("");
      classes.reload();
      return `${selected.name} deleted. Students keep their accounts and progress.`;
    }, "Couldn’t delete the class.");
    if (done) setDialog(null);
  }

  const classForm = (classId: string | null) => (
    <form key={classId ?? "new"} className="st-form" onSubmit={(event) => void save(event, classId)}>
      {message?.error && <Notice message={message} />}
      <label>Class name<input name="name" required maxLength={80} defaultValue={selected && classId ? selected.name : ""} placeholder="Grade 6 – Sampaguita" /></label>
      {admin && (
        <>
          <ArcadeSelect className="st-select" label="Teacher" name="teacher" defaultValue={(classId && selected?.teacherId) || NO_TEACHER} options={teacherOptions} />
          <p className="st-hint">Only accounts with the Teacher role are listed. Set roles in Accounts.</p>
        </>
      )}
      <div className="st-modal-actions">
        <button type="button" className="st-button" onClick={() => setDialog(null)}>Cancel</button>
        <button className="st-button st-button-primary" disabled={busy}>{classId ? "Save class" : "Create class"}</button>
      </div>
    </form>
  );

  return (
    <>
      <PageHeader title="Classes" description={admin
        ? "Teachers see mastery and answers only for students in their classes."
        : "Create your classes and add students by email, alias, or account ID."}
        actions={<button type="button" className="st-button st-button-primary" onClick={() => openDialog("create")}><Plus size={17} aria-hidden="true" /> Create class</button>} />
      {dialog === null && <Notice message={message} />}

      {classes.state.status !== "ready" ? (
        <div className="st-split">
          <section className="st-card"><LoadState status={classes.state.status} what="classes" onRetry={classes.reload} /></section>
          <section className="st-card" aria-hidden="true"><SkeletonList rows={3} /></section>
        </div>
      ) : (
        <div className="st-split">
          <section className="st-card st-list-card" aria-label="Class list">
            <SearchField label="Search classes" placeholder="Search classes or teachers" onSearch={onFilter} />
            <ul className="st-list">
              {visible.map((entry: ClassSummary) => (
                <li key={entry.id}>
                  <button type="button" aria-current={entry.id === selectedId ? "true" : undefined} onClick={() => setSelectedId(entry.id)}>
                    <span className="st-list-icon"><GraduationCap size={18} aria-hidden="true" /></span>
                    <span><strong>{entry.name}</strong><small>{entry.teacherName ?? "No teacher yet"}</small></span>
                    <span className="st-count">{entry.students}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!visible.length && <p className="st-empty">{data?.classes.length ? "No classes match your search." : "No classes yet. Create the first one."}</p>}
          </section>

          <section className="st-card" aria-label="Class details">
            {!selected ? <p className="st-empty">Choose a class to manage its teacher and students.</p> : (
              <>
                <div className="st-card-head">
                  <div>
                    <h2>{selected.name}</h2>
                    <p>{selected.teacherName ? `Teacher: ${selected.teacherName}` : "No teacher assigned"} · {selected.students} {selected.students === 1 ? "student" : "students"}</p>
                  </div>
                  <div className="st-actions">
                    <button type="button" className="st-button st-button-small" onClick={() => openDialog("edit")}><Pencil size={15} aria-hidden="true" /> Edit</button>
                    <button type="button" className="st-button st-button-small st-button-danger-ghost" onClick={() => openDialog("delete")}><Trash2 size={15} aria-hidden="true" /> Delete</button>
                  </div>
                </div>
                <form className="st-inline-form" onSubmit={member}>
                  <label><span className="sr-only">Student email, alias, or account ID</span>
                    <input name="student" required maxLength={254} autoComplete="off" placeholder="Student email, alias, or account ID" />
                  </label>
                  <button className="st-button st-button-primary" disabled={busy}><UserPlus size={16} aria-hidden="true" /> Add student</button>
                </form>
                {roster.state.status !== "ready" ? <LoadState status={roster.state.status} what="students" onRetry={roster.reload} skeleton={<SkeletonList rows={3} />} /> : (
                  <ul className="st-members">
                    {members.map((student) => (
                      <li key={student.id}>
                        <Avatar name={student.name} student avatar={student.avatar} size={32} />
                        <span><strong>{student.name}</strong><small>{student.alias}</small></span>
                        <button type="button" className="st-icon-button" aria-label={`Remove ${student.name}`} title="Remove from class" disabled={busy}
                          onClick={() => removeMember(student.id, student.name)}><UserMinus size={17} aria-hidden="true" /></button>
                      </li>
                    ))}
                    {!members.length &&<li className="st-empty">No students yet.</li>}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <Modal open={dialog === "create"} onOpenChange={(open) => setDialog(open ? "create" : null)} title="Create a class">{classForm(null)}</Modal>
      <Modal open={dialog === "edit"} onOpenChange={(open) => setDialog(open ? "edit" : null)} title="Edit class">{selected ? classForm(selected.id) : null}</Modal>
      <ConfirmModal open={dialog === "delete"} onOpenChange={(open) => setDialog(open ? "delete" : null)} busy={busy} danger
        title={`Delete ${selected?.name ?? "class"}?`} description="The class and its member list are removed. Students keep their accounts and progress."
        confirmLabel="Delete class" onConfirm={() => void remove()} />
    </>
  );
}
