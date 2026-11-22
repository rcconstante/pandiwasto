import { Sparkles, Star } from "lucide-react";
import { XP_PER_LEVEL } from "@/data/arcadeProgress";
import { avatarSrc, type ProfileDetails } from "@/data/dashboardProfile";

export function DashboardProfile({ profile, photoUrl, level, xp }: {
  profile: ProfileDetails;
  photoUrl?: string;
  level: number | null;
  xp: number | null;
}) {
  const levelXp = xp === null ? 0 : xp % XP_PER_LEVEL;
  return (
    <>
      <h2>Your profile</h2>
      <div className="pwd-profile-card">
        <img className={photoUrl ? "pwd-player-photo" : undefined} src={photoUrl ?? avatarSrc(profile.avatar)} alt="" width="116" height="116" />
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
          {level !== null && xp !== null && (
            <div className="pwd-xp-meter">
              <p>{XP_PER_LEVEL - levelXp} XP to Level {level + 1}</p>
              <progress aria-label="XP toward the next level" value={levelXp} max={XP_PER_LEVEL} />
              <small>{levelXp} / {XP_PER_LEVEL} XP</small>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
