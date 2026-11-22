import { Plus } from "lucide-react";
import { Accordion } from "radix-ui";

const questions = [
  {
    id: "skills",
    question: "What can I practice with PandiWasto?",
    answer: "The seven arcade games cover root words, word structure, affixes, compound words, reduplication, verb focus, and assimilation.",
  },
  {
    id: "games",
    question: "Can I try the games on this page?",
    answer: "The landing page lets you browse all seven games and explore what each one teaches without signing in.",
  },
  {
    id: "mastery",
    question: "What is Bayesian Knowledge Tracing?",
    answer: "Bayesian Knowledge Tracing, or BKT, estimates how well you know a skill as you practice. It accounts for lucky guesses and occasional mistakes, so the estimate can change after each answer.",
  },
  {
    id: "hints",
    question: "How do the Filipino hints work?",
    answer: "A hint can point you toward the next step, remind you of a rule, or show how to solve a similar example.",
  },
  {
    id: "account",
    question: "How do I create an account?",
    answer: "Choose Log in at the top of the page, then Sign up. Enter your email and password and follow the confirmation instructions shown on screen.",
  },
];

export function FrequentlyAskedQuestions() {
  return (
    <section id="faq" className="pw-faq" aria-labelledby="faq-title">
      <h2 id="faq-title">Frequently asked questions</h2>
      <Accordion.Root type="single" collapsible className="pw-faq-list">
        {questions.map(({ id, question, answer }) => (
          <Accordion.Item key={id} value={id} className="pw-faq-item">
            <Accordion.Header asChild>
              <h3>
                <Accordion.Trigger className="pw-faq-trigger">
                  <span>{question}</span>
                  <span className="pw-faq-toggle"><Plus size={18} aria-hidden="true" /></span>
                </Accordion.Trigger>
              </h3>
            </Accordion.Header>
            <Accordion.Content className="pw-faq-answer">
              <p>{answer}</p>
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  );
}
