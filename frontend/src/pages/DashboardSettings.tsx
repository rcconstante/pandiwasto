import { useState, type FormEvent } from "react";
import type { User, UserAttributes } from "@supabase/supabase-js";
import { authClient } from "@/lib/auth";
import type { ProfileDetails } from "@/data/dashboardProfile";
import { DashboardProfileEditor } from "./DashboardProfileEditor";

export function DashboardSettings({ profile, onSaveProfile, user, onLeave, leaving }: {
  profile: ProfileDetails;
  onSaveProfile: (profile: ProfileDetails) => void;
  user: User;
  onLeave: () => void;
  leaving: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);

  async function updateAccount(attributes: UserAttributes, message: string) {
    if (!authClient || pending) return false;
    setPending(true);
    setFeedback(null);
    try {
      const { error } = await authClient.updateUser(attributes);
      if (error) throw error;
      setFeedback({ message });
      return true;
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Save failed. Try again.", error: true });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function saveCredentials(event: FormEvent<HTMLFormElement>, kind: "email" | "password") {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const value = String(fields.get("value"));
    const saved = kind === "email"
      ? await updateAccount({ email: value.trim() }, "Email change requested. Check your inbox for confirmation.")
      : await updateAccount({ password: value, current_password: String(fields.get("current")) }, "Password changed.");
    if (saved) form.reset();
  }

  return (
    <>
      <h2>Settings</h2>
      <div className="pwd-settings">
        <DashboardProfileEditor profile={profile} onSave={onSaveProfile} />
        <section aria-labelledby="pwd-account-heading">
          <h3 id="pwd-account-heading">Account &amp; password</h3>
          <p>Signed in as <strong>{user.email}</strong></p>
          <details>
            <summary>Change email</summary>
            <form onSubmit={(event) => saveCredentials(event, "email")}>
              <label>New email <input name="value" type="email" autoComplete="email" required /></label>
              <button className="pwd-save" type="submit" disabled={pending}>Save email</button>
            </form>
          </details>
          <details>
            <summary>Change password</summary>
            <form onSubmit={(event) => saveCredentials(event, "password")}>
              <label>Current password <input name="current" type="password" autoComplete="current-password" required /></label>
              <label>New password <input name="value" type="password" autoComplete="new-password" minLength={8} required /></label>
              <button className="pwd-save" type="submit" disabled={pending}>Save password</button>
            </form>
          </details>
          <button type="button" className="pwd-save pwd-account-leave" disabled={leaving} onClick={onLeave}>
            Sign out
          </button>
        </section>
      </div>
      {feedback && <p className="pwd-feedback" role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    </>
  );
}
