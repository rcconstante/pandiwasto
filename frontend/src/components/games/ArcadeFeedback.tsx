import type { ReactNode } from "react";
import { CircleX, Heart, Sparkles, Star } from "lucide-react";
import "./arcade-feedback.css";

export function ArcadeCue({ tone, children }: { tone: "correct" | "retry"; children: ReactNode }) {
  const Icon = tone === "correct" ? Sparkles : CircleX;
  return (
    <span className="arcade-cue" data-tone={tone}>
      <Icon size={18} aria-hidden="true" /> <span>{children}</span>
    </span>
  );
}

export function ArcadeScore({ points }: { points: number }) {
  return (
    <span className="pop-score">
      <Star size={17} aria-hidden="true" />
      <span key={points} className={points > 0 ? "arcade-score-gain" : undefined}>{points.toLocaleString()} pts</span>
    </span>
  );
}

export function ArcadeHearts({ lives, total }: { lives: number; total: number }) {
  return (
    <span className="arcade-hearts" role="status">
      <span className="sr-only">{lives} {lives === 1 ? "heart" : "hearts"} left</span>
      {Array.from({ length: total }, (_, index) => <Heart key={index} size={20} aria-hidden="true" data-full={index < lives} />)}
    </span>
  );
}
