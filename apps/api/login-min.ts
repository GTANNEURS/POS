import dotenv from "dotenv";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: resolve(process.cwd(), ".env"), override: true });
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "admin@gdt.local" } });
  console.log(JSON.stringify({ hasUser: !!user, email: user?.email ?? null }));
  if (user) {
    const ok = await bcrypt.compare("Admin123!", user.passwordHash);
    console.log(JSON.stringify({ passwordOk: ok }));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });