import { Brain, MessageSquareHeart, ShieldCheck } from "lucide-react";
import { BKT_PARAMETERS } from "@/data/landingData";
import { MasteryChart } from "./MasteryChart";

const HINT_CONDITIONS = [
  {
    badge: "Condition A",
    title: "BKT-Triggered Hints",
    description: "A wrong answer can trigger a hint when estimated mastery for that skill is below the study threshold.",
  },
  {
    badge: "Condition B",
    title: "Fixed Wrong-Answer Trigger",
    description: "A hint follows two consecutive wrong answers, regardless of the mastery estimate.",
  },
  {
    badge: "Condition C",
    title: "No-Hint Control",
    description: "Students see whether their answer was correct and continue without hints.",
  },
];

export function BktShowcase() {
  return (
    <section id="bkt-engine" className="pw-research" aria-labelledby="pw-research-heading">
      <div className="pw-research-intro">
        <div className="pw-research-copy">
          <p className="pw-research-label"><Brain size={18} aria-hidden="true" /> Bayesian Knowledge Tracing</p>
          <h2 id="pw-research-heading">See which skills students have mastered <span>and where they need help.</span></h2>
          <p>Signed-in practice builds a mastery estimate for each skill. The study compares three ways of offering Filipino hints.</p>
        </div>
        <MasteryChart />
      </div>
      <div className="pw-research-conditions">
        {HINT_CONDITIONS.map((condition) => (
          <article key={condition.badge}>
            <p className="pw-research-condition-label">{condition.badge}</p>
            <h3>{condition.title}</h3>
            <p>{condition.description}</p>
          </article>
        ))}
      </div>
      <dl className="pw-research-parameters" aria-label="Knowledge tracing parameters">
        {BKT_PARAMETERS.map((parameter) => (
          <div key={parameter.symbol}>
            <dt><span>{parameter.symbol}</span> {parameter.name}</dt>
            <dd>{parameter.description}</dd>
          </div>
        ))}
      </dl>
      <div className="pw-research-notes">
        <span><MessageSquareHeart size={17} aria-hidden="true" /> Hints in Filipino</span>
        <span><ShieldCheck size={17} aria-hidden="true" /> Answer checks and authored fallbacks</span>
      </div>
    </section>
  );
}
