import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { authClient } from "@/lib/auth";
import { SignInModal } from "@/components/ui/auth-ui";
import { LandingPage } from "@/pages/LandingPage";
import { AccountHome } from "@/pages/AccountHome";
import { clearRemoteCache } from "@/pages/adminActions";

const LANDING_ANCHORS = ["#home", "#games", "#bkt-engine", "#impact", "#faq", "#main-content"];

function isLandingLocation() {
  return new URLSearchParams(location.search).get("view") === "landing" || LANDING_ANCHORS.includes(location.hash);
}

function updateLocation(home: boolean, replace = false) {
  const url = new URL(location.href);
  if (home) url.searchParams.set("view", "landing");
  else if (url.searchParams.get("view") === "landing") url.searchParams.delete("view");
  if (LANDING_ANCHORS.includes(url.hash)) url.hash = "";
  if (url.href !== location.href) {
    if (replace) history.replaceState(history.state, "", url);
    else history.pushState(null, "", url);
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [showLanding, setShowLanding] = useState(isLandingLocation);
  const [authOpen, setAuthOpen] = useState(false);
  const authTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const subscription = authClient?.onAuthStateChange((_event, nextSession) => {
      // Never show one account's cached staff data to the next account on this device.
      setSession((current) => {
        if (current?.user.id !== nextSession?.user.id) clearRemoteCache();
        return nextSession;
      });
      if (nextSession) setAuthOpen(false);
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    function syncLocation() {
      setShowLanding(isLandingLocation());
    }
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);

  function openAuth() {
    authTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updateLocation(false, true);
    setShowLanding(false);
    setAuthOpen(true);
  }

  function navigateHome(home: boolean) {
    window.scrollTo({ top: 0, behavior: "instant" });
    updateLocation(home);
    setShowLanding(home);
  }

  return (
    <>
      {session && !showLanding
        ? <AccountHome key={session.user.id} user={session.user} onHome={() => navigateHome(true)} />
        : <LandingPage returning={Boolean(session)} onOpenAuth={session ? () => navigateHome(false) : openAuth} />}
      {!session && (
        <SignInModal
          open={authOpen}
          onOpenChange={setAuthOpen}
          returnFocus={() => authTrigger.current?.focus()}
        />
      )}
    </>
  );
}

export default App;
