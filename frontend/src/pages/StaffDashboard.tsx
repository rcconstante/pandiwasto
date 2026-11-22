import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { BarChart3, ChevronDown, FlaskConical, GraduationCap, LayoutDashboard, LogOut, SlidersHorizontal, Trophy, Users, type LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { authClient } from "@/lib/auth";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { readProfile } from "@/data/dashboardProfile";
import { AdminAccounts } from "./AdminAccounts";
import { AdminClasses } from "./AdminClasses";
import { AdminSettings } from "./AdminSettings";
import { AdminOverview, AdminScores, AdminStudy } from "./DashboardAdmin";
import { DashboardTeacher } from "./DashboardTeacher";
import { StaffRankings } from "./StaffRankings";
import { Avatar, Notice } from "./StaffKit";
import "./dashboard.css";
import "./staff.css";

type SectionId = "overview" | "progress" | "classes" | "rankings" | "accounts" | "study" | "settings";
interface Section {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  adminOnly: boolean;
}

const SECTIONS: Section[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, adminOnly: true },
  { id: "progress", label: "Class progress", icon: BarChart3, adminOnly: false },
  { id: "classes", label: "Classes", icon: GraduationCap, adminOnly: false },
  { id: "rankings", label: "Rankings", icon: Trophy, adminOnly: false },
  { id: "accounts", label: "Accounts", icon: Users, adminOnly: true },
  // Study stays admin-only: it holds consent records and blinded group assignments.
  { id: "study", label: "Study", icon: FlaskConical, adminOnly: true },
  { id: "settings", label: "Settings", icon: SlidersHorizontal, adminOnly: true },
];

// The open section lives in the URL (?section=accounts) so reloads and shared links keep it.
function sectionFromUrl(sections: Section[]) {
  const wanted = new URLSearchParams(location.search).get("section");
  return sections.find((section) => section.id === wanted)?.id ?? sections[0].id;
}

/** Dashboard for teachers and admins: no games, levels, or greetings. */
export function StaffDashboard({ user, admin, onHome }: { user: User; admin: boolean; onHome: () => void }) {
  const sections = SECTIONS.filter((section) => admin || !section.adminOnly);
  const [active, setActive] = useState<SectionId>(() => sectionFromUrl(sections));
  const [signOutError, setSignOutError] = useState(false);
  const profile = readProfile(user);
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.displayName || user.email || "Staff";
  const firstName = profile.firstName || fullName.split(/\s+/)[0];
  const role = admin ? "Admin" : "Teacher";

  useEffect(() => {
    const sync = () => setActive(sectionFromUrl(SECTIONS.filter((section) => admin || !section.adminOnly)));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [admin]);

  function open(id: SectionId) {
    const url = new URL(location.href);
    url.searchParams.set("section", id);
    history.pushState(null, "", url);
    setActive(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function signOut() {
    setSignOutError(false);
    const result = await authClient?.signOut({ scope: "local" }).catch((error: unknown) => ({ error }));
    if (result?.error) setSignOutError(true);
  }

  return (
    <div className="staff">
      <header className="st-header">
        <div className="st-header-inner">
          <button type="button" className="pw-brand" onClick={onHome} aria-label="PandiWasto home">
            <BrandLogo />
          </button>
          <nav className="st-nav" aria-label="Dashboard">
            {sections.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-current={id === active ? "page" : undefined} onClick={() => open(id)}>
                {id === active && <Icon size={16} aria-hidden="true" />}
                {label}
              </button>
            ))}
          </nav>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="st-profile" aria-label={`Account menu for ${fullName}`}>
              <Avatar name={fullName} size={36} />
              <span className="st-profile-name">{firstName}</span>
              <ChevronDown size={15} aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="st-menu" align="end" sideOffset={8}>
                <DropdownMenu.Label className="st-menu-label">
                  <strong>{fullName}</strong>
                  <span>{user.email}</span>
                  <span className="st-role">{role}</span>
                </DropdownMenu.Label>
                <DropdownMenu.Separator className="st-menu-separator" />
                <DropdownMenu.Item className="st-menu-item" onSelect={() => void signOut()}>
                  <LogOut size={16} aria-hidden="true" /> Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>
      <main className="st-main">
        {signOutError && <Notice message={{ text: "We couldn’t sign you out. Try again.", error: true }} />}
        {active === "overview" && <AdminOverview onOpen={open} />}
        {active === "progress" && <DashboardTeacher />}
        {active === "classes" && <AdminClasses admin={admin} />}
        {active === "rankings" && <><StaffRankings />{admin && <AdminScores />}</>}
        {active === "accounts" && <AdminAccounts />}
        {active === "study" && <AdminStudy />}
        {active === "settings" && <AdminSettings />}
      </main>
    </div>
  );
}
