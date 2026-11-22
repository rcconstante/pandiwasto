import { useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import type { ArcadeProgress } from "@/data/arcadeProgress";
import { resetDeveloperProgress, setDeveloperMode } from "@/lib/arcadeApi";

type ResetScope = "xp" | "gameplay";

export function DeveloperSettings({ enabled, onProgressChange }: {
  enabled: boolean;
  onProgressChange: (progress: ArcadeProgress) => void;
}) {
  const [scope, setScope] = useState<ResetScope | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const resetRequest = useRef<{ scope: ResetScope; id: string } | null>(null);
  const resetTrigger = useRef<HTMLButtonElement>(null);
  const fullReset = scope === "gameplay";

  async function change(action: () => Promise<ArcadeProgress>, message: string) {
    setPending(true);
    setFeedback(null);
    try {
      onProgressChange(await action());
      setFeedback({ text: message });
      return true;
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Couldn’t update developer settings. Try again.", error: true });
      return false;
    } finally {
      setPending(false);
    }
  }

  function showReset(nextScope: ResetScope, trigger: HTMLButtonElement) {
    if (resetRequest.current?.scope !== nextScope) {
      resetRequest.current = { scope: nextScope, id: crypto.randomUUID() };
    }
    setFeedback(null);
    resetTrigger.current = trigger;
    setScope(nextScope);
  }

  async function confirmReset() {
    const request = resetRequest.current;
    if (!request || !scope || pending) return;
    const success = await change(() => resetDeveloperProgress(request.scope, request.id), "Progress reset.");
    if (success) {
      resetRequest.current = null;
      setScope(null);
    }
  }

  return (
    <section className="pwd-developer" aria-labelledby="pwd-developer-heading">
      <h3 id="pwd-developer-heading">Developer mode</h3>
      <p>Test all seven games without adding account XP, scores, or mastery.</p>
      <button className="pwd-save" type="button" disabled={pending} onClick={() => {
        void change(() => setDeveloperMode(!enabled), enabled ? "Developer mode disabled." : "Developer mode enabled.");
      }}>{enabled ? "Disable developer mode" : "Enable developer mode"}</button>
      {enabled && (
        <div className="pwd-developer-actions">
          <button className="pwd-save" type="button" disabled={pending} onClick={(event) => showReset("xp", event.currentTarget)}>Reset XP</button>
          <button className="pwd-save pwd-reset" type="button" disabled={pending} onClick={(event) => showReset("gameplay", event.currentTarget)}>Reset gameplay data</button>
        </div>
      )}
      {!scope && feedback && <p className="pwd-feedback" role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      <AlertDialog.Root open={scope !== null} onOpenChange={(open) => { if (!open && !pending) setScope(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="pw-modal-overlay" />
          <AlertDialog.Content className="pw-modal pwd-action-dialog" onCloseAutoFocus={(event) => {
            event.preventDefault();
            resetTrigger.current?.focus();
          }}>
            <AlertDialog.Title>{fullReset ? "Reset your gameplay data?" : "Reset your XP?"}</AlertDialog.Title>
            <AlertDialog.Description>
              {fullReset
                ? "This clears your XP, best scores, mastery, and game sessions outside the study. Your profile and study records stay on your account."
                : "This returns your account to Level 1 and ends open game sessions. Your best scores and mastery stay on your account."}
            </AlertDialog.Description>
            <div className="pwd-developer-actions">
              <AlertDialog.Cancel className="pwd-save" disabled={pending}>Cancel</AlertDialog.Cancel>
              <button className="pwd-save pwd-reset" type="button" disabled={pending} onClick={() => void confirmReset()}>
                {pending ? "Resetting…" : fullReset ? "Reset gameplay data" : "Reset XP"}
              </button>
            </div>
            {feedback?.error && <p role="alert">{feedback.text}</p>}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
