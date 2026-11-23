/** Short usability survey (1–5 agreement) shown after the post-assessment and to teachers. */
export interface SurveyItem {
  id: string;
  prompt: string;
}

export const SURVEY_SCALE = {
  student: ["Hindi sang-ayon", "Medyo hindi", "Hindi tiyak", "Medyo sang-ayon", "Sang-ayon"],
  teacher: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
} as const;

export const STUDENT_SURVEY: SurveyItem[] = [
  { id: "easy_to_use", prompt: "Madaling gamitin ang PandiWasto." },
  { id: "fun", prompt: "Nasiyahan ako sa paglalaro ng mga laro." },
  { id: "hints_helped", prompt: "Nakatulong sa akin ang mga pahiwatig." },
  { id: "learned", prompt: "Mas naunawaan ko ang panlapi, pag-uulit, at tambalan." },
  { id: "want_more", prompt: "Gusto ko pang gamitin ang PandiWasto sa pag-aaral." },
];

export const TEACHER_SURVEY: SurveyItem[] = [
  { id: "would_use", prompt: "I would use PandiWasto with my classes." },
  { id: "mastery_useful", prompt: "The mastery view helps me see which skills students need." },
  { id: "hints_accurate", prompt: "The hints are accurate and suitable for my students." },
  { id: "easy_to_manage", prompt: "Managing classes and students is easy." },
  { id: "fits_lessons", prompt: "The games fit the morphology lessons I teach." },
];
