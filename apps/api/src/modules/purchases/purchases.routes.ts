import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import {
  authenticate,
  type AuthenticatedRequest,
  ensureWarehouseAccess,
  getScopedWarehouseId,
  requirePermissions
} from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";
import { applyLocationDelta, ensureProductStockSeeded, getLocationStock, readStockBalances, saveStockBalances } from "../../common/stock-balances.js";

const SUPPLIER_INVOICE_META_KEY = "supplier_invoice_meta";
const SUPPLIER_CREDIT_NOTE_META_KEY = "supplier_credit_note_meta";

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  productName: z.string().optional().nullable(),
  quantity: z.coerce.number().int().positive(),
  unitCostHt: z.coerce.number(),
  unitCostTtc: z.coerce.number(),
  taxRate: z.coerce.number()
}).refine((item) => Boolean(item.productId?.trim() || item.productName?.trim()), {
  message: "Choisis un article ou saisis son nom.",
  path: ["productName"]
});

const purchaseSchema = z.object({
  number: z.string().min(3),
  supplierId: z.string(),
  warehouseId: z.string(),
  status: z.enum(["DRAFT", "ORDERED", "RECEIVED", "INVOICED", "CANCELLED"]).default("DRAFT"),
  items: z.array(itemSchema).min(1)
});

const supplierCreditNoteSchema = z.object({
  number: z.string().min(3),
  supplierId: z.string(),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().optional().nullable()
});

const supplierInvoiceUpdateSchema = z.object({
  dueDate: z.string().trim().optional().nullable(),
  paidAmount: z.coerce.number().min(0)
});

type PurchaseItemPayload = z.infer<typeof itemSchema>;
type DbClient = Prisma.TransactionClient | typeof prisma;
type SupplierInvoiceMeta = { invoiceId: string; paidAmount: number; warehouseId?: string | null };
type SupplierCreditNoteMeta = { creditNoteId: string; warehouseId?: string | null };

export const purchasesRouter = Router();
purchasesRouter.use(authenticate, requirePermissions("purchases_manage"));

function computeTotals(items: PurchaseItemPayload[]) {
  const subtotal = items.reduce((sum, item) => sum + item.unitCostHt * item.quantity, 0);
  const taxAmount = items.reduce((sum, item) => sum + (item.unitCostTtc - item.unitCostHt) * item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.unitCostTtc * item.quantity, 0);
  return { subtotal, taxAmount, totalAmount };
}

function skuBaseFromName(name: string) {
  return name
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18) || "ARTICLE";
}

