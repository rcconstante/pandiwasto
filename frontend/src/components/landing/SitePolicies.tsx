import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, CookieIcon } from "@hugeicons/core-free-icons";
import { Dialog } from "radix-ui";

const NOTICE_COOKIE = "pw_cookie_notice";

const policies = {
  terms: {
    title: "Terms and Conditions",
    sections: [
      ["Using PandiWasto", "PandiWasto is a Filipino morphology learning tool. Its practice activities and skill estimates are intended to support learning and classroom judgment."],
      ["Your account", "Use an email address you control and keep your password private. If you use PandiWasto as part of a class, follow your school’s instructions for using the platform."],
      ["Fair use", "Respect other learners, use only accounts and content you have permission to access, and avoid disrupting the platform."],
    ],
  },
  privacy: {
    title: "Privacy Notice",
    sections: [
      ["Account information", "When you sign up or sign in, the form sends your email and password to Supabase Auth to create or verify your account. PandiWasto does not write your password to browser storage."],
      ["Browser storage", "Supabase Auth remembers your session on this device. PandiWasto uses browser storage for Preview and device practice progress, and saves a cookie when you acknowledge the cookie notice."],
      ["Profile details", "Settings saves the profile details you choose to provide, including optional gender, to your account or to this browser in Preview. Rankings uses a generated alias and game scores."],
      ["Account play", "When account play is available, the arcade saves your answers, game results, and skill estimates to your account."],
      ["Rankings", "Signed-in learners can see generated player aliases and best game scores. Rankings use a separate alias from your editable profile name."],
      ["Shared devices", "Sign out when you finish on a shared device. You can remove this site’s stored browser data in your browser settings. Clearing browser data does not delete your account."],
    ],
  },
  cookies: {
    title: "Cookies and Browser Storage",
    sections: [
      ["Cookie notice", "The site saves your acknowledgement for 180 days in an essential preference cookie. You can remove it by clearing this site’s cookies in your browser."],
      ["Sign-in storage", "If you sign in, Supabase Auth uses browser local storage to keep you signed in. Sign out to remove the session from this browser."],
    ],
  },
};

function currentPolicy(): keyof typeof policies | null {
  const key = window.location.hash.slice(1);
  return key === "terms" || key === "privacy" || key === "cookies" ? key : null;
}

export function SitePolicies() {
  const [policy, setPolicy] = useState(currentPolicy);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState(() => !document.cookie.split(";").some((cookie) => cookie.trim() === `${NOTICE_COOKIE}=1`));
  useEffect(() => {
    const update = () => {
      const next = currentPolicy();
      if (next && document.activeElement instanceof HTMLElement) previousFocus.current = document.activeElement;
      setPolicy(next);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  function acknowledge() {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${NOTICE_COOKIE}=1; Max-Age=15552000; Path=/; SameSite=Lax${secure}`;
    setNotice(false);
  }

  const selected = policy ? policies[policy] : null;
  return (
    <>
      {notice && (
        <aside className="pw-cookie" aria-label="Cookie notice">
          <HugeiconsIcon icon={CookieIcon} size={22} aria-hidden="true" />
          <p>We use essential browser storage. <a href="#cookies">Cookie details</a></p>
          <button type="button" onClick={acknowledge}>Got it</button>
        </aside>
      )}
      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => {
        if (!open) {
          history.replaceState(history.state, "", location.pathname + location.search);
          setPolicy(null);
        }
      }}>
        {selected && (
          <Dialog.Portal>
            <Dialog.Overlay className="pw-modal-overlay" />
            <Dialog.Content className="pw-modal pw-policy" data-lenis-prevent aria-describedby={undefined} onCloseAutoFocus={(event) => {
              event.preventDefault();
              previousFocus.current?.focus();
            }}>
              <Dialog.Close className="pw-modal-close" aria-label="Close policy">
                <HugeiconsIcon icon={Cancel01Icon} size={20} />
              </Dialog.Close>
              <Dialog.Title>{selected.title}</Dialog.Title>
              {selected.sections.map(([title, description]) => (
                <section key={title}>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </section>
              ))}
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </Dialog.Root>
    </>
  );
}
