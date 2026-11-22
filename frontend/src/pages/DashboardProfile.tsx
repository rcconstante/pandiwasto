import { ArrowRight, Sparkles, Star } from "lucide-react";
import { avatarSrc, type ProfileDetails } from "@/data/dashboardProfile";

export function DashboardProfile({ profile, level, xp, onEdit }: {
  profile: ProfileDetails;
  level: number | null;
  xp: number | null;
  onEdit: () => void;
}) {
  return (
    <>
      <h2>Your profile</h2>
      <div className="pwd-profile-card">
        <img src={avatarSrc(profile.avatar)} alt="" width="116" height="116" />
        <div>
          <h3>{profile.displayName || "Player"}</h3>
          <div className="pwd-profile-progress" aria-label="Player progress">
            {level !== null && xp !== null ? (
              <>
                <span><Star size={18} aria-hidden="true" /> Level {level.toLocaleString()}</span>
                <span><Sparkles size={18} aria-hidden="true" /> {xp.toLocaleString()} XP</span>
              </>
            ) : <p>Account progress is unavailable.</p>}
          </div>
        </div>
      </div>
      <button type="button" className="pwd-text-action pwd-profile-edit" onClick={onEdit}>Edit in Settings <ArrowRight size={16} aria-hidden="true" /></button>
    </>
  );
}
