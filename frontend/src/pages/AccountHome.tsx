import { lazy, Suspense, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { loadRoles } from "@/lib/arcadeApi";

// Learners never download the staff dashboard, and staff never download the games.
const Dashboard = lazy(async () => ({ default: (await import("./Dashboard")).Dashboard }));
const StaffDashboard = lazy(async () => ({ default: (await import("./StaffDashboard")).StaffDashboard }));

type Roles = { admin: boolean; teacher: boolean };
const rolesKey = (userId: string) => "pw-roles:" + userId;

// Roles only choose which dashboard to draw; the server checks them on every request.
// Remembering them per account skips the blank loading screen on later visits.
function readCachedRoles(userId: string): Roles | null {
  try {
    const value = JSON.parse(localStorage.getItem(rolesKey(userId)) ?? "null");
    return typeof value?.admin === "boolean" && typeof value?.teacher === "boolean" ? value : null;
  } catch {
    return null;
  }
}

const loading = <main className="pw-dashboard pwd-game-loading"><p className="pwd-game-loading-status" role="status"><span className="pwd-game-spinner" aria-hidden="true" /> Loading your account…</p></main>;

/** Teachers and admins get the staff dashboard; everyone else gets the learner arcade. */
export function AccountHome({ user, onHome }: { user: User; onHome: () => void }) {
  const [roles, setRoles] = useState<Roles | null>(() => readCachedRoles(user.id));
  const staff = Boolean(roles?.admin || roles?.teacher);

  useEffect(() => {
    const abort = new AbortController();
    loadRoles(abort.signal).then((next) => {
      setRoles(next);
      try { localStorage.setItem(rolesKey(user.id), JSON.stringify(next)); } catch { /* storage may be blocked */ }
    }).catch(() => { if (!abort.signal.aborted) setRoles((current) => current ?? { admin: false, teacher: false }); });
    return () => abort.abort();
  }, [user.id]);

  // A staff page address (?section=…) left from an earlier sign-in means nothing to a learner.
  useEffect(() => {
    if (!roles || staff) return;
    const url = new URL(location.href);
    if (!url.searchParams.has("section")) return;
    url.searchParams.delete("section");
    history.replaceState(history.state, "", url);
  }, [roles, staff]);

  if (!roles) return loading;
  return (
    <Suspense fallback={loading}>
      {staff ? <StaffDashboard user={user} admin={roles.admin} onHome={onHome} /> : <Dashboard user={user} onHome={onHome} />}
    </Suspense>
  );
}
