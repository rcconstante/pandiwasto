import { useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import heroDashboard from "@/assets/images/dashboard-screenshot.webp";
import { BrandLogo } from "@/components/ui/BrandLogo";

import {
  BktDiagnosisIcon,
  LlmHintsIcon,
  MasteryTargetIcon,
} from "@/components/ui/FeatureIcons";

const LINKS = [
  { href: "#games", label: "7 Minigames" },
  { href: "#bkt-engine", label: "BKT & Hints" },
  { href: "#impact", label: "Research" },
  { href: "#faq", label: "FAQ" },
];

export function Navigation({ onOpenAuth, returning }: { onOpenAuth: () => void; returning: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="pw-header">
      <nav aria-label="Main navigation" className="pw-nav">
        <a href="#home" className="pw-brand" aria-label="PandiWasto home">
          <BrandLogo tagline />
        </a>
        <div id="landing-nav-links" className="pw-nav-links" data-open={menuOpen}>
          {LINKS.map(({ href, label }) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
        </div>
        <div className="pw-nav-actions">
          {!returning && <button className="pw-button pw-button-light" type="button" onClick={onOpenAuth}>Log in</button>}
          <button type="button" className="pw-button pw-button-primary pw-header-action" onClick={onOpenAuth}>{returning ? "Back to games" : "Get Started"}</button>
          <button
            type="button"
            className="pw-menu"
            aria-expanded={menuOpen}
            aria-controls="landing-nav-links"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <HugeiconsIcon icon={menuOpen ? Cancel01Icon : Menu01Icon} size={22} />
          </button>
        </div>
      </nav>
    </header>
  );
}

const LEFT_FEATURES = [
  { icon: <BktDiagnosisIcon aria-hidden="true" className="size-8" />, label: "BKT Skill Diagnosis" },
  { icon: <LlmHintsIcon aria-hidden="true" className="size-8" />, label: "Targeted LLM Hints" },
  { icon: <img src={`${import.meta.env.BASE_URL}dashboard/games.webp`} width="32" height="32" alt="" />, label: "7 Arcade Minigames" },
];

const RIGHT_FEATURES = [
  { icon: <img src={`${import.meta.env.BASE_URL}dashboard/lessons.webp`} width="32" height="32" alt="" />, label: "Filipino Morpolohiya" },
  { icon: <MasteryTargetIcon aria-hidden="true" className="size-8" />, label: "Mastery Thresholds" },
  { icon: <img src={`${import.meta.env.BASE_URL}dashboard/rankings.webp`} width="32" height="32" alt="" />, label: "XP & Level Unlocks" },
];

const TOPICS = ["Salitang-Ugat", "Kayarian ng Salita", "Mga Panlapi", "BKT + Filipino Hints"];

function FeatureRail({ features, side }: { features: { icon: ReactNode; label: string }[]; side: "left" | "right" }) {
  return (
    <ul className={`pw-feature-rail pw-feature-rail-${side}`} aria-label={side === "left" ? "Learning tools" : "Learning progress"}>
      {features.map(({ icon, label }) => (
        <li key={label} className="pw-feature">
          <span className="pw-feature-icon">{icon}</span>
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

export function Hero({ onOpenAuth, returning }: { onOpenAuth: () => void; returning: boolean }) {
  return (
    <section className="pw-hero" aria-labelledby="hero-title">
      <p className="pw-hero-context">
        <span>Gamified Filipino Morphology · BKT Knowledge Tracing</span>
        <a href="#bkt-engine">How it works</a>
      </p>
      <h1 id="hero-title">Master Filipino Word Formation <span>5x Smarter</span> with PandiWasto</h1>
      <ul className="pw-topics" aria-label="Practice topics">
        {TOPICS.map((topic) => <li key={topic}>{topic}</li>)}
      </ul>
      <div className="pw-hero-actions">
        <a className="pw-button pw-button-light" href="#games">Explore 7 Games</a>
        <button type="button" className="pw-button pw-button-primary" onClick={onOpenAuth}>
          {returning ? "Back to games" : "Get Started Free"} <HugeiconsIcon icon={ArrowRight01Icon} size={17} />
        </button>
      </div>
      <div className="pw-dashboard-showcase" aria-label="PandiWasto dashboard screenshot">
        <FeatureRail features={LEFT_FEATURES} side="left" />
        <div className="pw-screen">
          <img
            src={heroDashboard}
            alt="PandiWasto dashboard with the Games tab open and Pop Goes the Word selected"
            width={1320}
            height={930}
            fetchPriority="high"
          />
        </div>
        <FeatureRail features={RIGHT_FEATURES} side="right" />
      </div>
    </section>
  );
}
