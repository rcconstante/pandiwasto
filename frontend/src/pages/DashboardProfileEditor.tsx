import { useState, type FormEvent } from "react";
import { Check, Save } from "lucide-react";
import { AVATARS, GENDER_OPTIONS, avatarSrc, readGender, type ProfileDetails } from "@/data/dashboardProfile";
import { authClient } from "@/lib/auth";

export function DashboardProfileEditor({ profile, onSave }: {
  profile: ProfileDetails;
  onSave: (profile: ProfileDetails) => void;
}) {
  const [avatar, setAvatar] = useState(profile.avatar);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const values = new FormData(event.currentTarget);
    const next = {
      displayName: String(values.get("displayName") ?? "").trim().slice(0, 24),
      firstName: String(values.get("firstName") ?? "").trim().slice(0, 40),
      lastName: String(values.get("lastName") ?? "").trim().slice(0, 40),
      gender: readGender(values.get("gender")),
      avatar,
    };

    setPending(true);
    setFeedback(null);
    try {
      if (!authClient) throw new Error("Account access unavailable");
      const { error } = await authClient.updateUser({ data: {
        display_name: next.displayName,
        first_name: next.firstName,
        last_name: next.lastName,
        gender: next.gender,
        avatar: next.avatar,
      } });
      if (error) throw error;
      onSave(next);
      setFeedback({ message: "Profile saved." });
    } catch {
      setFeedback({ message: "We couldn’t save your profile. Try again.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="pwd-profile-settings-heading">
      <h3 id="pwd-profile-settings-heading">Profile details</h3>
      <div className="pwd-profile-grid">
        <figure className="pwd-profile-preview">
          <img src={avatarSrc(avatar)} alt="" width="144" height="144" />
          <figcaption>{profile.displayName || "Player"}</figcaption>
        </figure>
        <form className="pwd-profile-form" onSubmit={saveProfile}>
          <fieldset disabled={pending}>
            <legend>Choose your profile picture</legend>
            <div className="pwd-avatar-choices">
              {AVATARS.map((choice) => (
                <label key={choice.id} className="pwd-avatar">
                  <input className="sr-only" type="radio" name="avatar" value={choice.id} checked={choice.id === avatar} onChange={() => setAvatar(choice.id)} />
                  <img src={avatarSrc(choice.id)} alt="" width="62" height="62" />
                  <span>{choice.label}</span>
                  {choice.id === avatar && <Check className="pwd-avatar-check" size={14} aria-hidden="true" />}
                </label>
              ))}
            </div>
          </fieldset>
          <label>Display name <input name="displayName" defaultValue={profile.displayName} maxLength={24} disabled={pending} /></label>
          <div className="pwd-name-fields">
            <label>First name <input name="firstName" autoComplete="given-name" defaultValue={profile.firstName} maxLength={40} disabled={pending} /></label>
            <label>Last name <input name="lastName" autoComplete="family-name" defaultValue={profile.lastName} maxLength={40} disabled={pending} /></label>
          </div>
          <label>Gender (optional)
            <select name="gender" defaultValue={profile.gender} disabled={pending}>
              <option value="">Select an option</option>
              {GENDER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <button className="pwd-save pwd-profile-save" type="submit" disabled={pending}><Save size={17} aria-hidden="true" /> {pending ? "Saving…" : "Save profile"}</button>
          {feedback && <p className="pwd-feedback" role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
        </form>
      </div>
    </section>
  );
}
