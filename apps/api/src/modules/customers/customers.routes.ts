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
  creditLimit: z.coerce.number().nonnegative().optional().nullable(),
  level: z.string().default("Standard")
});

const CUSTOMER_CREDIT_REPAYMENTS_KEY = "pos_customer_credit_repayments";
const CUSTOMER_CREDIT_LIMITS_KEY = "customer_credit_limits";

function parseRepaymentStore(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => ({
        saleId: String((entry as { saleId?: unknown }).saleId ?? ""),
        customerId: (entry as { customerId?: unknown }).customerId == null ? null : String((entry as { customerId?: unknown }).customerId),
        amount: Number((entry as { amount?: unknown }).amount ?? 0),
        deletedAt: (entry as { deletedAt?: unknown }).deletedAt == null ? null : String((entry as { deletedAt?: unknown }).deletedAt)
      }))
    : [];
}

function parseCreditLimitStore(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, number>;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([customerId, amount]) => [customerId, Number(amount)] as const)
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] >= 0)
  ) as Record<string, number>;
}

async function loadCreditLimits() {
  const setting = await prisma.setting.findUnique({ where: { key: CUSTOMER_CREDIT_LIMITS_KEY } });
  return parseCreditLimitStore(setting?.value);
}

async function saveCreditLimit(customerId: string, amount: number | null | undefined) {
  const limits = await loadCreditLimits();
  if (amount == null) {
    delete limits[customerId];
  } else {
    limits[customerId] = Number(amount);
  }
  await prisma.setting.upsert({
    where: { key: CUSTOMER_CREDIT_LIMITS_KEY },
    create: { key: CUSTOMER_CREDIT_LIMITS_KEY, value: limits },
    update: { value: limits }
  });
}

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

  const creditLimits = await loadCreditLimits();

  return ok(
    res,
    customers.map((customer) => ({
      ...customer,
      creditLimit: creditLimits[customer.id] ?? null,
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
  const creditSales = customer.sales.filter((sale) => sale.payments.some((payment) => payment.direction === "IN" && payment.method === "CREDIT"));
  const creditAmount = creditSales.reduce((sum, sale) => (
    sum + sale.payments
      .filter((payment) => payment.direction === "IN" && payment.method === "CREDIT")
      .reduce((paymentSum, payment) => paymentSum + Number(payment.amount), 0)
  ), 0);
  const repaymentSetting = await prisma.setting.findUnique({ where: { key: CUSTOMER_CREDIT_REPAYMENTS_KEY } });
  const repayments = parseRepaymentStore(repaymentSetting?.value).filter((entry) => !entry.deletedAt && (entry.customerId === customer.id || creditSales.some((sale) => sale.id === entry.saleId)));
  const creditRepaidAmount = repayments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const creditBalance = Number(Math.max(0, creditAmount - creditRepaidAmount).toFixed(2));
  const creditLimits = await loadCreditLimits();
  const creditLimit = creditLimits[customer.id] ?? null;
  const creditAvailable = creditLimit == null ? null : Number(Math.max(0, creditLimit - creditBalance).toFixed(2));

  return ok(res, {
    ...customer,
    creditLimit,
    purchasesCount,
    totalSpent,
    totalPaid,
    returnsCount,
    totalReturns,
    creditStatus: {
      creditAmount: Number(creditAmount.toFixed(2)),
      repaidAmount: Number(creditRepaidAmount.toFixed(2)),
      balanceAmount: creditBalance,
      limitAmount: creditLimit,
      availableAmount: creditAvailable,
      isUnlimited: creditLimit == null,
      isExceeded: creditLimit != null && creditBalance > creditLimit
    }
  });
}));

customersRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { creditLimit, ...payload } = schema.parse(req.body);
  const customer = await prisma.customer.create({ data: payload });
  await saveCreditLimit(customer.id, creditLimit ?? null);
  await writeAuditLog({ userId: req.currentUser?.id, action: "customers.create", entityType: "customer", entityId: customer.id, meta: payload });
  return ok(res, { ...customer, creditLimit: creditLimit ?? null }, "Client cree.");
}));

customersRouter.put("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { creditLimit, ...payload } = schema.partial().parse(req.body);
  const customerId = String(req.params.id);
  const customer = await prisma.customer.update({ where: { id: customerId }, data: payload });
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "creditLimit")) {
    await saveCreditLimit(customer.id, creditLimit ?? null);
  }
  await writeAuditLog({ userId: req.currentUser?.id, action: "customers.update", entityType: "customer", entityId: customer.id, meta: { ...payload, creditLimit } });
  return ok(res, { ...customer, creditLimit: creditLimit ?? null }, "Client mis a jour.");
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
