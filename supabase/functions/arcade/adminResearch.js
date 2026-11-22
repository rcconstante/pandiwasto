import { z } from "npm:zod@4.6.7";

const uuid = z.uuid();
const date = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const choice = z.string().trim().min(1).max(120);
const phase = z.enum(["pre", "post"]);
const dataset = z.enum(["assessment", "attempt"]);
const skillId = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const emptyBody = z.strictObject({});
const playerLookup = z.string().trim().pipe(z.union([uuid, z.string().regex(/^Player [0-9a-f]{10}$/i)]));
const cohortBody = z.strictObject({
  title: z.string().trim().min(1).max(100),
  protocol: z.string().trim().min(1).max(60),
  approvalReference: z.string().trim().min(1).max(120),
  information: z.string().trim().min(1).max(1200),
  opensAt: date,
  posttestAt: date,
  closesAt: date,
}).refine((value) => Date.parse(value.opensAt) < Date.parse(value.posttestAt)
  && Date.parse(value.posttestAt) < Date.parse(value.closesAt), "Enter dates in study order.");

const studyState = z.object({
  state: z.enum(["unavailable", "invited", "scheduled", "pretest", "practice", "posttest", "completed", "closed"]),
  title: z.string().optional(),
  information: z.string().optional(),
  protocol: z.string().optional(),
  opensAt: date.optional(),
  posttestAt: date.optional(),
  closesAt: date.optional(),
  canWithdraw: z.boolean().optional(),
  questions: z.array(z.object({ id: uuid, prompt: z.string(), choices: z.array(z.string()).length(3) })).max(40).optional(),
});

const exportIdentity = z.object({ participantId: uuid, condition: z.enum(["A", "B", "C"]) });
const assessments = exportIdentity.extend({ phase, points: count, total: count });
const attempts = exportIdentity.extend({
  gameId: z.number().int().min(1).max(7),
  runId: uuid,
  move: count,
  observation: count,
  item: z.string(),
  skill: skillId,
  itemVersion: count,
  correct: z.boolean(),
  firstAttempt: z.boolean(),
  hintUsed: z.boolean(),
  timedOut: z.boolean(),
  responseMs: count,
  masteryBefore: z.number().min(0).max(1).nullable(),
  masteryAfter: z.number().min(0).max(1).nullable(),
});

export function mountAdminResearch(router, route) {
  router.post("/admin/scores/lookup", route({
    name: "pandiwasto_admin_score_lookup",
    body: z.strictObject({
      gameId: z.number().int().min(1).max(7),
      lookup: playerLookup,
    }),
    args: (_params, input) => ({ game: input.gameId, lookup: input.lookup }),
    response: z.object({ accountId: uuid, alias: z.string(), score: count, hidden: z.boolean() }),
  }));

  router.get("/admin/study", route({
    name: "pandiwasto_admin_study_list",
    response: z.object({ cohorts: z.array(z.object({
      id: uuid, title: z.string(), protocol: z.string(), opensAt: date, posttestAt: date, closesAt: date,
      preCount: count, postCount: count, participants: count, sealed: z.boolean(),
    })).max(100) }),
  }));

  router.post("/admin/study/create", route({
    name: "pandiwasto_admin_study_create", body: cohortBody,
    args: (_params, input) => ({
      title: input.title, protocol: input.protocol, approval_reference: input.approvalReference,
      information: input.information, opens_at: input.opensAt, posttest_at: input.posttestAt, closes_at: input.closesAt,
    }),
    response: z.object({ cohortId: uuid }),
  }));

  router.post("/admin/study/question", route({
    name: "pandiwasto_admin_study_question",
    body: z.strictObject({
      cohortId: uuid, phase, skillId, prompt: z.string().trim().min(1).max(300),
      choices: z.array(choice).length(3).refine((items) => new Set(items.map((item) => item.toLowerCase())).size === 3),
      answer: z.number().int().min(0).max(2),
    }),
    args: (_params, input) => ({
      study_id: input.cohortId, form: input.phase, skill: input.skillId, question: input.prompt,
      choices: input.choices, answer_index: input.answer,
    }),
    response: z.object({ questionId: uuid }),
  }));

  router.post("/admin/study/participant", route({
    name: "pandiwasto_admin_study_invite",
    body: z.strictObject({ cohortId: uuid, lookup: playerLookup, consentKind: z.enum(["adult", "guardian"]), verified: z.literal(true) }),
    args: (_params, input) => ({ study_id: input.cohortId, target_lookup: input.lookup, consent_type: input.consentKind }),
    response: z.object({ invited: z.literal(true) }),
  }));

  router.post("/admin/study/export", route({
    name: "pandiwasto_admin_study_export",
    body: z.strictObject({ cohortId: uuid, dataset, page: z.number().int().min(0).max(10000) }),
    args: (_params, input) => ({ study_id: input.cohortId, dataset: input.dataset, page_number: input.page }),
    response: z.object({ records: z.array(z.union([assessments, attempts])).max(200), hasMore: z.boolean() }),
  }));

  router.get("/study/status", route({ name: "pandiwasto_study_status", response: studyState }));
  router.post("/study/consent", route({
    name: "pandiwasto_study_consent", body: z.strictObject({ participate: z.literal(true) }), response: studyState,
  }));
  router.post("/study/withdraw", route({ name: "pandiwasto_study_withdraw", body: emptyBody, response: studyState }));
  router.post("/study/assessment/:phase/submit", route({
    name: "pandiwasto_study_submit", params: z.strictObject({ phase }),
    body: z.strictObject({ choices: z.array(z.strictObject({ itemId: uuid, choice: z.number().int().min(0).max(2) })).min(1).max(40) })
      .refine(({ choices }) => new Set(choices.map((item) => item.itemId)).size === choices.length),
    args: (params, input) => ({ form: params.phase, responses: input.choices }),
    response: studyState,
  }));
}
