import dotenv from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: resolve(process.cwd(), ".env"), override: true });
console.log("DB_URL=", process.env.DATABASE_URL);

const prisma = new PrismaClient();

async function main() {
  try {
    const users = await prisma.user.count();
    console.log("USER_COUNT=", users);
  } catch (error) {
    console.error("PRISMA_ERROR_START");
    console.error(error);
    console.error("PRISMA_ERROR_END");
  } finally {
    await prisma.$disconnect();
  }
}

main();