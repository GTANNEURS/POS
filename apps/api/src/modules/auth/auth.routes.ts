import { Router } from "express";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { issueAuthTokens, serializeUser, verifyPassword } from "../../common/auth.js";
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

const loginSchema = z.union([
  z.object({ loginType: z.literal("admin"), email: z.string().email(), password: z.string().min(6) }),
  z.object({ loginType: z.literal("manager"), username: z.string().min(2), password: z.string().min(6) }),
  z.object({ loginType: z.literal("caissier"), code: z.string().min(4) }),
  z.object({ email: z.string().email(), password: z.string().min(6) }).transform((payload) => ({ loginType: "admin" as const, ...payload }))
]);
export const authRouter = Router();

function buildRefreshCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: env.secureCookies,
    maxAge: env.refreshTtlDays * 24 * 60 * 60 * 1000,
    path: "/api/auth",
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {})
  };
}

const changeCashierCodeSchema = z.object({
  currentCode: z.string().min(4),
  nextCode: z.string().min(4),
  confirmCode: z.string().min(4)
});

authRouter.post("/login", asyncHandler(async (req, res) => {
  const payload = loginSchema.parse(req.body);
  let user = null as Awaited<ReturnType<typeof prisma.user.findUnique>> | null;

  if (payload.loginType === "admin") {
    user = await prisma.user.findUnique({ where: { email: payload.email } });
    if (!user || !user.isActive || !(await verifyPassword(payload.password, user.passwordHash))) {
      throw new AppError("Identifiants invalides.", 401);
    }
  }

  if (payload.loginType === "manager") {
    const username = sanitizeLoginUsername(payload.username.replace(/^MGR[-:]/i, ""));
    const [users, profiles] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true, userRoles: { some: { role: { name: { in: ["manager", "operateur_commandes"] } } } } },
        include: { userRoles: { include: { role: true } } }
      }),
      readUserLoginProfiles()
    ]);
    user = users.find((item) => {
      const userRoles = item.userRoles.map((role) => role.role.name);
      const accessMode = buildAccessMode(userRoles);
      if (accessMode !== "manager" && accessMode !== "operateur") return false;
      const profile = profiles.find((entry) => entry.userId === item.id);
      const profileUsername = sanitizeLoginUsername(profile?.loginUsername || "") || buildDefaultManagerUsername(item.fullName, item.id);
      return profileUsername === username;
    }) ?? null;
    if (!user || !(await verifyPassword(payload.password, user.passwordHash))) {
      throw new AppError("Identifiants invalides.", 401);
    }
  }

  if (payload.loginType === "caissier") {
    const code = sanitizePinCode(payload.code.replace(/^CSH[-:]/i, ""));
    const [users, profiles] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true, userRoles: { some: { role: { name: "caissier" } } } },
        include: { userRoles: { include: { role: true } } }
      }),
      readUserLoginProfiles()
    ]);
    user = users.find((item) => {
      const userRoles = item.userRoles.map((role) => role.role.name);
      if (buildAccessMode(userRoles) !== "caissier") return false;
      const profile = profiles.find((entry) => entry.userId === item.id);
      const profileCode = sanitizePinCode(profile?.pinCode || "") || buildDefaultCashierPinCode(item.id);
      return profileCode === code;
    }) ?? null;
    if (!user) {
      throw new AppError("Code confidentiel invalide.", 401);
    }
  }

  if (!user) {
    throw new AppError("Identifiants invalides.", 401);
  }
  const { accessToken, refreshToken, user: profile } = await issueAuthTokens(user.id);
  res.cookie("refreshToken", refreshToken, buildRefreshCookieOptions());
  await writeAuditLog({ userId: user.id, action: "auth.login", entityType: "user", entityId: user.id });
  return ok(res, { accessToken, user: profile }, "Connexion réussie.");
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const token = req.cookies.refreshToken as string | undefined;
  if (!token) throw new AppError("Refresh token manquant.", 401);
  const payload = jwt.verify(token, env.refreshSecret as Secret) as { id: string };
  const user = await serializeUser(payload.id);
  const accessToken = jwt.sign(user, env.accessSecret as Secret, { expiresIn: env.accessTtl as SignOptions["expiresIn"] });
  return ok(res, { accessToken, user });
}));

authRouter.post("/logout", asyncHandler(async (_req, res) => {
  res.clearCookie("refreshToken", buildRefreshCookieOptions());
  return ok(res, true, "Déconnexion effectuée.");
}));

authRouter.get("/me", asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) throw new AppError("Authentification requise.", 401);
  const payload = jwt.verify(auth.replace("Bearer ", ""), env.accessSecret as Secret) as { id: string };
  return ok(res, await serializeUser(payload.id));
}));

authRouter.post("/change-cashier-code", asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) throw new AppError("Authentification requise.", 401);
  const tokenPayload = jwt.verify(auth.replace("Bearer ", ""), env.accessSecret as Secret) as { id: string };
  const payload = changeCashierCodeSchema.parse(req.body);

  if (payload.nextCode !== payload.confirmCode) {
    throw new AppError("La confirmation du nouveau code ne correspond pas.", 422);
  }

  const user = await prisma.user.findUnique({
    where: { id: tokenPayload.id },
    include: { userRoles: { include: { role: true } } }
  });
  if (!user || !user.isActive) {
    throw new AppError("Utilisateur introuvable.", 404);
  }

  const roles = user.userRoles.map((item) => item.role.name);
  if (buildAccessMode(roles) !== "caissier") {
    throw new AppError("Cette action est reservee aux caissiers.", 403);
  }

  const currentCode = sanitizePinCode(payload.currentCode.replace(/^CSH[-:]/i, ""));
  const nextCode = sanitizePinCode(payload.nextCode.replace(/^CSH[-:]/i, ""));
  const profiles = await readUserLoginProfiles();
  const currentProfile = profiles.find((entry) => entry.userId === user.id);
  const savedCode = sanitizePinCode(currentProfile?.pinCode || "") || buildDefaultCashierPinCode(user.id);

  if (currentCode !== savedCode) {
    throw new AppError("Ancien code confidentiel invalide.", 401);
  }

  if (currentCode === nextCode) {
    throw new AppError("Le nouveau code doit etre different de l'ancien.", 422);
  }

  if (profiles.some((entry) => entry.userId !== user.id && sanitizePinCode(entry.pinCode || "") === nextCode)) {
    throw new AppError("Ce code confidentiel existe deja.", 409);
  }

  await saveUserLoginProfiles([
    ...profiles.filter((entry) => entry.userId !== user.id),
    {
      userId: user.id,
      pinCode: nextCode
    }
  ]);

  await writeAuditLog({
    userId: user.id,
    action: "auth.cashier_code.update",
    entityType: "user",
    entityId: user.id
  });

  return ok(res, true, "Code confidentiel mis a jour.");
}));
