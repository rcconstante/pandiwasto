import { z } from "npm:zod@4.6.7";

const uuid = z.uuid();
const date = z.iso.datetime({ offset: true });
const role = z.enum(["student", "teacher", "admin"]);
const name = (max) => z.string().trim().max(max);
const lookup = z.string().trim().min(1).max(254);

const account = z.object({
  id: uuid, email: z.string(), displayName: z.string(), firstName: z.string(), lastName: z.string(), avatar: z.string().max(40).nullish(),
  role, suspended: z.boolean(), createdAt: date, lastSignInAt: date.nullable(),
});
const classSummary = z.object({
  id: uuid, name: z.string(), teacherId: uuid.nullable(), teacherName: z.string().nullable(), students: z.number().int().nonnegative(),
});

export function mountAdminAccounts(router, { ArcadeError, route }) {
  async function requireAdmin(rpc) {
    const roles = await rpc("pandiwasto_roles");
    if (roles?.admin !== true) throw new ArcadeError(403, "You do not have access to this action.");
  }

  function authFailure(error) {
    if (error?.status === 422 || error?.code === "email_exists") throw new ArcadeError(409, "An account with this email already exists.");
    throw new ArcadeError(503, "Account service is unavailable. Try again shortly.");
  }

  router.post("/admin/accounts/list", route({
    name: "pandiwasto_admin_accounts",
    body: z.strictObject({ search: z.string().trim().max(120), page: z.number().int().min(0).max(1000) }),
    args: (_params, input) => ({ search: input.search, page_number: input.page }),
    response: z.object({ accounts: z.array(account).max(25), hasMore: z.boolean() }),
  }));

  router.post("/admin/accounts/create", async ({ body, rpc, json, authAdmin }) => {
    const input = z.strictObject({
      email: z.email().max(254), password: z.string().min(8).max(72),
      firstName: name(40).min(1), lastName: name(40).min(1), displayName: name(24).min(1), role,
    }).safeParse(body);
    if (!input.success) throw new ArcadeError(400, "Invalid arcade request.");
    await requireAdmin(rpc);
    const { email, password, firstName, lastName, displayName } = input.data;
    const { data, error } = await authAdmin.createUser({
      email, password, email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, display_name: displayName, profile_visibility: "private" },
    });
    if (error || !data?.user?.id) authFailure(error);
    await rpc("pandiwasto_admin_set_role", { target_account_id: data.user.id, new_role: input.data.role, created: true });
    return json({ accountId: data.user.id });
  });

  router.post("/admin/accounts/role", route({
    name: "pandiwasto_admin_set_role",
    body: z.strictObject({ accountId: uuid, role }),
    args: (_params, input) => ({ target_account_id: input.accountId, new_role: input.role, created: false }),
    response: z.object({ role }),
  }));

  router.post("/admin/accounts/suspend", async ({ body, rpc, json, authAdmin }) => {
    const input = z.strictObject({ accountId: uuid, suspended: z.boolean() }).safeParse(body);
    if (!input.success) throw new ArcadeError(400, "Invalid arcade request.");
    // The database checks admin access and the target before Auth changes anything.
    await rpc("pandiwasto_admin_suspension", { target_account_id: input.data.accountId, suspend: input.data.suspended });
    const { error } = await authAdmin.updateUserById(input.data.accountId, { ban_duration: input.data.suspended ? "876000h" : "none" });
    if (error) authFailure(error);
    return json({ suspended: input.data.suspended });
  });

  const probability = z.number().min(0).max(1);
  router.get("/admin/skills", route({
    name: "pandiwasto_admin_skills",
    response: z.object({ skills: z.array(z.object({
      skillId: z.string(), initial: probability, learn: probability, guess: probability, slip: probability,
      masteryThreshold: probability, paramVersion: z.number().int().positive(), updatedAt: z.iso.datetime({ offset: true }).nullable(),
    })).max(40) }),
  }));

  router.post("/admin/skills/update", route({
    name: "pandiwasto_admin_skill_update",
    body: z.strictObject({
      skillId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), initial: z.number().min(0.01).max(0.99), learn: z.number().min(0).max(0.99),
      guess: z.number().gt(0).lt(1), slip: z.number().gt(0).lt(0.5), masteryThreshold: z.number().gt(0.5).max(1),
    }),
    args: (_params, input) => ({
      skill: input.skillId, initial: input.initial, learn: input.learn, guess: input.guess, slip: input.slip, threshold: input.masteryThreshold,
    }),
    response: z.object({ paramVersion: z.number().int().positive() }),
  }));

  router.get("/admin/classes", route({
    name: "pandiwasto_admin_classes",
    response: z.object({
      classes: z.array(classSummary).max(200),
      teachers: z.array(z.object({ id: uuid, name: z.string() })).max(500),
    }),
  }));

  router.post("/admin/classes/save", route({
    name: "pandiwasto_admin_class_save",
    body: z.strictObject({ classId: uuid.nullable(), name: name(80).min(1), teacherId: uuid.nullable() }),
    args: (_params, input) => ({ class_id: input.classId, class_name: input.name, teacher: input.teacherId }),
    response: z.object({ classId: uuid }),
  }));

  router.post("/admin/classes/delete", route({
    name: "pandiwasto_admin_class_delete",
    body: z.strictObject({ classId: uuid }),
    args: (_params, input) => ({ class_id: input.classId }),
    response: z.object({ deleted: z.literal(true) }),
  }));

  router.post("/admin/classes/member", route({
    name: "pandiwasto_admin_class_member",
    body: z.strictObject({ classId: uuid, lookup, add: z.boolean() }),
    args: (_params, input) => ({ class_id: input.classId, target_lookup: input.lookup, add_member: input.add }),
    response: z.object({ students: z.number().int().nonnegative() }),
  }));
}
