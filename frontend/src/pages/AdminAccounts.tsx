import { useCallback, useState, type FormEvent } from "react";
import { Ban, ChevronLeft, ChevronRight, RotateCcw, UserPlus } from "lucide-react";
import { ArcadeSelect } from "@/components/ui/ArcadeSelect";
import { createAccount, listAccounts, setAccountRole, setAccountSuspended, type Account, type AccountRole } from "@/lib/arcadeApi";
import { displayName, formValue, isConflict, useAdminAction, useRemote } from "./adminActions";
import { Avatar, ConfirmModal, LoadState, Modal, Notice, PageHeader, SearchField, SkeletonTable } from "./StaffKit";

const ROLES: { value: AccountRole; label: string }[] = [
  { value: "student", label: "Student" }, { value: "teacher", label: "Teacher" }, { value: "admin", label: "Admin" },
];
const readRole = (value: string) => ROLES.find((role) => role.value === value)?.value ?? "student";
const shortDate = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Never";

export function AdminAccounts() {
  const [query, setQuery] = useState({ search: "", page: 0 });
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Account | null>(null);
  const { busy, message, setMessage, run } = useAdminAction();
  const accounts = useRemote((signal) => listAccounts(query.search, query.page, signal), `accounts:${query.search}:${query.page}`);
  const search = useCallback((value: string) => setQuery((current) => current.search === value ? current : { search: value, page: 0 }), []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const done = await run(async () => {
      await createAccount({
        email: formValue(fields, "email"), password: String(fields.get("password") ?? ""),
        firstName: formValue(fields, "firstName"), lastName: formValue(fields, "lastName"),
        displayName: formValue(fields, "displayName"), role: readRole(formValue(fields, "role")),
      });
      accounts.reload();
      return "Account created. Share the temporary password privately and ask the user to change it in Settings.";
    }, (error) => isConflict(error) ? "An account with this email already exists." : "Couldn’t create the account. Check the details and try again.");
    if (done) setCreating(false);
  }

  function changeRole(account: Account, role: AccountRole) {
    if (role === account.role) return;
    void run(async () => {
      await setAccountRole(account.id, role);
      accounts.reload();
      return `${displayName(account)} is now ${role === "student" ? "a student" : role === "teacher" ? "a teacher" : "an admin"}.`;
    }, (error) => isConflict(error) ? "You can’t remove your own admin access." : "Couldn’t change the role.");
  }

  async function toggleSuspension(account: Account) {
    await run(async () => {
      await setAccountSuspended(account.id, !account.suspended);
      accounts.reload();
      return account.suspended ? `${displayName(account)} can sign in again.` : `${displayName(account)} is suspended.`;
    }, (error) => isConflict(error) ? "You can’t suspend yourself or an admin. Change the admin role first." : "Couldn’t update the suspension.");
    setConfirming(null);
  }

  const state = accounts.state;
  return (
    <>
      <PageHeader title="Accounts" description="Create accounts, set roles, and suspend access."
        actions={<button type="button" className="st-button st-button-primary" onClick={() => { setMessage(null); setCreating(true); }}><UserPlus size={17} aria-hidden="true" /> Create account</button>} />
      <Notice message={message} />

      <section className="st-card" aria-label="Accounts">
        <div className="st-toolbar">
          <SearchField label="Search accounts" placeholder="Search by name or email" onSearch={search} />
          {state.status === "ready" && state.refreshing && <span className="st-spinner" role="status" aria-label="Updating" />}
        </div>
        {state.status !== "ready" ? <LoadState status={state.status} what="accounts" onRetry={accounts.reload} skeleton={<SkeletonTable rows={5} cols={6} />} /> : (
          <>
            <div className="st-table-wrap">
              <table className="st-table">
                <thead>
                  <tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {state.data.accounts.map((account) => (
                    <tr key={account.id}>
                      <th scope="row">
                        <span className="st-person">
                          <Avatar name={displayName(account)} student={account.role === "student"} avatar={account.avatar} />
                          <span><strong>{displayName(account)}</strong><small>{account.email}</small></span>
                        </span>
                      </th>
                      <td>
                        <ArcadeSelect className="st-select st-select-compact" label={`Role for ${account.email}`} hideLabel value={account.role}
                          disabled={busy} options={ROLES} onValueChange={(value) => changeRole(account, readRole(value))} />
                      </td>
                      <td><span className={account.suspended ? "st-badge st-badge-danger" : "st-badge st-badge-success"}>{account.suspended ? "Suspended" : "Active"}</span></td>
                      <td>{shortDate(account.createdAt)}</td>
                      <td>{shortDate(account.lastSignInAt)}</td>
                      <td className="st-cell-actions">
                        <button type="button" className={account.suspended ? "st-button st-button-small" : "st-button st-button-small st-button-danger-ghost"} disabled={busy} onClick={() => setConfirming(account)}>
                          {account.suspended ? <><RotateCcw size={15} aria-hidden="true" /> Restore</> : <><Ban size={15} aria-hidden="true" /> Suspend</>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!state.data.accounts.length && <p className="st-empty">{query.search ? `No accounts match “${query.search}”.` : "No accounts yet."}</p>}
            </div>
            <div className="st-pager">
              <span>Page {query.page + 1}</span>
              <button type="button" className="st-icon-button" aria-label="Previous page" disabled={query.page === 0} onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}><ChevronLeft size={18} aria-hidden="true" /></button>
              <button type="button" className="st-icon-button" aria-label="Next page" disabled={!state.data.hasMore} onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </>
        )}
      </section>

      <Modal open={creating} onOpenChange={setCreating} title="Create an account" description="The account is confirmed right away. Share the temporary password privately.">
        <form className="st-form st-form-grid" onSubmit={create}>
          {message?.error && <div className="st-span"><Notice message={message} /></div>}
          <label>First name<input name="firstName" required maxLength={40} /></label>
          <label>Last name<input name="lastName" required maxLength={40} /></label>
          <label>Display name<input name="displayName" required maxLength={24} /></label>
          <ArcadeSelect className="st-select" label="Role" name="role" defaultValue="student" options={ROLES} />
          <label className="st-span">Email<input type="email" name="email" required maxLength={254} autoComplete="off" /></label>
          <label className="st-span">Temporary password<input type="password" name="password" required minLength={8} maxLength={72} autoComplete="new-password" /><small>At least 8 characters.</small></label>
          <div className="st-modal-actions st-span">
            <button type="button" className="st-button" onClick={() => setCreating(false)}>Cancel</button>
            <button className="st-button st-button-primary" disabled={busy}><UserPlus size={17} aria-hidden="true" /> Create account</button>
          </div>
        </form>
      </Modal>

      <ConfirmModal open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }} busy={busy}
        title={confirming?.suspended ? "Restore this account?" : "Suspend this account?"}
        description={confirming ? (confirming.suspended
          ? `${displayName(confirming)} will be able to sign in and play again.`
          : `${displayName(confirming)} will be signed out of the arcade and can’t sign in until restored. Their progress is kept.`) : ""}
        confirmLabel={confirming?.suspended ? "Restore account" : "Suspend account"} danger={!confirming?.suspended}
        onConfirm={() => { if (confirming) void toggleSuspension(confirming); }} />
    </>
  );
}
