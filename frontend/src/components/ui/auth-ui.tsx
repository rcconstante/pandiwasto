import { useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { Dialog } from "radix-ui";
import { authClient } from "@/lib/auth";
import { randomAvatar } from "@/data/dashboardProfile";

const NICKNAME_STARTS = ["Happy", "Sunny", "Curious", "Bright", "Brave"];
const NICKNAME_ENDS = ["Tarsier", "Tamaraw", "Maya", "Dolphin", "Explorer"];

function createNickname() {
  const start = NICKNAME_STARTS[Math.floor(Math.random() * NICKNAME_STARTS.length)];
  const end = NICKNAME_ENDS[Math.floor(Math.random() * NICKNAME_ENDS.length)];
  const number = 100 + Math.floor(Math.random() * 900);
  return `${start} ${end} ${number}`;
}

export function SignInModal({ open, onOpenChange, onPreview, returnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview?: () => void;
  returnFocus: () => void;
}) {
  const [signUp, setSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function changeMode(next: boolean) {
    setSignUp(next);
    setShowPassword(false);
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authClient || pending) return;
    const fields = new FormData(event.currentTarget);
    const credentials = {
      email: String(fields.get("email")).trim(),
      password: String(fields.get("password")),
    };
    if (signUp && credentials.password !== fields.get("confirmPassword")) {
      setError("The passwords don’t match.");
      return;
    }
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = signUp
        ? await authClient.signUp({
          ...credentials,
          options: {
            emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
            data: { display_name: createNickname(), avatar: randomAvatar() },
          },
        })
        : await authClient.signInWithPassword(credentials);

      if (result.error) {
        setError(result.error.message);
      } else if (result.data.session) {
        onOpenChange(false);
      } else if (signUp) {
        setMessage("Check your email for a confirmation link, then return to sign in.");
      }
    } catch {
      setError("We couldn’t reach the sign-in service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      if (!next && pending) return;
      if (!next) changeMode(false);
      onOpenChange(next);
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="pw-modal-overlay" />
        <Dialog.Content className="pw-modal pw-auth" data-lenis-prevent onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(); }}>
          <div className="pw-auth-art" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}landing/sign-in.webp`} alt="" />
          </div>
          <div className="pw-auth-body">
            <Dialog.Close className="pw-modal-close" aria-label="Close account dialog">
              <HugeiconsIcon icon={Cancel01Icon} size={20} />
            </Dialog.Close>
            <Dialog.Title>{signUp ? "Create an account" : "Sign in to PandiWasto"}</Dialog.Title>
            <Dialog.Description>Use your email and password.</Dialog.Description>
            <form onSubmit={submit}>
              <label htmlFor="pw-auth-email">Email</label>
              <input id="pw-auth-email" name="email" type="email" autoComplete={signUp ? "email" : "username"} required />
              <label htmlFor="pw-auth-password">Password</label>
              <div className="pw-password">
                <input id="pw-auth-password" key={signUp ? "new" : "current"} name="password" type={showPassword ? "text" : "password"} autoComplete={signUp ? "new-password" : "current-password"} minLength={signUp ? 8 : undefined} required aria-describedby={signUp ? "pw-password-hint" : undefined} />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>
                  <HugeiconsIcon icon={showPassword ? ViewOffIcon : ViewIcon} size={19} />
                </button>
              </div>
              {signUp && <p className="pw-auth-hint" id="pw-password-hint">Use at least 8 characters.</p>}
              {signUp && (
                <>
                  <label htmlFor="pw-auth-confirm">Confirm password</label>
                  <input id="pw-auth-confirm" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required />
                </>
              )}
              {!authClient && <p className="pw-auth-status">Account access is unavailable in this environment.</p>}
              <button className="pw-modal-submit" disabled={pending || !authClient} type="submit">
                {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
              </button>
              <p className="pw-auth-switch">
                {signUp ? "Already have an account?" : "New to PandiWasto?"}{" "}
                <button type="button" disabled={pending} onClick={() => changeMode(!signUp)}>{signUp ? "Sign in" : "Sign up"}</button>
              </p>
            </form>
            {onPreview && (
              <button className="pw-preview-access" type="button" disabled={pending} onClick={() => { changeMode(false); onPreview(); }}>
                Preview the dashboard
              </button>
            )}
            {error && <p className="pw-auth-status" role="alert">{error}</p>}
            {message && <p className="pw-auth-status" role="status">{message}</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
