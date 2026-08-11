import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: ["error", "warn"],
  transactionOptions: {
    maxWait: 10_000,
    timeout: 30_000
  }
});
