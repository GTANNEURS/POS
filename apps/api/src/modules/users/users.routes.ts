import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import {
  authenticate,
  type AuthenticatedRequest,
  ensureWarehouseAccess,
  getScopedWarehouseId,
  hashPassword,
  requirePermissions
} from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";
import {
  buildAccessMode,
  buildDefaultCashierPinCode,
  buildDefaultManagerUsername,
  readUserLoginProfiles,
  saveUserLoginProfiles,
  sanitizeLoginUsername,
  sanitizePinCode
} from "../../common/user-login-profiles.js";

const userSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6).optional().or(z.literal("")),
  roleNames: z.array(z.string()).min(1),
  isActive: z.boolean().default(true),
  defaultWarehouseId: z.string().nullable().optional(),
  loginUsername: z.string().optional().default(""),
  pinCode: z.string().optional().default("")
});

async function ensureCommandOperatorRole() {
  const permission = await prisma.permission.findUnique({ where: { code: "sales_manage" } });
  if (!permission) return;
  const role = await prisma.role.upsert({
    where: { name: "operateur_commandes" },
    update: { label: "Operateur commandes" },
    create: { name: "operateur_commandes", label: "Operateur commandes" }
  });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { roleId: role.id, permissionId: permission.id }
  });
}

export const usersRouter = Router();
usersRouter.use(authenticate, requirePermissions("users_manage"));

function mapUser(
  user: { id: string; fullName: string; email: string; isActive: boolean; createdAt: Date; updatedAt: Date; defaultWarehouseId: string | null; userRoles: Array<{ role: { name: string } }> },
  profile?: { loginUsername?: string; pinCode?: string }
) {
  const roles = user.userRoles.map((item) => item.role.name);
  const accessMode = buildAccessMode(roles);
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    isActive: user.isActive,
    defaultWarehouseId: user.defaultWarehouseId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    roles,
    loginMode: accessMode,
    loginUsername: accessMode === "manager"
      || accessMode === "operateur"
      ? (sanitizeLoginUsername(profile?.loginUsername || "") || buildDefaultManagerUsername(user.fullName, user.id))
      : "",
    pinCode: accessMode === "caissier"
      ? (sanitizePinCode(profile?.pinCode || "") || buildDefaultCashierPinCode(user.id))
      : ""
  };
}

async function findRoles(roleNames: string[]) {
  const roles = await prisma.role.findMany({ where: { name: { in: roleNames } } });
  if (roles.length !== roleNames.length) throw new AppError("Roles invalides.", 422);
  return roles;
}

usersRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureCommandOperatorRole();
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: scopedWarehouseId ? { defaultWarehouseId: scopedWarehouseId } : undefined,
      orderBy: { createdAt: "desc" },
      include: { userRoles: { include: { role: true } } }
    }),
    readUserLoginProfiles()
  ]);
  const roles = await prisma.role.findMany({ orderBy: { label: "asc" }, include: { rolePermissions: { include: { permission: true } } } });
  const permissions = await prisma.permission.findMany({ orderBy: { label: "asc" } });
  const warehouses = await prisma.warehouse.findMany({
    where: scopedWarehouseId ? { id: scopedWarehouseId } : { type: "STORE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, type: true }
  });
  return ok(res, {
    users: users.map((user) => mapUser(user, profiles.find((profile) => profile.userId === user.id))),
    roles,
    permissions,
    warehouses
  });
}));

usersRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureCommandOperatorRole();
  const payload = userSchema.parse(req.body);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const defaultWarehouseId = scopedWarehouseId || payload.defaultWarehouseId || null;
  if (defaultWarehouseId) {
    ensureWarehouseAccess(req.currentUser, defaultWarehouseId);
  }
  const roles = await findRoles(payload.roleNames);
  const accessMode = buildAccessMode(payload.roleNames);
  const loginUsername = accessMode === "manager" || accessMode === "operateur" ? sanitizeLoginUsername(payload.loginUsername || "") : "";
  const pinCode = accessMode === "caissier" ? sanitizePinCode(payload.pinCode || "") : "";
  const existingProfiles = await readUserLoginProfiles();
  if (loginUsername && existingProfiles.some((profile) => sanitizeLoginUsername(profile.loginUsername || "") === loginUsername)) {
    throw new AppError("Ce nom d'utilisateur existe deja.", 409);
  }
  if (pinCode && existingProfiles.some((profile) => sanitizePinCode(profile.pinCode || "") === pinCode)) {
    throw new AppError("Ce code confidentiel existe deja.", 409);
  }
  const user = await prisma.user.create({
    data: {
      fullName: payload.fullName,
      email: payload.email,
      passwordHash: await hashPassword(payload.password || "ChangeMe123!"),
      isActive: payload.isActive,
      defaultWarehouseId,
      userRoles: { create: roles.map((role) => ({ roleId: role.id })) }
    },
    include: { userRoles: { include: { role: true } } }
  });
  const nextProfile = {
    userId: user.id,
    loginUsername: accessMode === "manager" || accessMode === "operateur" ? (loginUsername || buildDefaultManagerUsername(user.fullName, user.id)) : undefined,
    pinCode: accessMode === "caissier" ? (pinCode || buildDefaultCashierPinCode(user.id)) : undefined
  };
  await saveUserLoginProfiles([
    ...existingProfiles.filter((profile) => profile.userId !== user.id),
    nextProfile
  ]);
  await writeAuditLog({ userId: req.currentUser?.id, action: "users.create", entityType: "user", entityId: user.id, meta: { ...payload, password: undefined } });
  return ok(res, mapUser(user, nextProfile), "Utilisateur cree.");
}));