async function generateUniqueSku(tx: DbClient, name: string) {
  const base = skuBaseFromName(name);
  for (let index = 0; index < 20; index += 1) {
    const candidate = `${base}-${Date.now().toString().slice(-6)}${index}`;
    const existing = await tx.product.findUnique({ where: { reference: candidate } });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function resolveProductId(tx: DbClient, item: PurchaseItemPayload, warehouseId: string) {
  if (item.productId?.trim()) {
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (!product) throw new AppError("Article introuvable.", 404);
    return product.id;
  }

  const productName = item.productName?.trim();
  if (!productName) throw new AppError("Nom d'article manquant.", 400);

  const existing = await tx.product.findFirst({
    where: { name: { equals: productName, mode: "insensitive" } }
  });
  if (existing) {
    return existing.id;
  }

  const reference = await generateUniqueSku(tx, productName);
  const created = await tx.product.create({
    data: {
      reference,
      barcode: null,
      name: productName,
      warehouseId,
      purchasePriceHt: item.unitCostHt,
      purchasePriceTtc: item.unitCostTtc,
      salePriceHt: item.unitCostHt,
      salePriceTtc: item.unitCostTtc,
      taxRate: item.taxRate,
      stockOnHand: 0,
      minStock: 0,
      description: "Article cree automatiquement depuis un bon de commande.",
      status: "ACTIVE"
    }
  });

  return created.id;
}

async function resolvePurchaseItems(tx: DbClient, items: PurchaseItemPayload[], warehouseId: string) {
  const resolved = [] as Array<PurchaseItemPayload & { productId: string }>;
  for (const item of items) {
    resolved.push({
      ...item,
      productId: await resolveProductId(tx, item, warehouseId)
    });
  }
  return resolved;
}

async function nextReceiptNumber(tx: DbClient) {
  const year = new Date().getFullYear();
  const prefix = `BR-${year}-`;
  const count = await tx.purchase.count({
    where: {
      number: {
        startsWith: prefix
      }
    }
  });

  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

async function nextSupplierInvoiceNumber(tx: DbClient) {
  const year = new Date().getFullYear();
  const prefix = `FF-${year}-`;
  const count = await tx.supplierInvoice.count({
    where: {
      number: {
        startsWith: prefix
      }
    }
  });

  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

async function readSupplierInvoiceMeta(db: Pick<DbClient, "setting"> = prisma) {
  const setting = await db.setting.findUnique({ where: { key: SUPPLIER_INVOICE_META_KEY } });
  if (!Array.isArray(setting?.value)) return [] as SupplierInvoiceMeta[];
  return (setting.value as unknown[])
    .filter((item): item is SupplierInvoiceMeta => Boolean(item) && typeof item === "object" && typeof (item as SupplierInvoiceMeta).invoiceId === "string")
    .map((item) => ({
      invoiceId: item.invoiceId,
      paidAmount: Number(item.paidAmount ?? 0),
      warehouseId: typeof item.warehouseId === "string" ? item.warehouseId : null
    }))
    .filter((item) => item.invoiceId);
}

async function saveSupplierInvoiceMeta(db: Pick<DbClient, "setting">, entries: SupplierInvoiceMeta[]) {
  const normalized = entries.map((entry) => ({
    invoiceId: entry.invoiceId,
    paidAmount: Number(entry.paidAmount ?? 0),
    warehouseId: entry.warehouseId ?? null
  })) as Prisma.InputJsonValue;

  await db.setting.upsert({
    where: { key: SUPPLIER_INVOICE_META_KEY },
    create: { key: SUPPLIER_INVOICE_META_KEY, value: normalized },
    update: { value: normalized }
  });
}

async function readSupplierCreditNoteMeta(db: Pick<DbClient, "setting"> = prisma) {
  const setting = await db.setting.findUnique({ where: { key: SUPPLIER_CREDIT_NOTE_META_KEY } });
  if (!Array.isArray(setting?.value)) return [] as SupplierCreditNoteMeta[];
  return (setting.value as unknown[])
    .filter((item): item is SupplierCreditNoteMeta => Boolean(item) && typeof item === "object" && typeof (item as SupplierCreditNoteMeta).creditNoteId === "string")
    .map((item) => ({
      creditNoteId: item.creditNoteId,
      warehouseId: typeof item.warehouseId === "string" ? item.warehouseId : null
    }))
    .filter((item) => item.creditNoteId);
}

async function saveSupplierCreditNoteMeta(db: Pick<DbClient, "setting">, entries: SupplierCreditNoteMeta[]) {
  const normalized = entries.map((entry) => ({
    creditNoteId: entry.creditNoteId,
    warehouseId: entry.warehouseId ?? null
  })) as Prisma.InputJsonValue;

  await db.setting.upsert({
    where: { key: SUPPLIER_CREDIT_NOTE_META_KEY },
    create: { key: SUPPLIER_CREDIT_NOTE_META_KEY, value: normalized },
    update: { value: normalized }
  });
}

function computeSupplierInvoiceStatus(amount: number, paidAmount: number) {
  if (paidAmount >= amount && amount > 0) {
    return { code: "PAID", label: "Payee", isPaid: true };
  }
  if (paidAmount > 0) {
    return { code: "PARTIAL", label: "Partiellement payee", isPaid: false };
  }
  return { code: "UNPAID", label: "Impayee", isPaid: false };
}

purchasesRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  return ok(res, await prisma.purchase.findMany({
    where: scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined,
    include: { supplier: true, warehouse: true, items: { include: { product: true } } },
    orderBy: { createdAt: "desc" }
  }));
}));

purchasesRouter.get("/bootstrap", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [suppliers, products, warehouses, settings] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, reference: true, barcode: true, name: true, purchasePriceHt: true, purchasePriceTtc: true, taxRate: true } }),
    prisma.warehouse.findMany({
      where: scopedWarehouseId ? { id: scopedWarehouseId } : undefined,
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true }
    }),
    prisma.setting.findMany({
      where: {
        key: {
          in: [
            "company_name",
            "company_currency",
            "ticket_footer",
            "company_logo_url",
            "company_address",
            "company_email",
            "company_website",
            "company_patente",
            "company_ice",
            "company_rc",
            "company_cnss"
          ]
        }
      }
    })
  ]);

  const companySettings = Object.fromEntries(settings.map((setting) => [setting.key, String(setting.value)]));
  return ok(res, { suppliers, products, warehouses, companySettings });
}));

