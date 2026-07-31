import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { authenticate, type AuthenticatedRequest, requirePermissions } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";

const schema = z.object({
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable()
});

export const transportersRouter = Router();
transportersRouter.use(authenticate, requirePermissions("settings_manage"));

transportersRouter.get("/", asyncHandler(async (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const transporters = await prisma.transporter.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } }
          ]
        }
      : undefined,
    orderBy: { createdAt: "desc" }
  });
  return ok(res, transporters);
}));

transportersRouter.get("/:id", asyncHandler(async (req, res) => {
  const transporterId = String(req.params.id);
  const transporter = await prisma.transporter.findUnique({
    where: { id: transporterId }
  });
  if (!transporter) throw new AppError("Transporteur introuvable.", 404);

  const sales = await prisma.sale.findMany({
    where: {
      transporterId,
      shippingFee: { gt: 0 }
    },
    orderBy: { createdAt: "desc" },
    include: {
      customer: true,
      warehouse: true,
      payments: true,
      items: { include: { product: true } }
    }
  });

  const totalShippingFees = sales.reduce((sum, sale) => sum + Number(sale.shippingFee), 0);
  return ok(res, { ...transporter, sales, totalShippingFees, ticketsCount: sales.length });
}));

transportersRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = schema.parse(req.body);
  const transporter = await prisma.transporter.create({ data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "transporters.create", entityType: "transporter", entityId: transporter.id, meta: payload });
  return ok(res, transporter, "Transporteur cree.");
}));

transportersRouter.put("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const transporterId = String(req.params.id);
  const payload = schema.partial().parse(req.body);
  const transporter = await prisma.transporter.update({ where: { id: transporterId }, data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "transporters.update", entityType: "transporter", entityId: transporter.id, meta: payload });
  return ok(res, transporter, "Transporteur mis a jour.");
}));

transportersRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const transporterId = String(req.params.id);
  const salesCount = await prisma.sale.count({ where: { transporterId } });
  if (salesCount > 0) {
    throw new AppError("Impossible de supprimer un transporteur lie a des tickets.", 400);
  }

  await prisma.transporter.delete({ where: { id: transporterId } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "transporters.delete", entityType: "transporter", entityId: transporterId });
  return ok(res, true, "Transporteur supprime.");
}));