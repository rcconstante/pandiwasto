import { useState, type CSSProperties } from "react";

const ANSWERS = [true, false, true, true, false];
const TICKS = [100, 75, 50, 25, 0];
const PERCENT = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

function demoMastery() {
  // Match the Salitang-Ugat starting parameters seeded by the arcade migration.
  const estimates = [0.25];
  for (const correct of ANSWERS) {
    const prior = estimates[estimates.length - 1];
    const known = prior * (correct ? 0.9 : 0.1);
    const unknown = (1 - prior) * (correct ? 0.1 : 0.9);
    const posterior = known / (known + unknown);
    const learned = posterior + (1 - posterior) * 0.15;
    estimates.push(Number(learned.toFixed(10)));
  }
  return estimates;
}

const ESTIMATES = demoMastery();

function attemptLabel(index: number) {
  if (index === 0) return "Starting estimate";
  return `Attempt ${index} · ${ANSWERS[index - 1] ? "Correct" : "Incorrect"}`;
}

export function MasteryChart() {
  const [selected, setSelected] = useState(2);

  return (
    <figure className="pw-mastery-chart" aria-labelledby="pw-mastery-chart-title">
      <figcaption>
        <h3 id="pw-mastery-chart-title">Estimated mastery</h3>
        <p>Salitang-Ugat · Example practice session</p>
      </figcaption>

      <div className="pw-mastery-plot" role="group" aria-label="Mastery estimates by attempt">
        <div className="pw-mastery-grid" aria-hidden="true">
          {TICKS.map((tick) => <span key={tick}><small>{tick}%</small></span>)}
        </div>
        {ESTIMATES.map((estimate, index) => (
          <button
            key={index}
            type="button"
            style={{ "--mastery-height": `${estimate * 100}%` } as CSSProperties}
            data-answer={index === 0 ? "start" : ANSWERS[index - 1] ? "correct" : "incorrect"}
            aria-label={`${attemptLabel(index)}, ${PERCENT.format(estimate)} estimated mastery`}
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            <span className="pw-mastery-bar" aria-hidden="true" />
            <span className="pw-mastery-x" aria-hidden="true">{index === 0 ? "Start" : index}</span>
          </button>
        ))}
      </div>
      <p className="pw-mastery-axis" aria-hidden="true">Practice attempt</p>
      <p className="pw-mastery-readout" role="status">
        <span>{attemptLabel(selected)}</span> <strong>{PERCENT.format(ESTIMATES[selected])}</strong>
      </p>
    </figure>
  );
}
