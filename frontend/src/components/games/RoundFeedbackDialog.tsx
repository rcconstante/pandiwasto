import { ArrowRight, CircleX, Star } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

export function RoundFeedbackDialog({ open, onOpenChange, won, title, description, answer, points, actionLabel, onAction, busy, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  won: boolean;
  title: string;
  description: string;
  answer?: string;
  points?: number;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pw-modal-overlay pop-celebration-overlay" />
        <Dialog.Content className="pw-modal pop-celebration arcade-round-dialog" data-tone={won ? "win" : "miss"}>
          {won
            ? <img src={`${import.meta.env.BASE_URL}pandiwasto-mascot.webp`} width="84" height="84" alt="" />
            : <span className="arcade-miss-medal"><CircleX size={35} aria-hidden="true" /></span>}
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          {answer && <strong className="arcade-answer" lang="fil">{answer}</strong>}
          {!!points && <span className="pop-celebration-score"><Star size={17} aria-hidden="true" /> +{points} points</span>}
          <button type="button" className="pop-button pop-primary" disabled={busy} onClick={onAction}>
            {actionLabel} <ArrowRight size={17} aria-hidden="true" />
          </button>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
