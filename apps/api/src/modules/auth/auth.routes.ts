import { Router, type Request } from "express";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { getUserAccess, issueAuthTokens, serializeUser, verifyPassword } from "../../common/auth.js";
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

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_BLOCK_MS = 10 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 8;
const loginAttempts = new Map<string, { count: number; firstAt: number; blockedUntil?: number }>();

function loginAttemptKey(req: Request) {
  const body = req.body as Record<string, unknown>;
  const identifier = String(body.email ?? body.username ?? body.code ?? "anonymous")
    .trim()
    .toLowerCase()
    .slice(0, 96);
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${ip}:${identifier}`;
}

function enforceLoginRateLimit(req: Request) {
  const key = loginAttemptKey(req);
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt) return;
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    throw new AppError("Trop de tentatives. Reessaie dans quelques minutes.", 429);
  }
  if (now - attempt.firstAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(key);
  }
}

function recordFailedLogin(req: Request) {
  const key = loginAttemptKey(req);
  const now = Date.now();
  const current = loginAttempts.get(key);
  const next = current && now - current.firstAt <= LOGIN_RATE_LIMIT_WINDOW_MS
    ? { ...current, count: current.count + 1 }
    : { count: 1, firstAt: now };
  if (next.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    next.blockedUntil = now + LOGIN_RATE_LIMIT_BLOCK_MS;
  }
  loginAttempts.set(key, next);
}

function clearLoginAttempts(req: Request) {
  loginAttempts.delete(loginAttemptKey(req));
}

function rejectLogin(req: Request, message = "Identifiants invalides."): never {
  recordFailedLogin(req);
  throw new AppError(message, 401);
}

function buildRefreshCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "strict" as const,
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
  enforceLoginRateLimit(req);
  let user = null as Awaited<ReturnType<typeof prisma.user.findUnique>> | null;

  if (payload.loginType === "admin") {
    user = await prisma.user.findUnique({ where: { email: payload.email } });
    if (!user || !user.isActive || !(await verifyPassword(payload.password, user.passwordHash))) {
      rejectLogin(req);
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
      rejectLogin(req);
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
      rejectLogin(req, "Code confidentiel invalide.");
    }
  }

  if (!user) {
    rejectLogin(req);
  }

  const access = await getUserAccess(user.id);
  if (payload.loginType === "admin" && !access.roles.includes("admin")) {
    rejectLogin(req);
  }

  const { accessToken, refreshToken, user: profile } = await issueAuthTokens(user.id);
  res.cookie("refreshToken", refreshToken, buildRefreshCookieOptions());
  clearLoginAttempts(req);
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
