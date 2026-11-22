const steps = [
  {
    name: "Play",
    art: "landing/balloons.webp",
    title: "Start with a quick game.",
    description: "Practice one Filipino word skill at a time, from spotting a root word to matching compound words.",
  },
  {
    name: "Get a hint",
    art: "landing/tiles.webp",
    title: "Take another look.",
    description: "A Filipino hint can offer a nudge, a rule reminder, or a worked example when you get stuck.",
  },
  {
    name: "Build mastery",
    art: "pandiwasto-mascot.webp",
    title: "See what to practice next.",
    description: "Skill estimates update with practice so you can see what’s getting easier and what needs another round.",
  },
];

export function LearningRoutine() {
  return (
    <section id="routine" className="pw-routine" aria-labelledby="routine-title">
      <h2 id="routine-title">A little perspective.<br />That’s all you need.</h2>
      <ol className="pw-routine-steps">
        {steps.map((step) => (
          <li key={step.name}>
            <div className="pw-routine-orb">
              <img src={`${import.meta.env.BASE_URL}${step.art}`} alt="" width="192" height="192" loading="lazy" />
              <span>{step.name}</span>
            </div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
