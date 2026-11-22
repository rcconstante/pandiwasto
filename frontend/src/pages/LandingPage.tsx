import { useEffect, useRef } from "react";
import Lenis from "lenis";
import { Hero, Navigation } from "@/components/ui/saa-s-template";
import { GamesCarousel } from "@/components/landing/GamesCarousel";
import { BktShowcase } from "@/components/landing/BktShowcase";
import { StatsBanner } from "@/components/landing/StatsBanner";
import { Footer } from "@/components/landing/Footer";
import { SitePolicies } from "@/components/landing/SitePolicies";
import { LearningRoutine } from "@/components/landing/LearningRoutine";
import { FrequentlyAskedQuestions } from "@/components/landing/FrequentlyAskedQuestions";
import "lenis/dist/lenis.css";
import "./landing.css";

export function LandingPage({ onOpenAuth, returning }: { onOpenAuth: () => void; returning: boolean }) {
  const landing = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = landing.current;
    if (!page) return;
    const lenis = new Lenis({ autoRaf: true });

    function scrollToSection(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const hash = event.target instanceof Element ? event.target.closest("a")?.getAttribute("href") : null;
      if (!hash?.startsWith("#") || hash.length === 1) return;
      const target = document.getElementById(hash.slice(1));
      if (!target) return;
      event.preventDefault();
      if (location.hash !== hash) history.pushState(null, "", hash);
      if (target.id === "main-content") target.focus({ preventScroll: true });
      lenis.scrollTo(target);
    }

    page.addEventListener("click", scrollToSection);
    return () => {
      page.removeEventListener("click", scrollToSection);
      lenis.destroy();
    };
  }, []);

  return (
    <div ref={landing} id="home" className="pw-page">
      <a className="pw-skip" href="#main-content">Skip to content</a>
      <Navigation onOpenAuth={onOpenAuth} returning={returning} />
      <main id="main-content" tabIndex={-1}>
        <Hero onOpenAuth={onOpenAuth} returning={returning} />
        <GamesCarousel />
        <LearningRoutine />
        <BktShowcase />
        <StatsBanner />
        <FrequentlyAskedQuestions />
      </main>
      <Footer />
      <SitePolicies />
    </div>
  );
}