usersRouter.put("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureCommandOperatorRole();
  const id = String(req.params.id);
  const payload = userSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError("Utilisateur introuvable.", 404);
  if (existing.defaultWarehouseId) {
    ensureWarehouseAccess(req.currentUser, existing.defaultWarehouseId);
  } else if (getScopedWarehouseId(req.currentUser)) {
    throw new AppError("Acces refuse pour cet utilisateur.", 403);
  }
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const defaultWarehouseId = scopedWarehouseId || payload.defaultWarehouseId || null;
  if (defaultWarehouseId) {
    ensureWarehouseAccess(req.currentUser, defaultWarehouseId);
  }
  const roles = await findRoles(payload.roleNames);
  const accessMode = buildAccessMode(payload.roleNames);
  const loginUsername = accessMode === "manager" || accessMode === "operateur" ? sanitizeLoginUsername(payload.loginUsername || "") : "";
  const pinCode = accessMode === "caissier" ? sanitizePinCode(payload.pinCode || "") : "";
  const existingProfiles = await readUserLoginProfiles();
  if (loginUsername && existingProfiles.some((profile) => profile.userId !== id && sanitizeLoginUsername(profile.loginUsername || "") === loginUsername)) {
    throw new AppError("Ce nom d'utilisateur existe deja.", 409);
  }
  if (pinCode && existingProfiles.some((profile) => profile.userId !== id && sanitizePinCode(profile.pinCode || "") === pinCode)) {
    throw new AppError("Ce code confidentiel existe deja.", 409);
  }
  const data: { fullName: string; email: string; isActive: boolean; defaultWarehouseId: string | null; passwordHash?: string } = {
    fullName: payload.fullName,
    email: payload.email,
    isActive: payload.isActive,
    defaultWarehouseId
  };
  if (payload.password) data.passwordHash = await hashPassword(payload.password);

  const user = await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.user.update({ where: { id }, data });
    await tx.userRole.createMany({ data: roles.map((role) => ({ userId: id, roleId: role.id })), skipDuplicates: true });
    return tx.user.findUniqueOrThrow({ where: { id }, include: { userRoles: { include: { role: true } } } });
  });
  const nextProfile = {
    userId: id,
    loginUsername: accessMode === "manager" || accessMode === "operateur" ? (loginUsername || buildDefaultManagerUsername(user.fullName, user.id)) : undefined,
    pinCode: accessMode === "caissier" ? (pinCode || buildDefaultCashierPinCode(user.id)) : undefined
  };
  await saveUserLoginProfiles([
    ...existingProfiles.filter((profile) => profile.userId !== id),
    nextProfile
  ]);

  await writeAuditLog({ userId: req.currentUser?.id, action: "users.update", entityType: "user", entityId: id, meta: { ...payload, password: undefined } });
  return ok(res, mapUser(user, nextProfile), "Utilisateur mis a jour.");
}));

usersRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  if (req.currentUser?.id === id) {
    throw new AppError("Impossible de supprimer l'utilisateur connecte.", 409);
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError("Utilisateur introuvable.", 404);
  if (existing.defaultWarehouseId) {
    ensureWarehouseAccess(req.currentUser, existing.defaultWarehouseId);
  } else if (getScopedWarehouseId(req.currentUser)) {
    throw new AppError("Acces refuse pour cet utilisateur.", 403);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });
  } catch {
    throw new AppError("Suppression impossible. Des operations sont deja liees a cet utilisateur.", 409);
  }

  const existingProfiles = await readUserLoginProfiles();
  await saveUserLoginProfiles(existingProfiles.filter((profile) => profile.userId !== id));
  await writeAuditLog({ userId: req.currentUser?.id, action: "users.delete", entityType: "user", entityId: id, meta: { fullName: existing.fullName, email: existing.email } });
  return ok(res, true, "Utilisateur supprime.");
}));
