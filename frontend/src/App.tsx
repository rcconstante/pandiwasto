import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { authClient } from "@/lib/auth";
import { SignInModal } from "@/components/ui/auth-ui";
import { LandingPage } from "@/pages/LandingPage";
import { Dashboard } from "@/pages/Dashboard";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [preview, setPreview] = useState(false);
  const [showLanding, setShowLanding] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const authTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const subscription = authClient?.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        setPreview(false);
        setAuthOpen(false);
      }
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, []);

  function openAuth() {
    authTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowLanding(false);
    setAuthOpen(true);
  }

  function enterPreview() {
    setAuthOpen(false);
    setPreview(true);
    setShowLanding(false);
  }

  function exitPreview() {
    window.scrollTo({ top: 0, behavior: "instant" });
    setPreview(false);
  }

  function navigateHome(home: boolean) {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
    setShowLanding(home);
  }

  const hasArcade = Boolean(session || preview);

  return (
    <>
      {hasArcade && !showLanding
        ? <Dashboard key={session?.user.id ?? "preview"} user={session?.user} onSignIn={openAuth} onExitPreview={exitPreview} onHome={() => navigateHome(true)} />
        : <LandingPage returning={hasArcade} onOpenAuth={hasArcade ? () => navigateHome(false) : openAuth} />}
      {!session && (
        <SignInModal
          open={authOpen}
          onOpenChange={setAuthOpen}
          onPreview={preview ? undefined : enterPreview}
          returnFocus={() => authTrigger.current?.focus()}
        />
      )}
    </>
  );
}

export default App;
