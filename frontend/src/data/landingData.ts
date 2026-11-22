export interface MinigameItem {
  id: number;
  lesson: string;
  gameName: string;
  art: string;
  mechanic: string;
  skillTag: string;
  example: string;
  description: string;
  unlockLevel: number;
  accentColor: string;
}

export interface RoleAudienceItem {
  id: string;
  role: string;
  badge: string;
  headline: string;
  description: string;
  highlights: string[];
}

export interface BktParameterItem {
  symbol: string;
  name: string;
  description: string;
}

export const MINIGAMES: MinigameItem[] = [
  {
    id: 1,
    art: "balloons",
    lesson: "Salitang-Ugat",
    gameName: "Pop Goes the Word",
    mechanic: "Pop the Balloon",
    skillTag: "Root Word Identification",
    example: "S U M A K A Y → SAKAY",
    description:
      "Every letter floats on a carnival balloon. Pop the affixes until only the pure Filipino root word remains.",
    unlockLevel: 1,
    accentColor: "#5b5ce6",
  },
  {
    id: 2,
    art: "mole",
    lesson: "Kayarian ng Salita",
    gameName: "Whack-a-Word",
    mechanic: "Whack-a-Mole",
    skillTag: "Payak · Maylapi · Tambalan · Inuulit",
    example: "bahay-kubo → Tambalan",
    description:
      "Words pop up fast—whack the matching word structure category before the mole ducks back underground.",
    unlockLevel: 3,
    accentColor: "#4f46e5",
  },
  {
    id: 3,
    art: "tiles",
    lesson: "Mga Panlapi",
    gameName: "Toss-a-Lapi",
    mechanic: "Supply the Tiles (dnd-kit)",
    skillTag: "Unlapi · Gitlapi · Hulapi · Kabilaan",
    example: "mag- + laro → maglaro",
    description:
      "Drag and drop the missing affix tile into the sentence to practice four types of panlapi.",
    unlockLevel: 5,
    accentColor: "#6366f1",
  },
  {
    id: 4,
    art: "memory",
    lesson: "Tambalan",
    gameName: "Memory Match",
    mechanic: "Match the Cards",
    skillTag: "Compound Word Formation",
    example: "bahay + kubo → bahay-kubo",
    description:
      "Flip and pair up to 20 root-word cards to forge valid Filipino compound words and earn bonus XP.",
    unlockLevel: 7,
    accentColor: "#4338ca",
  },
  {
    id: 5,
    art: "tickets",
    lesson: "Inuulit (Pag-uulit)",
    gameName: "Ticket Stub Dispenser",
    mechanic: "Full vs. Partial Lever",
    skillTag: "Ganap & Parsiyal Reduplication",
    example: "gabi-gabi (ganap) · susulat (parsiyal)",
    description:
      "Read the sentence and pull the lever for two full matching tickets or a full ticket plus a torn partial stub.",
    unlockLevel: 9,
    accentColor: "#5b5ce6",
  },
  {
    id: 6,
    art: "claw",
    lesson: "Pokus ng Pandiwa",
    gameName: "Claw Machine",
    mechanic: "Pick the Verb Focus",
    skillTag: "Actor · Object · Locative · Beneficiary",
    example: "Nagluto si Ana → Pokus sa Tagaganap",
    description:
      "Aim the arcade claw and grab the doll that matches the verb focus required by the Filipino sentence.",
    unlockLevel: 11,
    accentColor: "#4f46e5",
  },
  {
    id: 7,
    art: "fortune",
    lesson: "Asimilasyon",
    gameName: "Fortune Predict",
    mechanic: "Morphophonemic Machine",
    skillTag: "pang- → pam- / pan-",
    example: "pang- + bansa → pambansa",
    description:
      "Feed a root word with pang- into the fortune teller and predict the assimilated form before the card prints.",
    unlockLevel: 13,
    accentColor: "#6366f1",
  },
];

export const ROLE_AUDIENCES: RoleAudienceItem[] = [
  {
    id: "teachers",
    role: "Teachers",
    badge: "Classroom Mastery",
    headline: "See true skill mastery, not just raw scores",
    description:
      "Monitor per-student BKT mastery probabilities across all Filipino morphology skills and spot who needs targeted support.",
    highlights: [
      "Skill-by-skill mastery estimates",
      "Separates lucky guesses from real learning",
      "Class-ready XP & level progression",
    ],
  },
  {
    id: "writers",
    role: "Writers",
    badge: "Filipino Craft",
    headline: "Author grounded, grade-appropriate Filipino items",
    description:
      "Craft sentence prompts, root-word pairs, and progressive Filipino hints that respect lesson terminology without giving away answers.",
    highlights: [
      "Curated rule-bank hint templates",
      "Nudge → rule reminder → worked example",
      "Natural Tagalog & Filipino morphology",
    ],
  },
  {
    id: "researchers",
    role: "Researchers",
    badge: "Controlled Validation",
    headline: "Connect BKT diagnosis to LLM intervention",
    description:
      "Run clean A/B/C study conditions—BKT-triggered hints, fixed wrong-answer triggers, or no-hint control—with full attempt replay logs.",
    highlights: [
      "AUC, RMSE & normalized learning gain",
      "Server-side hidden condition assignment",
      "Pseudonymized export for analysis",
    ],
  },
  {
    id: "content-teams",
    role: "Content Teams",
    badge: "Curriculum Ops",
    headline: "Tag every minigame item to one exact skill",
    description:
      "Manage item banks across all seven arcade mechanics while keeping guess/slip priors calibrated and fallback hints ready.",
    highlights: [
      "1-to-1 item-to-skill tagging",
      "Pre-written fallback hints for reliability",
      "Swappable LLM & local-first workflow",
    ],
  },
];

export const BKT_PARAMETERS: BktParameterItem[] = [
  {
    symbol: "P(L0)",
    name: "Initial Knowledge",
    description: "Probability the learner already knows the skill before the first attempt.",
  },
  {
    symbol: "P(T)",
    name: "Learning Rate",
    description: "Probability of transitioning from unlearned to learned after each practice item.",
  },
  {
    symbol: "P(G)",
    name: "Guess Prior",
    description: "Probability of answering correctly without knowing the skill (calibrated per game).",
  },
  {
    symbol: "P(S)",
    name: "Slip Prior",
    description: "Probability of making a mistake despite having already mastered the skill.",
  },
];
