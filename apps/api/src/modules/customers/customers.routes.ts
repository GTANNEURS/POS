import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { authenticate, type AuthenticatedRequest, requirePermissions } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";

const schema = z.object({
  fullName: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  loyaltyPoints: z.coerce.number().int().default(0),
  discountRate: z.coerce.number().default(0),
  level: z.string().default("Standard")
});

export const customersRouter = Router();
customersRouter.use(authenticate, requirePermissions("customers_manage"));

customersRouter.get("/", asyncHandler(async (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const customers = await prisma.customer.findMany({
    where: search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } }
          ]
        }
      : undefined,
    include: { sales: true },
    orderBy: { createdAt: "desc" }
  });

  return ok(
    res,
    customers.map((customer) => ({
      ...customer,
      purchasesCount: customer.sales.length
    }))
  );
}));

customersRouter.get("/:id", asyncHandler(async (req, res) => {
  const customerId = String(req.params.id);
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      sales: {
        orderBy: { createdAt: "desc" },
        include: {
          warehouse: true,
          items: { include: { product: true } },
          payments: true,
          returns: true
        }
      },
      loyaltyTransactions: { orderBy: { createdAt: "desc" }, take: 20 },
      returns: { orderBy: { createdAt: "desc" }, include: { sale: true } }
    }
  });

  if (!customer) throw new AppError("Client introuvable.", 404);

  const purchasesCount = customer.sales.length;
  const totalSpent = customer.sales.reduce((sum, sale) => sum + Number(sale.totalAmount), 0);
  const totalPaid = customer.sales.reduce((sum, sale) => sum + Number(sale.paidAmount), 0);
  const returnsCount = customer.returns.length;
  const totalReturns = customer.returns.reduce((sum, item) => sum + Number(item.amount), 0);

  return ok(res, {
    ...customer,
    purchasesCount,
    totalSpent,
    totalPaid,
    returnsCount,
    totalReturns
  });
}));

customersRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = schema.parse(req.body);
  const customer = await prisma.customer.create({ data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "customers.create", entityType: "customer", entityId: customer.id, meta: payload });
  return ok(res, customer, "Client cree.");
}));

customersRouter.put("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = schema.partial().parse(req.body);
  const customerId = String(req.params.id);
  const customer = await prisma.customer.update({ where: { id: customerId }, data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "customers.update", entityType: "customer", entityId: customer.id, meta: payload });
  return ok(res, customer, "Client mis a jour.");
}));

customersRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const customerId = String(req.params.id);
  const salesCount = await prisma.sale.count({ where: { customerId } });
  if (salesCount > 0) {
    throw new AppError("Impossible de supprimer un client lie a des ventes.", 400);
  }

  await prisma.customer.delete({ where: { id: customerId } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "customers.delete", entityType: "customer", entityId: customerId });
  return ok(res, true, "Client supprime.");
}));