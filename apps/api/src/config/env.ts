import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../../.env"), override: true });

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function parseCsv(value?: string) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
const webUrl = process.env.WEB_URL || vercelUrl || "http://localhost:5180";
const corsOrigins = Array.from(new Set([
  webUrl,
  vercelUrl,
  ...parseCsv(process.env.CORS_ORIGINS),
  "http://localhost:5180",
  "http://127.0.0.1:5180"
].filter(Boolean)));
const isProduction = (process.env.NODE_ENV ?? "development") === "production";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  accessSecret: required("JWT_ACCESS_SECRET", "change-me-access"),
  refreshSecret: required("JWT_REFRESH_SECRET", "change-me-refresh"),
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  cookieDomain: process.env.COOKIE_DOMAIN ?? "",
  secureCookies: process.env.SECURE_COOKIES
    ? process.env.SECURE_COOKIES === "true"
    : isProduction,
  appName: process.env.APP_NAME ?? "GDT Suite",
  companyName: process.env.COMPANY_NAME ?? "Galerie des Tanneurs",
  defaultCurrency: process.env.DEFAULT_CURRENCY ?? "MAD",
  webUrl,
  corsOrigins
};
