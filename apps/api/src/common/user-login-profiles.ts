import type { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const USER_LOGIN_PROFILES_KEY = "user_login_profiles";

export type UserLoginProfile = {
  userId: string;
  loginUsername?: string;
  pinCode?: string;
};

type SettingsDb = Pick<PrismaClient, "setting">;

export function buildAccessMode(roleNames: string[]) {
  if (roleNames.includes("admin")) return "admin" as const;
  if (roleNames.includes("caissier")) return "caissier" as const;
  if (roleNames.includes("operateur_commandes")) return "operateur" as const;
  if (roleNames.includes("manager")) return "manager" as const;
  return "autre" as const;
}

export function sanitizeLoginUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sanitizePinCode(value: string) {
  return value.replace(/\D+/g, "").trim();
}

export function buildDefaultManagerUsername(fullName: string, userId: string) {
  const base = sanitizeLoginUsername(fullName) || "manager";
  return `${base}-${userId.slice(-4).toLowerCase()}`;
}

export function buildDefaultCashierPinCode(userId: string) {
  const digits = userId.replace(/\D+/g, "");
  return (digits.slice(-6) || "123456").padStart(6, "0").slice(-6);
}

export async function readUserLoginProfiles(db: SettingsDb = prisma) {
  const setting = await db.setting.findUnique({ where: { key: USER_LOGIN_PROFILES_KEY } });
  if (!Array.isArray(setting?.value)) return [] as UserLoginProfile[];
  return setting.value as UserLoginProfile[];
}

export async function saveUserLoginProfiles(profiles: UserLoginProfile[], db: SettingsDb = prisma) {
  const value = profiles as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key: USER_LOGIN_PROFILES_KEY },
    update: { value },
    create: { key: USER_LOGIN_PROFILES_KEY, value }
  });
}
