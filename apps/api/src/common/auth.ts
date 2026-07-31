import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "./http.js";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  defaultWarehouse: { id: string; name: string; code: string; type: string } | null;
};

export type AuthenticatedRequest = Request & { currentUser?: CurrentUser };

export function isCommandValidationScope(req?: Request | AuthenticatedRequest | null) {
  const header = req?.headers?.["x-gdt-session-scope"];
  return String(Array.isArray(header) ? header[0] : header ?? "").trim().toLowerCase() === "command_validation";
}

export function isAdminUser(currentUser?: CurrentUser | null) {
  if (!currentUser) return false;
  return currentUser.roles.includes("admin");
}

export function getScopedWarehouseId(currentUser?: CurrentUser | null) {
  if (!currentUser || isAdminUser(currentUser)) return null;
  if (!currentUser.defaultWarehouse?.id) {
    throw new AppError("Aucune boutique n'est affectee a cet utilisateur.", 403);
  }
  return currentUser.defaultWarehouse.id;
}

export function getScopedWarehouseIdForRequest(req: AuthenticatedRequest) {
  if (isCommandValidationScope(req) && req.currentUser?.permissions.includes("sales_manage")) {
    return null;
  }
  return getScopedWarehouseId(req.currentUser);
}

export function requireScopedWarehouse(currentUser?: CurrentUser | null) {
  const warehouseId = getScopedWarehouseId(currentUser);
  return warehouseId;
}

export function ensureWarehouseAccess(currentUser: CurrentUser | undefined, warehouseId: string | null | undefined) {
  if (isAdminUser(currentUser)) return;
  const scopedWarehouseId = requireScopedWarehouse(currentUser);
  if (!warehouseId || warehouseId !== scopedWarehouseId) {
    throw new AppError("Acces refuse pour cette boutique.", 403);
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function getUserAccess(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: true } }
            }
          }
        }
      }
    }
  });

  if (!user) {
    throw new AppError("Utilisateur introuvable.", 404);
  }

  const roles = user.userRoles.map((item) => item.role.name);
  const permissions = Array.from(
    new Set(user.userRoles.flatMap((item) => item.role.rolePermissions.map((rp) => rp.permission.code)))
  ).sort();

  const defaultWarehouse = user.defaultWarehouseId
    ? await prisma.warehouse.findUnique({
        where: { id: user.defaultWarehouseId },
        select: { id: true, name: true, code: true, type: true }
      })
    : null;

  return { user, roles, permissions, defaultWarehouse };
}

export async function serializeUser(userId: string): Promise<CurrentUser> {
  const { user, roles, permissions, defaultWarehouse } = await getUserAccess(userId);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    permissions,
    defaultWarehouse
  };
}

export function createAccessToken(payload: CurrentUser) {
  return jwt.sign(payload, env.accessSecret as Secret, { expiresIn: env.accessTtl as SignOptions["expiresIn"] });
}

export function createRefreshToken(payload: Pick<CurrentUser, "id" | "email">) {
  return jwt.sign(payload, env.refreshSecret as Secret, { expiresIn: `${env.refreshTtlDays}d` as SignOptions["expiresIn"] });
}

export async function issueAuthTokens(userId: string) {
  const user = await serializeUser(userId);
  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken({ id: user.id, email: user.email });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: await hashPassword(refreshToken),
      expiresAt: new Date(Date.now() + env.refreshTtlDays * 24 * 60 * 60 * 1000)
    }
  });

  return { user, accessToken, refreshToken };
}

export async function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError("Authentification requise.", 401));
  }

  const token = authHeader.replace("Bearer ", "").trim();

  try {
    const payload = jwt.verify(token, env.accessSecret as Secret) as CurrentUser;
    req.currentUser = payload;
    return next();
  } catch {
    return next(new AppError("Jeton invalide ou expire.", 401));
  }
}

export function requirePermissions(...codes: string[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return next(new AppError("Authentification requise.", 401));
    }

    const available = new Set(req.currentUser.permissions);
    const missing = codes.filter((code) => !available.has(code));
    if (missing.length > 0) {
      return next(new AppError("Permissions insuffisantes.", 403, { missing }));
    }

    return next();
  };
}

export function requireRoles(...roles: string[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return next(new AppError("Authentification requise.", 401));
    }

    const allowed = req.currentUser.roles.some((role) => roles.includes(role));
    if (!allowed) {
      return next(new AppError("Role non autorise.", 403));
    }

    return next();
  };
}
