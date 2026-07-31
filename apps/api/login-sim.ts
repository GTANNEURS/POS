import dotenv from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { verifyPassword, issueAuthTokens } from "./src/common/auth.js";

dotenv.config({ path: resolve(process.cwd(), ".env"), override: true });
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "admin@gdt.local" } });
  console.log("USER_EXISTS", !!user);
  if (!user) return;
  console.log("PASSWORD_OK", await verifyPassword("Admin123!", user.passwordHash));
  const tokens = await issueAuthTokens(user.id);
  console.log("TOKEN_OK", !!tokens.accessToken, !!tokens.refreshToken, tokens.user.email);
}

main()
  .catch((error) => {
    console.error("LOGIN_SIM_ERROR_START");
    console.error(error);
    console.error("LOGIN_SIM_ERROR_END");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });