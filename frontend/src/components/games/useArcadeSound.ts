import { useCallback, useEffect, useRef, useState } from "react";

type ArcadeSound = "tap" | "pop" | "correct" | "miss";

function playTone(context: AudioContext, start: number, from: number, to: number, duration = 0.18) {
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + duration / 2);
  volume.gain.setValueAtTime(0.001, start);
  volume.gain.exponentialRampToValueAtTime(0.18, start + 0.014);
  volume.gain.exponentialRampToValueAtTime(0.001, start + duration - 0.01);
  oscillator.connect(volume).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

export function useArcadeSound() {
  const [muted, setMuted] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => () => {
    void audio.current?.close().catch(() => {});
    audio.current = null;
  }, []);

  const play = useCallback((effect: ArcadeSound = "tap", enabled = !muted) => {
    if (!enabled || typeof AudioContext === "undefined") return;
    try {
      audio.current ??= new AudioContext();
      const context = audio.current;
      void context.resume().catch(() => {});
      const start = context.currentTime;
      if (effect === "correct") {
        playTone(context, start, 523, 659);
        playTone(context, start + 0.115, 659, 784);
        playTone(context, start + 0.23, 784, 1047);
      } else if (effect === "miss") {
        playTone(context, start, 320, 225);
      } else if (effect === "pop") {
        playTone(context, start, 700, 105, 0.095);
      } else {
        playTone(context, start, 480, 140);
      }
    } catch {
      // A browser that blocks audio can still play the game.
    }
  }, [muted]);

  function toggleSound() {
    if (muted) play("tap", true);
    setMuted(!muted);
  }

  return { muted, play, toggleSound };
}
