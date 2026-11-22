import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MINIGAMES } from "@/data/landingData";

const VISIBLE_SLOTS = 4;

export function GamesCarousel() {
  const [{ firstIndex, direction }, setPosition] = useState({ firstIndex: 0, direction: 0 });

  function move(direction: -1 | 1) {
    setPosition(({ firstIndex }) => ({
      firstIndex: (firstIndex + direction + MINIGAMES.length) % MINIGAMES.length,
      direction,
    }));
  }

  return (
    <section id="games" className="pw-games" aria-labelledby="games-title" aria-roledescription="carousel">
      <h2 id="games-title">Seven lessons, seven arcade games.</h2>
      <div className="pw-carousel">
        <button type="button" className="pw-carousel-arrow" aria-label="Previous minigame" aria-controls="game-cards" onClick={() => move(-1)}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>

        <ul key={firstIndex} id="game-cards" className="pw-game-track" data-direction={direction || undefined} aria-label="Minigames">
          {Array.from({ length: VISIBLE_SLOTS }, (_, offset) => {
            const index = (firstIndex + offset) % MINIGAMES.length;
            const game = MINIGAMES[index];
            return (
              <li className="pw-game-card" key={game.id}>
                <span className="pw-game-lesson">{game.lesson}</span>
                <img src={`${import.meta.env.BASE_URL}landing/${game.art}.webp`} alt="" width="444" height="444" />
                <h3 className="pw-game-name">{game.gameName}</h3>
              </li>
            );
          })}
        </ul>

        <button type="button" className="pw-carousel-arrow" aria-label="Next minigame" aria-controls="game-cards" onClick={() => move(1)}>
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="sr-only" role="status">
        First card: {MINIGAMES[firstIndex].gameName}, game {firstIndex + 1} of {MINIGAMES.length}.
      </p>
    </section>
  );
}