purchasesRouter.get("/supplier-credit-notes", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [creditNotes, meta] = await Promise.all([
    prisma.supplierCreditNote.findMany({
      include: { supplier: true },
      orderBy: { createdAt: "desc" }
    }),
    readSupplierCreditNoteMeta()
  ]);

  const filtered = scopedWarehouseId
    ? creditNotes.filter((item) => meta.some((entry) => entry.creditNoteId === item.id && entry.warehouseId === scopedWarehouseId))
    : creditNotes;

  return ok(res, filtered);
}));

purchasesRouter.post("/supplier-credit-notes", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = supplierCreditNoteSchema.parse(req.body);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const creditNote = await prisma.$transaction(async (tx) => {
    const created = await tx.supplierCreditNote.create({
      data: {
        number: payload.number,
        supplierId: payload.supplierId,
        amount: payload.amount,
        reason: payload.reason?.trim() || null
      },
      include: { supplier: true }
    });

    if (scopedWarehouseId) {
      const currentMeta = await readSupplierCreditNoteMeta(tx);
      await saveSupplierCreditNoteMeta(tx, [
        ...currentMeta.filter((entry) => entry.creditNoteId !== created.id),
        { creditNoteId: created.id, warehouseId: scopedWarehouseId }
      ]);
    }

    return created;
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "supplier-credit-notes.create", entityType: "supplierCreditNote", entityId: creditNote.id, meta: payload });
  return ok(res, creditNote, "Avoir fournisseur cree.");
}));

purchasesRouter.put("/supplier-credit-notes/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const creditNoteId = String(req.params.id);
  const payload = supplierCreditNoteSchema.parse(req.body);
  const existing = await prisma.supplierCreditNote.findUnique({ where: { id: creditNoteId } });
  if (!existing) throw new AppError("Avoir fournisseur introuvable.", 404);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (scopedWarehouseId) {
    const meta = await readSupplierCreditNoteMeta();
    const entry = meta.find((item) => item.creditNoteId === creditNoteId);
    if (!entry || entry.warehouseId !== scopedWarehouseId) {
      throw new AppError("Cet avoir fournisseur appartient a une autre boutique.", 403);
    }
  }

  const creditNote = await prisma.supplierCreditNote.update({
    where: { id: creditNoteId },
    data: {
      number: payload.number,
      supplierId: payload.supplierId,
      amount: payload.amount,
      reason: payload.reason?.trim() || null
    },
    include: { supplier: true }
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "supplier-credit-notes.update", entityType: "supplierCreditNote", entityId: creditNote.id, meta: payload });
  return ok(res, creditNote, "Avoir fournisseur mis a jour.");
}));

purchasesRouter.delete("/supplier-credit-notes/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const creditNoteId = String(req.params.id);
  const existing = await prisma.supplierCreditNote.findUnique({ where: { id: creditNoteId } });
  if (!existing) throw new AppError("Avoir fournisseur introuvable.", 404);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (scopedWarehouseId) {
    const meta = await readSupplierCreditNoteMeta();
    const entry = meta.find((item) => item.creditNoteId === creditNoteId);
    if (!entry || entry.warehouseId !== scopedWarehouseId) {
      throw new AppError("Cet avoir fournisseur appartient a une autre boutique.", 403);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplierCreditNote.delete({ where: { id: creditNoteId } });
    const currentMeta = await readSupplierCreditNoteMeta(tx);
    await saveSupplierCreditNoteMeta(tx, currentMeta.filter((entry) => entry.creditNoteId !== creditNoteId));
  });
  await writeAuditLog({ userId: req.currentUser?.id, action: "supplier-credit-notes.delete", entityType: "supplierCreditNote", entityId: creditNoteId });
  return ok(res, true, "Avoir fournisseur supprime.");
}));

purchasesRouter.get("/supplier-invoices", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [invoices, meta] = await Promise.all([
    prisma.supplierInvoice.findMany({
      include: { supplier: true },
      orderBy: { createdAt: "desc" }
    }),
    readSupplierInvoiceMeta()
  ]);

  const filteredInvoices = scopedWarehouseId
    ? invoices.filter((invoice) => meta.some((entry) => entry.invoiceId === invoice.id && entry.warehouseId === scopedWarehouseId))
    : invoices;

  const metaMap = new Map(meta.map((entry) => [entry.invoiceId, entry]));
  return ok(res, filteredInvoices.map((invoice) => {
    const amount = Number(invoice.amount);
    const paidAmount = Number(metaMap.get(invoice.id)?.paidAmount ?? 0);
    const remainingAmount = Math.max(0, Number((amount - paidAmount).toFixed(2)));
    const status = computeSupplierInvoiceStatus(amount, paidAmount);
    return {
      ...invoice,
      amount,
      paidAmount,
      remainingAmount,
      statusCode: status.code,
      statusLabel: status.label,
      isPaid: status.isPaid
    };
  }));
}));

