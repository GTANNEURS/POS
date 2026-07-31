import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

type AuditInput = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
};

export async function writeAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.meta == null ? Prisma.JsonNull : (input.meta as Prisma.InputJsonValue)
    }
  });
}
