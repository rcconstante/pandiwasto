import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Check, Save } from "lucide-react";
import { AVATARS, GENDER_OPTIONS, avatarSrc, readGender, type ProfileDetails } from "@/data/dashboardProfile";
import { authClient } from "@/lib/auth";
import { removePlayerPhoto, uploadPlayerPhoto } from "@/lib/playerPhoto";
import { ArcadeSelect } from "@/components/ui/ArcadeSelect";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function DashboardProfileEditor({ profile, photoUrl, userId, onSave }: {
  profile: ProfileDetails;
  photoUrl?: string;
  userId: string;
  onSave: (profile: ProfileDetails) => void;
}) {
  const [avatar, setAvatar] = useState(profile.avatar);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [useAvatar, setUseAvatar] = useState(false);
  const preparedPhoto = useRef<{ file: File; path: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const picture = previewUrl ?? (useAvatar ? undefined : photoUrl);

  useEffect(() => {
    if (!selectedPhoto) return;
    const url = URL.createObjectURL(selectedPhoto);
    const frame = requestAnimationFrame(() => setPreviewUrl(url));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(url);
    };
  }, [selectedPhoto]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type) || file.size > 5 * 1024 * 1024) {
      setFeedback({ message: "Choose a JPG, PNG, or WebP image up to 5 MB.", error: true });
      return;
    }
    setPreviewUrl(undefined);
    setSelectedPhoto(file);
    setUseAvatar(false);
    setFeedback(null);
  }

  function chooseAvatar() {
    setSelectedPhoto(null);
    setPreviewUrl(undefined);
    setUseAvatar(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const values = new FormData(event.currentTarget);
    const next: ProfileDetails = {
      displayName: String(values.get("displayName") ?? "").trim().slice(0, 24),
      firstName: String(values.get("firstName") ?? "").trim().slice(0, 40),
      lastName: String(values.get("lastName") ?? "").trim().slice(0, 40),
      gender: readGender(values.get("gender")),
      avatar,
      photoPath: useAvatar ? null : profile.photoPath,
      visibility: values.get("visibility") === "private" ? "private" : "public",
    };

    setPending(true);
    setFeedback(null);
    try {
      if (!authClient) throw new Error("Account access unavailable");
      if (selectedPhoto) {
        if (preparedPhoto.current?.file !== selectedPhoto) {
          preparedPhoto.current = { file: selectedPhoto, path: await uploadPlayerPhoto(userId, selectedPhoto) };
        }
        next.photoPath = preparedPhoto.current.path;
      }
      const { error } = await authClient.updateUser({ data: {
        display_name: next.displayName,
        first_name: next.firstName,
        last_name: next.lastName,
        gender: next.gender,
        avatar: next.avatar,
        photo_path: next.photoPath,
        profile_visibility: next.visibility,
      } });
      if (error) throw error;
      onSave(next);
      if (profile.photoPath && profile.photoPath !== next.photoPath) {
        void removePlayerPhoto(profile.photoPath).catch(() => {});
      }
      preparedPhoto.current = null;
      setSelectedPhoto(null);
      setPreviewUrl(undefined);
      setUseAvatar(false);
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
          <img className={picture ? "pwd-player-photo" : undefined} src={picture ?? avatarSrc(avatar)} alt="" width="144" height="144" />
          <figcaption>{profile.displayName || "Player"}</figcaption>
        </figure>
        <form className="pwd-profile-form" onSubmit={saveProfile}>
          <fieldset disabled={pending}>
            <legend>Choose your profile picture</legend>
            <div className="pwd-avatar-choices">
              {AVATARS.map((choice) => (
                <label key={choice.id} className="pwd-avatar">
                  <input className="sr-only" type="radio" name="avatar" value={choice.id} checked={choice.id === avatar && !selectedPhoto && (!profile.photoPath || useAvatar)} onChange={() => { setAvatar(choice.id); chooseAvatar(); }} />
                  <img src={avatarSrc(choice.id)} alt="" width="62" height="62" />
                  <span>{choice.label}</span>
                  {choice.id === avatar && !selectedPhoto && (!profile.photoPath || useAvatar) && <Check className="pwd-avatar-check" size={14} aria-hidden="true" />}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="pwd-photo-controls">
            <label className="pwd-save pwd-photo-upload">
              Upload a photo
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={pending} />
            </label>
            {(selectedPhoto || (profile.photoPath && !useAvatar)) && <button className="pwd-text-action" type="button" disabled={pending} onClick={chooseAvatar}>Use arcade avatar</button>}
            <small>Your photo is visible only to you. Rankings shows your arcade avatar.</small>
          </div>
          <label>Display name <input name="displayName" defaultValue={profile.displayName} maxLength={24} disabled={pending} /></label>
          <div className="pwd-name-fields">
            <label>First name <input name="firstName" autoComplete="given-name" defaultValue={profile.firstName} maxLength={40} disabled={pending} /></label>
            <label>Last name <input name="lastName" autoComplete="family-name" defaultValue={profile.lastName} maxLength={40} disabled={pending} /></label>
          </div>
          <ArcadeSelect name="gender" label="Gender (optional)" defaultValue={profile.gender || "unset"} disabled={pending}
            options={[{ value: "unset", label: "Select an option" }, ...GENDER_OPTIONS.map((option) => ({ value: option, label: option }))]} />
          <ArcadeSelect name="visibility" label="Profile visibility" defaultValue={profile.visibility} disabled={pending}
            options={[{ value: "public", label: "Public" }, { value: "private", label: "Private" }]} />
          <small className="pwd-visibility-note">Public shows your arcade alias, avatar, level, and scores to signed-in players. Private hides them from other players.</small>
          <button className="pwd-save pwd-profile-save" type="submit" disabled={pending}><Save size={17} aria-hidden="true" /> {pending ? "Saving…" : "Save profile"}</button>
          {feedback && <p className="pwd-feedback" role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
        </form>
      </div>
    </section>
  );
}
