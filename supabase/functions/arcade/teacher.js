import { z } from "npm:zod@4.6.7";

const uuid = z.uuid();
const date = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const probability = z.number().min(0).max(1);
const skill = z.object({ skillId: z.string(), mastery: probability, attempts: count, mastered: z.boolean() });
const student = z.object({
  id: uuid, name: z.string(), alias: z.string(), avatar: z.string().max(40).nullish(), xp: count, lastActive: date.nullable(), skills: z.array(skill).max(20),
});

export function mountTeacherRoutes(router, route) {
  router.get("/teacher/classes", route({
    name: "pandiwasto_teacher_classes",
    response: z.object({ classes: z.array(z.object({ id: uuid, name: z.string(), students: count })).max(200) }),
  }));

  router.post("/teacher/class", route({
    name: "pandiwasto_teacher_class",
    body: z.strictObject({ classId: uuid }),
    args: (_params, input) => ({ class_id: input.classId }),
    response: z.object({ name: z.string(), students: z.array(student).max(500) }),
  }));

  router.post("/teacher/student", route({
    name: "pandiwasto_teacher_student",
    body: z.strictObject({ classId: uuid, studentId: uuid }),
    args: (_params, input) => ({ class_id: input.classId, student_id: input.studentId }),
    response: student.extend({
      bestScores: z.record(z.string().regex(/^[1-7]$/), count),
      hints: count,
      answers: z.array(z.object({
        gameId: z.number().int().min(1).max(7), skillId: z.string(), item: z.string(), correct: z.boolean(),
        firstAttempt: z.boolean(), hintUsed: z.boolean(), timedOut: z.boolean(), responseMs: count,
        masteryBefore: probability.nullable(), masteryAfter: probability.nullable(), at: date,
      })).max(50),
    }),
  }));
}