purchasesRouter.post("/:id/invoice", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const purchaseId = String(req.params.id);
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) throw new AppError("Bon de reception introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, purchase.warehouseId);
  if (purchase.status === "INVOICED") throw new AppError("Ce bon est deja facture.", 400);
  if (purchase.status !== "RECEIVED") throw new AppError("Seuls les bons de reception peuvent etre convertis en facture.", 400);

  const invoice = await prisma.$transaction(async (tx) => {
    const number = await nextSupplierInvoiceNumber(tx);
    const created = await tx.supplierInvoice.create({
      data: {
        number,
        supplierId: purchase.supplierId,
        amount: purchase.totalAmount,
        dueDate: null,
        isPaid: false
      },
      include: { supplier: true }
    });

    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: "INVOICED" }
    });

    const currentMeta = await readSupplierInvoiceMeta(tx);
    await saveSupplierInvoiceMeta(tx, [
      ...currentMeta.filter((entry) => entry.invoiceId !== created.id),
      { invoiceId: created.id, paidAmount: 0, warehouseId: purchase.warehouseId }
    ]);

    return created;
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "purchases.invoice", entityType: "purchase", entityId: purchase.id, meta: { invoiceNumber: invoice.number } });
  return ok(res, invoice, "Facture fournisseur creee.");
}));

purchasesRouter.put("/supplier-invoices/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const invoiceId = String(req.params.id);
  const payload = supplierInvoiceUpdateSchema.parse(req.body);
  const existing = await prisma.supplierInvoice.findUnique({ where: { id: invoiceId }, include: { supplier: true } });
  if (!existing) throw new AppError("Facture fournisseur introuvable.", 404);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const existingMeta = await readSupplierInvoiceMeta();
  if (scopedWarehouseId) {
    const entry = existingMeta.find((item) => item.invoiceId === invoiceId);
    if (!entry || entry.warehouseId !== scopedWarehouseId) {
      throw new AppError("Cette facture fournisseur appartient a une autre boutique.", 403);
    }
  }

  const amount = Number(existing.amount);
  const paidAmount = Number(payload.paidAmount ?? 0);
  if (paidAmount > amount) throw new AppError("Le montant paye ne peut pas depasser le montant de la facture.", 422);
  const status = computeSupplierInvoiceStatus(amount, paidAmount);

  const updated = await prisma.$transaction(async (tx) => {
    const invoice = await tx.supplierInvoice.update({
      where: { id: invoiceId },
      data: {
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        isPaid: status.isPaid
      },
      include: { supplier: true }
    });

    const currentMeta = await readSupplierInvoiceMeta(tx);
    const currentEntry = currentMeta.find((entry) => entry.invoiceId === invoiceId);
    const nextMeta = [
      ...currentMeta.filter((entry) => entry.invoiceId !== invoiceId),
      { invoiceId, paidAmount, warehouseId: currentEntry?.warehouseId ?? null }
    ];
    await saveSupplierInvoiceMeta(tx, nextMeta);
    return invoice;
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "supplier-invoices.update",
    entityType: "supplierInvoice",
    entityId: invoiceId,
    meta: { dueDate: payload.dueDate || null, paidAmount }
  });

  return ok(res, {
    ...updated,
    amount,
    paidAmount,
    remainingAmount: Math.max(0, Number((amount - paidAmount).toFixed(2))),
    statusCode: status.code,
    statusLabel: status.label,
    isPaid: status.isPaid
  }, "Facture fournisseur mise a jour.");
}));

purchasesRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const purchaseId = String(req.params.id);
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      supplier: true,
      warehouse: true,
      items: { include: { product: true } },
      payments: true,
      createdBy: { select: { id: true, fullName: true, email: true } }
    }
  });
  if (!purchase) throw new AppError("Facture introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, purchase.warehouseId);
  return ok(res, purchase);
}));

purchasesRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = purchaseSchema.parse(req.body);
  ensureWarehouseAccess(req.currentUser, payload.warehouseId);
  const { subtotal, taxAmount, totalAmount } = computeTotals(payload.items);

  const purchase = await prisma.$transaction(async (tx) => {
    const resolvedItems = await resolvePurchaseItems(tx, payload.items, payload.warehouseId);
    return tx.purchase.create({
      data: {
        number: payload.number,
        supplierId: payload.supplierId,
        warehouseId: payload.warehouseId,
        status: payload.status,
        subtotal,
        taxAmount,
        totalAmount,
        amountDue: totalAmount,
        orderedAt: new Date(),
        createdById: req.currentUser?.id,
        items: {
          create: resolvedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCostHt: item.unitCostHt,
            unitCostTtc: item.unitCostTtc,
            taxRate: item.taxRate,
            lineTotal: item.unitCostTtc * item.quantity
          }))
        }
      },
      include: { items: { include: { product: true } }, supplier: true, warehouse: true }
    });
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "purchases.create", entityType: "purchase", entityId: purchase.id, meta: payload });
  return ok(res, purchase, "Bon de commande cree.");
}));

purchasesRouter.put("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const purchaseId = String(req.params.id);
  const payload = purchaseSchema.parse(req.body);
  const existing = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!existing) throw new AppError("Facture introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, existing.warehouseId);
  ensureWarehouseAccess(req.currentUser, payload.warehouseId);
  if (existing.status === "RECEIVED" || existing.status === "INVOICED") {
    throw new AppError("Impossible de modifier un bon deja receptionne ou facture.", 400);
  }

  const { subtotal, taxAmount, totalAmount } = computeTotals(payload.items);
  const purchase = await prisma.$transaction(async (tx) => {
    const resolvedItems = await resolvePurchaseItems(tx, payload.items, payload.warehouseId);
    await tx.purchaseItem.deleteMany({ where: { purchaseId } });
    return tx.purchase.update({
      where: { id: purchaseId },
      data: {
        number: payload.number,
        supplierId: payload.supplierId,
        warehouseId: payload.warehouseId,
        status: payload.status,
        subtotal,
        taxAmount,
        totalAmount,
        amountDue: totalAmount,
        orderedAt: existing.orderedAt ?? new Date(),
        items: {
          create: resolvedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCostHt: item.unitCostHt,
            unitCostTtc: item.unitCostTtc,
            taxRate: item.taxRate,
            lineTotal: item.unitCostTtc * item.quantity
          }))
        }
      },
      include: { items: { include: { product: true } }, supplier: true, warehouse: true }
    });
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "purchases.update", entityType: "purchase", entityId: purchase.id, meta: payload });
  return ok(res, purchase, "Bon de commande mis a jour.");
}));

purchasesRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const purchaseId = String(req.params.id);
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) throw new AppError("Facture introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, purchase.warehouseId);
  if (purchase.status === "RECEIVED" || purchase.status === "INVOICED") {
    throw new AppError("Impossible de supprimer un bon deja receptionne ou facture.", 400);
  }

  await prisma.purchase.delete({ where: { id: purchaseId } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "purchases.delete", entityType: "purchase", entityId: purchaseId });
  return ok(res, true, "Bon de commande supprime.");
}));

purchasesRouter.post("/:id/receive", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const purchaseId = String(req.params.id);
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId }, include: { items: true } });
  if (!purchase) throw new AppError("Achat introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, purchase.warehouseId);
  if (purchase.status === "RECEIVED" || purchase.status === "INVOICED") {
    throw new AppError("Ce bon est deja receptionne.", 400);
  }

  await prisma.$transaction(async (tx) => {
    const receiptNumber = await nextReceiptNumber(tx);
    await tx.purchase.update({ where: { id: purchase.id }, data: { number: receiptNumber, status: "RECEIVED", receivedAt: new Date() } });
    for (const item of purchase.items) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
      let balances = await readStockBalances(tx);
      balances = await ensureProductStockSeeded(tx, balances, product, purchase.warehouseId);
      const beforeLocationStock = getLocationStock(balances, product.id, purchase.warehouseId);
      balances = applyLocationDelta(balances, product.id, purchase.warehouseId, item.quantity);
      await saveStockBalances(tx, balances);
      const afterStock = product.stockOnHand + item.quantity;
      await tx.product.update({ where: { id: product.id }, data: { stockOnHand: afterStock } });
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          warehouseId: purchase.warehouseId,
          type: "IN",
          quantity: item.quantity,
          beforeStock: beforeLocationStock,
          afterStock: beforeLocationStock + item.quantity,
          referenceType: "purchase",
          referenceId: purchase.id,
          notes: "Reception fournisseur"
        }
      });
    }
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "purchases.receive", entityType: "purchase", entityId: purchase.id });
  return ok(res, true, "Bon de reception valide.");
}));
