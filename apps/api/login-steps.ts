import dotenv from "dotenv";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { serializeUser, issueAuthTokens } from "./src/common/auth.js";
import { writeAuditLog } from "./src/common/audit.js";

const logPath = resolve(process.cwd(), "login-steps.log");
const log = (value: string) => appendFileSync(logPath, value + "\n");

dotenv.config({ path: resolve(process.cwd(), ".env"), override: true });
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@gdt.local" } });
  log("STEP serializeUser:start");
  const profile = await serializeUser(user.id);
  log("STEP serializeUser:ok " + JSON.stringify(profile));
  log("STEP issueAuthTokens:start");
  const tokens = await issueAuthTokens(user.id);
  log("STEP issueAuthTokens:ok " + JSON.stringify({ access: !!tokens.accessToken, refresh: !!tokens.refreshToken }));
  log("STEP writeAuditLog:start");
  await writeAuditLog({ userId: user.id, action: "auth.login", entityType: "user", entityId: user.id });
  log("STEP writeAuditLog:ok");
}

main()
  .catch((error) => {
    log("SIM_ERROR " + String(error));
    process.exit(1);
  })
  .finally(async () => {
    log("FINALLY:start");
    await prisma.$disconnect();
    log("FINALLY:done");
  });