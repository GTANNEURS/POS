import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { authenticate, type AuthenticatedRequest, requirePermissions } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";

const schema = z.object({
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const suppliersRouter = Router();
suppliersRouter.use(authenticate, requirePermissions("suppliers_manage"));

suppliersRouter.get("/", asyncHandler(async (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const suppliers = await prisma.supplier.findMany({
    where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
    include: { purchases: true },
    orderBy: { createdAt: "desc" }
  });

  return ok(res, suppliers.map((supplier) => ({ ...supplier, purchasesCount: supplier.purchases.length })));
}));

suppliersRouter.get("/:id", asyncHandler(async (req, res) => {
  const supplierId = String(req.params.id);
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      purchases: {
        include: {
          warehouse: true,
          items: {
            include: {
              product: {
                select: { id: true, name: true, reference: true }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" }
      },
      invoices: {
        orderBy: { createdAt: "desc" }
      },
      creditNotes: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!supplier) throw new AppError("Fournisseur introuvable.", 404);

  return ok(res, {
    ...supplier,
    purchasesCount: supplier.purchases.length,
    invoicesCount: supplier.invoices.length,
    totalPurchased: supplier.purchases.reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0),
    totalInvoiced: supplier.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0),
    totalCreditNotes: supplier.creditNotes.reduce((sum, creditNote) => sum + Number(creditNote.amount), 0)
  });
}));

suppliersRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = schema.parse(req.body);
  const supplier = await prisma.supplier.create({ data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "suppliers.create", entityType: "supplier", entityId: supplier.id, meta: payload });
  return ok(res, supplier, "Fournisseur cree.");
}));

suppliersRouter.put("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const supplierId = String(req.params.id);
  const payload = schema.partial().parse(req.body);
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!existing) throw new AppError("Fournisseur introuvable.", 404);
  const supplier = await prisma.supplier.update({ where: { id: supplierId }, data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "suppliers.update", entityType: "supplier", entityId: supplier.id, meta: payload });
  return ok(res, supplier, "Fournisseur mis a jour.");
}));

suppliersRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const supplierId = String(req.params.id);
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId }, include: { purchases: { select: { id: true } } } });
  if (!existing) throw new AppError("Fournisseur introuvable.", 404);
  if (existing.purchases.length > 0) throw new AppError("Impossible de supprimer un fournisseur lie a des achats.", 400);
  await prisma.supplier.delete({ where: { id: supplierId } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "suppliers.delete", entityType: "supplier", entityId: supplierId });
  return ok(res, true, "Fournisseur supprime.");
}));