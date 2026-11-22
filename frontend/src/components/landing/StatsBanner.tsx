import { BookOpen, FlaskConical, Gamepad2, Trophy } from "lucide-react";

const STATS = [
  { icon: Gamepad2, value: "7", label: "Filipino Minigames" },
  { icon: BookOpen, value: "10", label: "Lesson Topics" },
  { icon: FlaskConical, value: "3", label: "Planned Study Conditions" },
  { icon: Trophy, value: "7", label: "Game Leaderboards" },
];

export function StatsBanner() {
  return (
    <section
      id="impact"
      className="pw-impact py-12 px-6 text-[#17172c]"
    >
      <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-8">
        {STATS.map(({ icon: Icon, value, label }) => (
          <div
            key={label}
            className="flex flex-col items-center text-center gap-2"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/55">
              <Icon size={20} />
            </span>
            <span className="text-3xl sm:text-4xl font-bold tracking-tight">
              {value}
            </span>
            <span className="text-xs sm:text-sm text-[#33304e] font-medium">
              {label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
