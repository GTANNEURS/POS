import { Router } from "express";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { authenticate, type AuthenticatedRequest, ensureWarehouseAccess, getScopedWarehouseId, requirePermissions } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";
import { buildDefaultManagerUsername, readUserLoginProfiles, sanitizeLoginUsername } from "../../common/user-login-profiles.js";
import {
  applyLocationDelta,
  applyVariantLocationDelta,
  ensureProductStockSeeded,
  ensureVariantStockSeeded,
  getLocationStock,
  getProductStockTotal,
  getProductStockTotalFromVariantBalances,
  getVariantLocationStock,
  getVariantStockTotal,
  readStockBalances,
  readVariantStockBalances,
  saveStockBalances,
  saveVariantStockBalances,
  syncVariantGlobalStock
} from "../../common/stock-balances.js";

const checkoutSchema = z.object({
  warehouseId: z.string(),
  registerId: z.string(),
  customerId: z.string().optional().nullable(),
  transporterId: z.string().optional().nullable(),
  sellerName: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  shippingFee: z.coerce.number().default(0),
  items: z.array(z.object({
    productId: z.string(),
    variantId: z.string().optional().nullable(),
    quantity: z.coerce.number().int().positive(),
    discountAmount: z.coerce.number().default(0),
    kind: z.enum(["PRODUCT", "ORDER_DEPOSIT"]).default("PRODUCT"),
    name: z.string().optional(),
    unitPriceTtc: z.coerce.number().optional(),
    orderSource: z.enum(["POS", "LEGACY"]).optional(),
    orderType: z.string().optional(),
    orderNumber: z.string().optional(),
    orderTotal: z.coerce.number().optional(),
    depositAmount: z.coerce.number().optional()
  })).min(1),
  payments: z.array(z.object({
    amount: z.coerce.number().positive(),
    method: z.string().min(1),
    reference: z.string().optional().nullable(),
    tenderedAmount: z.coerce.number().optional().nullable(),
    currencyCode: z.string().optional().nullable(),
    changeMad: z.coerce.number().optional().nullable(),
    changeCurrency: z.coerce.number().optional().nullable(),
    changeMode: z.enum(["MAD", "CURRENCY"]).optional().nullable(),
    detail: z.string().optional().nullable()
  })).min(1)
});
const sessionSchema = z.object({
  registerId: z.string(),
  openingAmount: z.coerce.number().nonnegative(),
  openingBreakdown: z.array(z.object({
    currencyCode: z.string().min(1),
    amount: z.coerce.number().nonnegative(),
    amountMad: z.coerce.number().nonnegative(),
    rateFromMad: z.coerce.number().nonnegative().optional()
  })).optional().default([])
});
const cashSessionsOverviewQuerySchema = z.object({
  warehouseId: z.string().optional(),
  date: z.string().optional(),
  registerId: z.string().optional()
});
const managerAuthorizationSchema = z.object({
  code: z.string().min(2),
  warehouseId: z.string().optional().nullable()
});
const detaxTicketsQuerySchema = z.object({
  query: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});
const detaxPreviewSchema = z.object({
  ticketCode: z.string().min(1)
});
const detaxCreateSchema = z.object({
  customerName: z.string().optional().nullable(),
  sourceTickets: z.array(z.object({
    sourceTicketId: z.string().min(1),
    itemIds: z.array(z.string().min(1)).min(1)
  })).min(1)
});
const creditPreviewSchema = z.object({
  ticketCode: z.string().optional(),
  ticket: z.string().optional()
}).superRefine((value, ctx) => {
  if (!value.ticketCode?.trim() && !value.ticket?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ticketCode"],
      message: "Le numero de ticket est obligatoire."
    });
  }
});
const creditCreateSchema = z.object({
  sourceTicketId: z.string().min(1),
  customerName: z.string().trim().min(1),
  customerPhone: z.string().trim().min(1),
  reason: z.string().optional().default(""),
  items: z.array(z.object({
    saleItemId: z.string().min(1),
    quantity: z.coerce.number().int().positive()
  })).min(1)
});
const customerCreditQuerySchema = z.object({
  query: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.enum(["all", "open", "partial", "paid"]).optional().default("all"),
  customerId: z.string().optional(),
  warehouseId: z.string().optional()
});
const customerCreditRepaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.string().min(1),
  reference: z.string().optional().nullable(),
  note: z.string().optional().nullable()
});

export const posRouter = Router();
posRouter.use(authenticate);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const legacyOrderLookupScript = resolve(__dirname, "../../../../../../legacy_order_lookup.php");
const phpBinary = existsSync("C:\\xampp\\php\\php.exe") ? "C:\\xampp\\php\\php.exe" : "php";
const SALES_DOCUMENTS_KEY = "sales_documents_store";
const CUSTOMER_CREDIT_REPAYMENTS_KEY = "pos_customer_credit_repayments";
const CUSTOMER_CREDIT_LIMITS_KEY = "customer_credit_limits";
const fallbackRateFromMad: Record<string, number> = {
  MAD: 1,
  EUR: 0.09206,
  USD: 0.1
};

function resolveRateFromMad(currencyCode: string, rateFromMad?: number | null, configuredRate?: number | null) {
  const submittedRate = Number(rateFromMad ?? 0);
  if (submittedRate > 0) return submittedRate;
  const storedRate = Number(configuredRate ?? 0);
  if (storedRate > 0) return storedRate;
  return fallbackRateFromMad[currencyCode.toUpperCase()] ?? 1;
}

function normalizeVoucherNumber(value: string) {
  return value.trim().toUpperCase();
}

const posCreditItemSchema = z.object({
  id: z.string(),
  productId: z.string().optional().nullable(),
  sourceSaleItemId: z.string().optional().nullable(),
  productName: z.string(),
  reference: z.string().default(""),
  quantity: z.number(),
  unitPriceTtc: z.number(),
  lineTotal: z.number()
});

const posCreditDocumentSchema = z.object({
  id: z.string(),
  number: z.string(),
  createdAt: z.string(),
  sourceType: z.enum(["INVOICE", "TICKET"]),
  sourceId: z.string(),
  sourceNumber: z.string(),
  customerName: z.string(),
  customerPhone: z.string().optional().default(""),
  warehouseId: z.string().optional().nullable(),
  warehouseName: z.string().default(""),
  origin: z.enum(["ADMIN", "POS"]).default("ADMIN"),
  createdByName: z.string().optional().default(""),
  voucherNumber: z.string().optional().default(""),
  voucherInitialAmount: z.number().optional().default(0),
  voucherBalanceAmount: z.number().optional().default(0),
  reason: z.string(),
  amount: z.number(),
  items: z.array(posCreditItemSchema)
});

const posCreditStoreSchema = z.object({
  quotes: z.array(z.any()).default([]),
  deliveries: z.array(z.any()).default([]),
  invoices: z.array(z.any()).default([]),
  credits: z.array(posCreditDocumentSchema).default([])
});

type PosCreditDocument = z.infer<typeof posCreditDocumentSchema>;
type PosCreditStore = z.infer<typeof posCreditStoreSchema>;

function parsePosCreditStore(value: unknown): PosCreditStore {
  const parsed = posCreditStoreSchema.safeParse(value);
  return parsed.success ? parsed.data : { quotes: [], deliveries: [], invoices: [], credits: [] };
}

async function loadPosCreditStore(tx: Pick<typeof prisma, "setting"> | Prisma.TransactionClient) {
  const setting = await tx.setting.findUnique({ where: { key: SALES_DOCUMENTS_KEY } });
  return parsePosCreditStore(setting?.value);
}

async function savePosCreditStore(tx: Pick<typeof prisma, "setting"> | Prisma.TransactionClient, store: PosCreditStore) {
  await tx.setting.upsert({
    where: { key: SALES_DOCUMENTS_KEY },
    create: { key: SALES_DOCUMENTS_KEY, value: store },
    update: { value: store }
  });
}

const customerCreditRepaymentEntrySchema = z.object({
  id: z.string(),
  saleId: z.string(),
  saleNumber: z.string(),
  customerId: z.string().nullable().optional(),
  customerName: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  amount: z.number(),
  method: z.string(),
  reference: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: z.string(),
  createdById: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  updatedById: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  deletedById: z.string().nullable().optional()
});
const customerCreditRepaymentStoreSchema = z.array(customerCreditRepaymentEntrySchema).default([]);
type CustomerCreditRepaymentEntry = z.infer<typeof customerCreditRepaymentEntrySchema>;

function parseCustomerCreditRepaymentStore(value: unknown): CustomerCreditRepaymentEntry[] {
  const parsed = customerCreditRepaymentStoreSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

async function loadCustomerCreditRepayments(tx: Pick<typeof prisma, "setting"> | Prisma.TransactionClient) {
  const setting = await tx.setting.findUnique({ where: { key: CUSTOMER_CREDIT_REPAYMENTS_KEY } });
  return parseCustomerCreditRepaymentStore(setting?.value);
}

async function saveCustomerCreditRepayments(tx: Pick<typeof prisma, "setting"> | Prisma.TransactionClient, entries: CustomerCreditRepaymentEntry[]) {
  await tx.setting.upsert({
    where: { key: CUSTOMER_CREDIT_REPAYMENTS_KEY },
    create: { key: CUSTOMER_CREDIT_REPAYMENTS_KEY, value: entries },
    update: { value: entries }
  });
}

async function loadCustomerCreditLimits(tx: Pick<typeof prisma, "setting"> | Prisma.TransactionClient) {
  const setting = await tx.setting.findUnique({ where: { key: CUSTOMER_CREDIT_LIMITS_KEY } });
  if (!setting?.value || typeof setting.value !== "object" || Array.isArray(setting.value)) return {} as Record<string, number>;
  return Object.fromEntries(
    Object.entries(setting.value as Record<string, unknown>)
      .map(([customerId, amount]) => [customerId, Number(amount)] as const)
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] >= 0)
  ) as Record<string, number>;
}

function normalizeCustomerCreditRepaymentMethod(method: string) {
  const normalized = String(method || "").trim().toUpperCase().replace(/\s+/g, "_");
  const allowed = new Set(["CASH", "CARD", "TRANSFER", "CHEQUE", "VOUCHER", "FOREIGN_CURRENCY", "MIXED"]);
  if (!allowed.has(normalized)) {
    throw new AppError("Mode de remboursement credit invalide.", 422);
  }
  return normalized;
}

function getCustomerCreditRepaymentWindow(entries: CustomerCreditRepaymentEntry[], dateStart: Date, dateEnd: Date, warehouseId?: string | null) {
  return entries.filter((entry) => {
    if (entry.deletedAt) return false;
    if (warehouseId && entry.warehouseId !== warehouseId) return false;
    const createdAt = new Date(entry.createdAt);
    return createdAt >= dateStart && createdAt <= dateEnd;
  });
}

function sumActiveRepayments(entries: CustomerCreditRepaymentEntry[], saleId: string, ignoreEntryId?: string) {
  return entries
    .filter((entry) => !entry.deletedAt && entry.saleId === saleId && entry.id !== ignoreEntryId)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

async function getCustomerCreditBalance(tx: Pick<typeof prisma, "sale" | "setting"> | Prisma.TransactionClient, customerId: string) {
  const [creditSales, repayments] = await Promise.all([
    tx.sale.findMany({
      where: {
        customerId,
        payments: { some: { method: "CREDIT", direction: "IN" } }
      },
      select: {
        id: true,
        payments: true
      }
    }),
    loadCustomerCreditRepayments(tx)
  ]);
  const creditAmount = creditSales.reduce((sum, sale) => (
    sum + sale.payments
      .filter((payment) => payment.direction === "IN" && payment.method === "CREDIT")
      .reduce((paymentSum, payment) => paymentSum + Number(payment.amount), 0)
  ), 0);
  const saleIds = new Set(creditSales.map((sale) => sale.id));
  const repaidAmount = repayments
    .filter((entry) => !entry.deletedAt && (entry.customerId === customerId || saleIds.has(entry.saleId)))
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return Number(Math.max(0, creditAmount - repaidAmount).toFixed(2));
}

function buildPosCreditNumber(store: PosCreditStore, date = new Date()) {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const prefix = `BAV-${stamp}-`;
  const seq = store.credits
    .map((credit) => credit.number)
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)) || 0)
    .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

function buildCreditedQuantityMap(store: PosCreditStore, sourceTicketId: string) {
  const quantities = new Map<string, number>();
  for (const credit of store.credits) {
    if (credit.sourceType !== "TICKET" || credit.sourceId !== sourceTicketId) continue;
    for (const item of credit.items) {
      const key = String(item.sourceSaleItemId ?? item.id ?? "").trim();
      if (!key) continue;
      quantities.set(key, Number((quantities.get(key) ?? 0) + Number(item.quantity || 0)));
    }
  }
  return quantities;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMadAmount(value: string) {
  return Number(String(value).replace(/\s+/g, "").replace(",", "."));
}

function extractOrderInfo(note: string | null | undefined, orderNumber: string) {
  if (!note) return null;
  const escaped = escapeRegExp(orderNumber);
  const regex = new RegExp(`Acompte commande\\s+${escaped}\\s+\\(([^)]+)\\)\\s+- Total\\s+([0-9.,]+)\\s+MAD\\s+- Acompte\\s+([0-9.,]+)\\s+MAD`, "i");
  const match = note.match(regex);
  if (!match) return null;
  return {
    line: match[0],
    orderType: match[1],
    orderTotal: parseMadAmount(match[2]),
    depositAmount: parseMadAmount(match[3])
  };
}

function extractOrderNotes(note: string | null | undefined) {
  if (!note) return [] as Array<{ line: string; orderNumber: string; orderType: string; orderTotal: number; depositAmount: number }>;
  const regex = /Acompte commande\s+([^\s]+)\s+\(([^)]+)\)\s+- Total\s+([0-9.,]+)\s+MAD\s+- Acompte\s+([0-9.,]+)\s+MAD/gi;
  const matches = [] as Array<{ line: string; orderNumber: string; orderType: string; orderTotal: number; depositAmount: number }>;
  let match = regex.exec(note);
  while (match) {
    matches.push({
      line: match[0],
      orderNumber: match[1],
      orderType: match[2],
      orderTotal: parseMadAmount(match[3]),
      depositAmount: parseMadAmount(match[4])
    });
    match = regex.exec(note);
  }
  return matches;
}

function splitSaleNote(note: string | null | undefined) {
  const orderNotes = extractOrderNotes(note);
  const orderLines = new Set(orderNotes.map((entry) => entry.line));
  const preservedLines = String(note ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !orderLines.has(line));
  return { preservedLines, orderNotes };
}

type LegacyOrderLookup = {
  id: number;
  orderNumber: string;
  validationNumber?: string | null;
  vendorName?: string;
  workshopName?: string;
  storeName?: string;
  clientName?: string;
  totalAmount: number;
  paid: boolean;
  status?: string;
  deliveryDate?: string | null;
  createdAt: string;
  note?: string;
  details?: string;
  items: Array<{
    id: number;
    reference?: string;
    model?: string;
    material?: string;
    color?: string;
    size?: string;
    quantity: number;
    unitPrice: number;
    details?: string;
  }>;
};

async function lookupLegacyOrder(orderNumber: string): Promise<LegacyOrderLookup | null> {
  if (!existsSync(legacyOrderLookupScript)) return null;
  try {
    const { stdout } = await execFileAsync(phpBinary, [legacyOrderLookupScript, orderNumber], {
      windowsHide: true,
      timeout: 10000
    });
    const payload = JSON.parse(stdout || "{}") as { ok?: boolean; data?: LegacyOrderLookup };
    if (payload.ok && payload.data) return payload.data;
    return null;
  } catch {
    return null;
  }
}

async function markLegacyOrderAsPaid(orderNumber: string, ticketNumber: string): Promise<void> {
  const scriptPath = resolve(__dirname, "../../../../../../legacy_order_mark_paid.php");
  if (!existsSync(scriptPath)) return;
  try {
    await execFileAsync(phpBinary, [scriptPath, orderNumber, ticketNumber], {
      windowsHide: true,
      timeout: 10000
    });
  } catch {
    // Best effort bridge toward the legacy PHP app.
  }
}

async function buildDeliveryOrderData(orderNumber: string) {
  const legacyOrder = await lookupLegacyOrder(orderNumber);
  const depositProduct = await prisma.product.findFirst({ where: { reference: "POS-ORDER-DEPOSIT" }, select: { id: true } });

  const sales = depositProduct
    ? await prisma.sale.findMany({
        where: {
          note: { contains: orderNumber, mode: "insensitive" },
          items: { some: { productId: depositProduct.id } }
        },
        orderBy: { createdAt: "asc" },
        include: {
          items: { where: { productId: depositProduct.id } },
          payments: true
        }
      })
    : [];

  const matchedSales = sales
    .map((sale) => ({ sale, meta: extractOrderInfo(sale.note, orderNumber) }))
    .filter((entry) => entry.meta);

  if (!legacyOrder && !matchedSales.length) {
    throw new AppError("Commande introuvable.", 404);
  }

  const firstMatch = matchedSales[0] ?? null;
  const firstPaidAmount = firstMatch ? firstMatch.sale.items.reduce((lineSum, item) => lineSum + Number(item.lineTotal), 0) : 0;
  const computedOrderTotal = legacyOrder ? Number(legacyOrder.totalAmount) : Number(firstMatch?.meta?.orderTotal ?? 0);
  const posPaidAmount = matchedSales.reduce((sum, entry) => sum + entry.sale.items.reduce((lineSum, item) => lineSum + Number(item.lineTotal), 0), 0);
  const totalPaid = posPaidAmount > 0 ? posPaidAmount : (legacyOrder?.paid ? computedOrderTotal : 0);
  const remainingAmount = Math.max(0, Number((computedOrderTotal - totalPaid).toFixed(2)));
  const detailsFromLegacy = [
    legacyOrder?.details?.trim() || "",
    legacyOrder?.note?.trim() || ""
  ].filter(Boolean).join(" | ");

  return {
    legacyOrder,
    payload: {
      orderNumber,
      orderType: legacyOrder?.workshopName || firstMatch?.meta?.orderType || "Commande",
      orderTotal: Number(computedOrderTotal.toFixed(2)),
      depositAmount: Number(firstPaidAmount.toFixed(2)),
      paidAmount: Number(totalPaid.toFixed(2)),
      remainingAmount,
      firstSale: {
        saleId: firstMatch?.sale.id || `legacy-${legacyOrder?.id ?? orderNumber}`,
        ticketNumber: firstMatch?.sale.number || legacyOrder?.validationNumber || "-",
        sellerName: legacyOrder?.vendorName || firstMatch?.sale.sellerName || null,
        details: detailsFromLegacy || firstMatch?.meta?.line || "Commande retrouvee depuis le module commandes.",
        createdAt: firstMatch?.sale.createdAt || legacyOrder?.createdAt || new Date().toISOString(),
        payments: firstMatch
          ? firstMatch.sale.payments.map((payment) => ({
              id: payment.id,
              method: payment.method,
              amount: Number(payment.amount),
              reference: payment.reference,
              createdAt: payment.createdAt
            }))
          : []
      }
    }
  };
}

function matchesCatalogQuery(values: Array<string | null | undefined>, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  return values.some((value) => {
    const text = String(value ?? "").trim().toLowerCase();
    const textCompact = text.replace(/[^a-z0-9]+/g, "");
    return text.includes(normalized)
      || (Boolean(compact) && textCompact.includes(compact))
      || (Boolean(compact) && textCompact.endsWith(compact));
  });
}

function buildCatalogVariantReference(productReference: string, variantReference?: string | null) {
  const productRef = String(productReference ?? "").trim().toUpperCase();
  const variantRef = String(variantReference ?? "").trim().toUpperCase();
  if (!productRef) return variantRef;
  if (!variantRef) return productRef;
  if (variantRef === productRef || variantRef.startsWith(`${productRef}-`)) return variantRef;
  const suffix = variantRef.split("-").filter(Boolean).at(-1);
  return suffix ? `${productRef}-${suffix}` : productRef;
}

function buildDateStart(value: string) {
  return new Date(`${value}T00:00:00`);
}

function buildDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999`);
}

function getMoroccoTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizeTicketPrefix(value: string) {
  return String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, "").slice(0, 6);
}

function defaultTicketPrefixForBoutique(name: string) {
  const normalized = String(name ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, "");
  const directMap: Record<string, string> = {
    GUELIZ: "GUE",
    MOUASSINE: "MOA",
    MAJORELLE: "MAJ",
    SOFITEL: "SOF",
    MAVENUE: "MAV"
  };
  if (directMap[normalized]) return directMap[normalized];
  return normalized.slice(0, 3) || "POS";
}

function getPosTicketPeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Casablanca",
    year: "2-digit",
    month: "numeric"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "00";
  const month = parts.find((part) => part.type === "month")?.value ?? "1";
  return `${year}${month}`;
}

async function generatePosTicketNumber(tx: Prisma.TransactionClient, warehouseId: string) {
  const [warehouse, boutiqueSetting] = await Promise.all([
    tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, name: true }
    }),
    tx.setting.findUnique({ where: { key: "boutiques_config" } })
  ]);

  if (!warehouse) {
    throw new AppError("Boutique introuvable.", 404);
  }

  const savedBoutiques = Array.isArray(boutiqueSetting?.value)
    ? boutiqueSetting.value as Array<{ id: string; name?: string; ticketPrefix?: string }>
    : [];
  const savedBoutique = savedBoutiques.find((item) => item.id === warehouseId);
  const prefix = normalizeTicketPrefix(savedBoutique?.ticketPrefix ?? "") || defaultTicketPrefixForBoutique(savedBoutique?.name || warehouse.name);
  const period = getPosTicketPeriod();
  const ticketPrefix = `${prefix}-${period}-`;
  const latestSale = await tx.sale.findFirst({
    where: {
      warehouseId,
      number: { startsWith: ticketPrefix }
    },
    orderBy: { number: "desc" },
    select: { number: true }
  });
  const latestSequence = latestSale?.number.split("-").at(-1);
  const nextSequence = latestSequence && /^\d+$/.test(latestSequence)
    ? Number(latestSequence) + 1
    : 1000001;
  return `${ticketPrefix}${String(nextSequence).padStart(7, "0")}`;
}

function formatPaymentMethodLabel(method: string, labels?: Map<string, string>) {
  const normalized = String(method || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (labels?.has(normalized)) return labels.get(normalized)!;
  switch (normalized) {
    case "CASH":
      return "Espece";
    case "CARD":
      return "Carte bancaire";
    case "TRANSFER":
      return "Virement";
    case "CHEQUE":
      return "Cheque";
    case "CREDIT":
      return "Credit";
    case "VOUCHER":
      return "Bon achat";
    case "FOREIGN_CURRENCY":
      return "Devise";
    case "MIXED":
      return "Mixte";
    default:
      return normalized.replace(/_/g, " ");
  }
}

function buildDisplayPaymentLabel(
  rawMethod: string,
  checkoutPayments: CheckoutPaymentDetail[] = [],
  labels?: Map<string, string>
) {
  const normalized = String(rawMethod || "").trim().toUpperCase();
  if (normalized !== "MIXED") return formatPaymentMethodLabel(normalized, labels);
  const distinctLabels = Array.from(
    new Set(
      checkoutPayments
        .map((payment) => formatPaymentMethodLabel(payment.method, labels))
        .filter(Boolean)
    )
  );
  if (!distinctLabels.length) return formatPaymentMethodLabel(normalized, labels);
  if (distinctLabels.length === 1) return distinctLabels[0];
  return distinctLabels.join(" + ");
}

function extractRegisterIdFromAuditMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const registerId = (metadata as { registerId?: string }).registerId;
  return registerId ? String(registerId) : null;
}

function extractCurrencyBreakdown(metadata: unknown, key: "openingBreakdown" | "closingBreakdown") {
  if (!metadata || typeof metadata !== "object") return [] as Array<{
    currencyCode: string;
    amount: number;
    amountMad: number;
    rateFromMad: number;
  }>;
  const entries = Array.isArray((metadata as Record<string, unknown>)[key])
    ? (metadata as Record<string, unknown>)[key] as Array<Record<string, unknown>>
    : [];
  return entries
    .map((entry) => ({
      currencyCode: String(entry.currencyCode ?? "").toUpperCase(),
      amount: Number(entry.amount ?? 0),
      amountMad: Number(entry.amountMad ?? 0),
      rateFromMad: Number(entry.rateFromMad ?? 0)
    }))
    .filter((entry) => entry.currencyCode && entry.amount > 0);
}

function extractCheckoutPayments(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return [] as Array<{
    amount: number;
    method: string;
    reference: string | null;
    tenderedAmount: number | null;
    currencyCode: string | null;
    changeMad: number;
    changeCurrency: number;
    changeMode: "MAD" | "CURRENCY" | null;
    detail: string | null;
  }>;
  const entries = Array.isArray((metadata as Record<string, unknown>).payments)
    ? (metadata as Record<string, unknown>).payments as Array<Record<string, unknown>>
    : [];
  return entries.map((entry) => ({
    amount: Number(entry.amount ?? 0),
    method: String(entry.method ?? "").trim().toUpperCase(),
    reference: entry.reference == null ? null : String(entry.reference),
    tenderedAmount: entry.tenderedAmount == null ? null : Number(entry.tenderedAmount),
    currencyCode: entry.currencyCode == null ? null : String(entry.currencyCode).trim().toUpperCase(),
    changeMad: Number(entry.changeMad ?? 0),
    changeCurrency: Number(entry.changeCurrency ?? 0),
    changeMode: entry.changeMode === "MAD" || entry.changeMode === "CURRENCY" ? entry.changeMode : null,
    detail: entry.detail == null ? null : String(entry.detail)
  })).filter((entry) => entry.amount > 0 && entry.method);
}

type CheckoutPaymentDetail = ReturnType<typeof extractCheckoutPayments>[number];

const POS_TICKET_MARKERS = {
  invoiced: "[POS:FACTURE]",
  detaxed: "[POS:DETAXE]"
} as const;

function hasTicketMarker(note: string | null | undefined, marker: string) {
  return String(note ?? "").includes(marker);
}

function setTicketMarker(note: string | null | undefined, marker: string, enabled: boolean) {
  const lines = String(note ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== marker);

  if (enabled) lines.unshift(marker);
  return lines.join("\n") || null;
}

function mapSaleToTicket(sale: {
  id: string;
  number: string;
  createdAt: Date;
  sellerName: string | null;
  status: string;
  totalAmount: { toString(): string } | number;
  paidAmount: { toString(): string } | number;
  note?: string | null;
  customer: { fullName: string } | null;
  warehouse: { name: string };
  items: Array<{ id: string; quantity: number; lineTotal: { toString(): string } | number; product: { name: string } }>;
  payments: Array<{ id: string; method: string; amount: { toString(): string } | number; reference: string | null; createdAt: Date }>;
}, options?: {
  checkoutPayments?: CheckoutPaymentDetail[];
  paymentLabels?: Map<string, string>;
}) {
  const totalAmount = Number(sale.totalAmount);
  const paidAmount = Number(sale.paidAmount);
  const note = sale.note ?? null;

  return {
    id: sale.id,
    number: sale.number,
    createdAt: sale.createdAt,
    sellerName: sale.sellerName,
    status: sale.status,
    totalAmount,
    paidAmount,
    remainingAmount: Number(Math.max(0, totalAmount - paidAmount).toFixed(2)),
    customer: sale.customer,
    warehouse: sale.warehouse,
    isInvoiced: hasTicketMarker(note, POS_TICKET_MARKERS.invoiced),
    isDetaxed: hasTicketMarker(note, POS_TICKET_MARKERS.detaxed),
    items: sale.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      productName: item.product.name,
      lineTotal: Number(item.lineTotal)
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      displayMethod: buildDisplayPaymentLabel(payment.method, options?.checkoutPayments ?? [], options?.paymentLabels),
      amount: Number(payment.amount),
      reference: payment.reference,
      createdAt: payment.createdAt
    }))
  };
}

function getTicketEditBlockedReason(sale: {
  payments: Array<{ method: string }>;
}) {
  if (sale.payments.some((payment) => String(payment.method).trim().toUpperCase() === "VOUCHER")) {
    return "Modification indisponible pour les tickets regles avec bon achat.";
  }
  return null;
}

function buildTicketDetail(sale: {
  id: string;
  number: string;
  createdAt: Date;
  sellerName: string | null;
  status: string;
  totalAmount: { toString(): string } | number;
  paidAmount: { toString(): string } | number;
  note?: string | null;
  shippingFee: { toString(): string } | number;
  customer: { id: string; fullName: string } | null;
  warehouse: { id: string; name: string };
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPriceTtc: { toString(): string } | number;
    discountAmount: { toString(): string } | number;
    taxRate: { toString(): string } | number;
    lineTotal: { toString(): string } | number;
    product: { name: string; reference: string; variants?: Array<{ id: string }> };
  }>;
  payments: Array<{ id: string; method: string; amount: { toString(): string } | number; reference: string | null; createdAt: Date }>;
}, options?: {
  checkoutPayments?: CheckoutPaymentDetail[];
  paymentLabels?: Map<string, string>;
}) {
  const editBlockedReason = getTicketEditBlockedReason(sale);
  const parsedOrderNotes = extractOrderNotes(sale.note);
  let orderNoteIndex = 0;
  return {
    ...mapSaleToTicket(sale, options),
    customerId: sale.customer?.id ?? null,
    warehouseId: sale.warehouse.id,
    shippingFee: Number(sale.shippingFee),
    editable: !editBlockedReason,
    editBlockedReason,
    items: sale.items.map((item) => {
      const isOrderDeposit = item.product.reference === "POS-ORDER-DEPOSIT";
      const orderMeta = isOrderDeposit ? parsedOrderNotes[orderNoteIndex++] : null;
      return {
        id: item.id,
        productId: item.productId,
        productName: orderMeta ? `Acompte commande N° ${orderMeta.orderNumber} - ${orderMeta.orderType}` : item.product.name,
        reference: item.product.reference,
        quantity: item.quantity,
        unitPriceTtc: Number(item.unitPriceTtc),
        discountAmount: Number(item.discountAmount),
        taxRate: Number(item.taxRate),
        lineTotal: Number(item.lineTotal),
        kind: isOrderDeposit ? "ORDER_DEPOSIT" : "PRODUCT",
        orderType: orderMeta?.orderType ?? null,
        orderNumber: orderMeta?.orderNumber ?? null,
        orderTotal: orderMeta?.orderTotal ?? null,
        depositAmount: orderMeta?.depositAmount ?? Number(item.unitPriceTtc)
      };
    }),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      displayMethod: buildDisplayPaymentLabel(payment.method, options?.checkoutPayments ?? [], options?.paymentLabels),
      amount: Number(payment.amount),
      reference: payment.reference,
      createdAt: payment.createdAt
    }))
  };
}

type DetaxTicketItemRecord = {
  id: string;
  saleItemId: string;
  sourceTicketId: string;
  sourceTicketNumber: string;
  productId: string;
  productName: string;
  reference: string;
  quantity: number;
  unitPriceTtc: number;
  taxRate: number;
  lineTotal: number;
};

type DetaxTicketSkippedItemRecord = {
  id: string;
  saleItemId: string;
  sourceTicketId: string;
  sourceTicketNumber: string;
  productId: string;
  productName: string;
  reference: string;
  quantity: number;
  unitPriceTtc: number;
  lineTotal: number;
  reason: string;
};

type DetaxTicketRecord = {
  id: string;
  number: string;
  sourceTicketId: string;
  sourceTicketNumber: string;
  sourceTicketDate: string;
  sourceTickets: Array<{
    sourceTicketId: string;
    sourceTicketNumber: string;
    sourceTicketDate: string;
    warehouseId: string;
    warehouseName: string;
    customerName: string | null;
    sellerName: string | null;
  }>;
  warehouseId: string;
  warehouseName: string;
  customerName: string | null;
  sellerName: string | null;
  createdByName: string | null;
  createdAt: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  itemCount: number;
  items: DetaxTicketItemRecord[];
  payments: Array<{
    method: string;
    displayMethod: string | null;
    amount: number;
    reference: string | null;
  }>;
};

function normalizeTicketLookupValue(value: string) {
  return String(value || "").trim().toUpperCase();
}

function normalizeTicketDigits(value: string) {
  return String(value || "").replace(/\D+/g, "");
}

function buildDetaxNumber(sequence: number, referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const day = String(referenceDate.getDate()).padStart(2, "0");
  return `DTX-${year}${month}${day}-${String(sequence).padStart(4, "0")}`;
}

function mapDetaxEligibleItems(sale: {
  id: string;
  number: string;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPriceTtc: { toString(): string } | number;
    taxRate: { toString(): string } | number;
    lineTotal: { toString(): string } | number;
    product: {
      name: string;
      reference: string;
      isTaxExempt: boolean;
    };
  }>;
}) {
  return sale.items
    .filter((item) => item.product.reference !== "POS-ORDER-DEPOSIT" && item.product.isTaxExempt)
    .map((item) => ({
      id: item.id,
      saleItemId: item.id,
      sourceTicketId: sale.id,
      sourceTicketNumber: sale.number,
      productId: item.productId,
      productName: item.product.name,
      reference: item.product.reference,
      quantity: item.quantity,
      unitPriceTtc: Number(item.unitPriceTtc),
      taxRate: Number(item.taxRate),
      lineTotal: Number(item.lineTotal)
    }));
}

function mapDetaxSkippedItems(sale: {
  id: string;
  number: string;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPriceTtc: { toString(): string } | number;
    lineTotal: { toString(): string } | number;
    product: {
      name: string;
      reference: string;
      isTaxExempt: boolean;
    };
  }>;
}) {
  return sale.items
    .filter((item) => item.product.reference === "POS-ORDER-DEPOSIT" || !item.product.isTaxExempt)
    .map((item) => ({
      id: item.id,
      saleItemId: item.id,
      sourceTicketId: sale.id,
      sourceTicketNumber: sale.number,
      productId: item.productId,
      productName: item.product.name,
      reference: item.product.reference,
      quantity: item.quantity,
      unitPriceTtc: Number(item.unitPriceTtc),
      lineTotal: Number(item.lineTotal),
      reason: item.product.reference === "POS-ORDER-DEPOSIT"
        ? "Commande / acompte non detaxable"
        : "Article non coche detaxable"
    }));
}

function mapDetaxTicketFromAuditLog(
  log: {
    id: string;
    createdAt: Date;
    metadata: unknown;
    user?: { fullName: string | null } | null;
  }
): DetaxTicketRecord | null {
  const metadata = log.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items as Array<Record<string, unknown>> : [];
  const payments = Array.isArray(record.payments) ? record.payments as Array<Record<string, unknown>> : [];
  const number = String(record.number ?? "").trim();
  const sourceTicketId = String(record.sourceTicketId ?? "").trim();
  const sourceTicketNumber = String(record.sourceTicketNumber ?? "").trim();
  const sourceTicketsRaw = Array.isArray(record.sourceTickets) ? record.sourceTickets as Array<Record<string, unknown>> : [];
  const warehouseId = String(record.warehouseId ?? "").trim();
  const warehouseName = String(record.warehouseName ?? "").trim();
  if (!number || !sourceTicketId || !sourceTicketNumber || !warehouseId) return null;
  const sourceTickets = sourceTicketsRaw.length
    ? sourceTicketsRaw.map((source, index) => ({
        sourceTicketId: String((source.sourceTicketId ?? sourceTicketId) || `source-${index}`),
        sourceTicketNumber: String(source.sourceTicketNumber ?? sourceTicketNumber),
        sourceTicketDate: String(source.sourceTicketDate ?? record.sourceTicketDate ?? log.createdAt.toISOString()),
        warehouseId: String(source.warehouseId ?? warehouseId),
        warehouseName: String(source.warehouseName ?? warehouseName),
        customerName: source.customerName == null ? null : String(source.customerName),
        sellerName: source.sellerName == null ? null : String(source.sellerName)
      }))
    : [{
        sourceTicketId,
        sourceTicketNumber,
        sourceTicketDate: String(record.sourceTicketDate ?? log.createdAt.toISOString()),
        warehouseId,
        warehouseName,
        customerName: record.customerName == null ? null : String(record.customerName),
        sellerName: record.sellerName == null ? null : String(record.sellerName)
      }];
  return {
    id: log.id,
    number,
    sourceTicketId,
    sourceTicketNumber,
    sourceTicketDate: String(record.sourceTicketDate ?? log.createdAt.toISOString()),
    sourceTickets,
    warehouseId,
    warehouseName,
    customerName: record.customerName == null ? null : String(record.customerName),
    sellerName: record.sellerName == null ? null : String(record.sellerName),
    createdByName: record.createdByName == null ? (log.user?.fullName ?? null) : String(record.createdByName),
    createdAt: String(record.createdAt ?? log.createdAt.toISOString()),
    subtotal: Number(record.subtotal ?? 0),
    taxAmount: Number(record.taxAmount ?? 0),
    totalAmount: Number(record.totalAmount ?? 0),
    itemCount: Number(record.itemCount ?? items.length),
    items: items.map((item, index) => ({
      id: String(item.id ?? item.saleItemId ?? `detax-item-${index}`),
      saleItemId: String(item.saleItemId ?? item.id ?? `detax-item-${index}`),
      sourceTicketId: String(item.sourceTicketId ?? sourceTicketId),
      sourceTicketNumber: String(item.sourceTicketNumber ?? sourceTicketNumber),
      productId: String(item.productId ?? ""),
      productName: String(item.productName ?? ""),
      reference: String(item.reference ?? ""),
      quantity: Number(item.quantity ?? 0),
      unitPriceTtc: Number(item.unitPriceTtc ?? 0),
      taxRate: Number(item.taxRate ?? 0),
      lineTotal: Number(item.lineTotal ?? 0)
    })),
    payments: payments.map((payment) => ({
      method: String(payment.method ?? ""),
      displayMethod: payment.displayMethod == null ? null : String(payment.displayMethod),
      amount: Number(payment.amount ?? 0),
      reference: payment.reference == null ? null : String(payment.reference)
    }))
  };
}

const ticketUpdateSchema = z.object({
  sellerName: z.string().optional().nullable(),
  items: z.array(z.object({
    id: z.string().optional(),
    productId: z.string().optional(),
    quantity: z.coerce.number().int().positive(),
    unitPriceTtc: z.coerce.number().nonnegative(),
    kind: z.enum(["PRODUCT", "ORDER_DEPOSIT"]).optional().default("PRODUCT"),
    orderType: z.string().optional(),
    orderNumber: z.string().optional(),
    orderTotal: z.coerce.number().optional(),
    depositAmount: z.coerce.number().optional()
  })).min(1),
  payments: z.array(z.object({
    id: z.string().optional(),
    method: z.string().min(1),
    amount: z.coerce.number().positive(),
    reference: z.string().optional().nullable()
  })).min(1)
});

const cashReportQuerySchema = z.object({
  warehouseId: z.string().optional(),
  registerId: z.string().optional(),
  date: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});

posRouter.get("/catalog", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = String(req.query.query ?? "").trim();
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const queryWarehouseId = String(req.query.warehouseId ?? "").trim() || scopedWarehouseId || null;
  if (queryWarehouseId) ensureWarehouseAccess(req.currentUser, queryWarehouseId);
  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      ...(query ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { reference: { contains: query, mode: "insensitive" } },
          { barcode: { contains: query, mode: "insensitive" } },
          { variants: { some: { OR: [
            { reference: { contains: query, mode: "insensitive" } },
            { barcode: { contains: query, mode: "insensitive" } },
            { color: { contains: query, mode: "insensitive" } },
            { size: { contains: query, mode: "insensitive" } }
          ] } } }
        ]
      } : {})
    },
    orderBy: { name: "asc" },
    include: { variants: true },
    take: 80
  });
  const [stockBalances, variantStockBalances] = await Promise.all([
    readStockBalances(),
    readVariantStockBalances()
  ]);

  const rows = products.reduce<Array<{ id: string; productId: string; variantId: string | null; name: string; reference: string; barcode: string | null; salePriceTtc: number; regularSalePriceTtc: number; promoPriceActive: boolean; stockOnHand: number; color: string | null; size: string | null; imageUrl: string | null }>>((acc, product) => {
    const promoPriceActive = Boolean(product.promoPriceActive && product.promoPriceTtc && Number(product.promoPriceTtc) > 0);
    const effectiveSalePriceTtc = promoPriceActive ? Number(product.promoPriceTtc) : Number(product.salePriceTtc);
    if (!product.variants.length) {
      const locationStock = queryWarehouseId ? getLocationStock(stockBalances, product.id, queryWarehouseId) : getProductStockTotal(stockBalances, product.id);
      acc.push({
        id: product.id,
        productId: product.id,
        variantId: null,
        name: product.name,
        reference: product.reference,
        barcode: product.barcode,
        salePriceTtc: effectiveSalePriceTtc,
        regularSalePriceTtc: Number(product.salePriceTtc),
        promoPriceActive,
        stockOnHand: locationStock || product.stockOnHand,
        color: null,
        size: null,
        imageUrl: product.imageUrl
      });
      return acc;
    }

    product.variants
      .filter((variant) => matchesCatalogQuery([
        product.name,
        product.reference,
        product.barcode,
        variant.reference,
        variant.barcode,
        variant.color,
        variant.size,
        Number(product.salePriceTtc).toString()
      ], query))
      .forEach((variant) => {
        const displayReference = buildCatalogVariantReference(product.reference, variant.reference);
        const locationStock = queryWarehouseId ? getVariantLocationStock(variantStockBalances, variant.id, queryWarehouseId) : getVariantStockTotal(variantStockBalances, variant.id);
        acc.push({
          id: variant.id,
          productId: product.id,
          variantId: variant.id,
          name: [product.name, variant.color, variant.size].filter(Boolean).join(" - "),
          reference: displayReference,
          barcode: variant.barcode ?? product.barcode,
          salePriceTtc: effectiveSalePriceTtc,
          regularSalePriceTtc: Number(product.salePriceTtc),
          promoPriceActive,
          stockOnHand: locationStock || variant.stockOnHand,
          color: variant.color,
          size: variant.size,
          imageUrl: product.imageUrl
        });
      });

    return acc;
  }, []);

  return ok(res, rows.slice(0, 120));
}));

posRouter.get("/bootstrap", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [customers, warehouses, sellers, registers, transporters, currencies, companySettings, boutiquesConfigSetting] = await Promise.all([
    prisma.customer.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    prisma.warehouse.findMany({ where: { type: "STORE", ...(scopedWarehouseId ? { id: scopedWarehouseId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, address: true } }),
    prisma.seller.findMany({ where: { isActive: true, ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}) }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    prisma.cashRegister.findMany({ where: scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined, orderBy: { name: "asc" }, select: { id: true, name: true, warehouseId: true } }),
    prisma.transporter.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.currency.findMany({ where: { isActive: true }, orderBy: [{ isBase: "desc" }, { code: "asc" }] }),
    prisma.setting.findMany({ where: { key: { in: ["company_name", "company_logo_url", "company_address", "company_phone", "company_email", "company_website", "ticket_cgv", "ticket_footer", "ticket_print_profiles"] } } }),
    prisma.setting.findUnique({ where: { key: "boutiques_config" } })
  ]);
  const paymentMethodsSetting = await prisma.setting.findUnique({ where: { key: "payment_methods" } });
  const paymentMethods = Array.isArray(paymentMethodsSetting?.value)
    ? (paymentMethodsSetting.value as Array<{ id: string; code: string; label: string; isActive: boolean }>).filter((item) => item.isActive !== false)
    : [];
  const settingsMap = Object.fromEntries(companySettings.map((setting) => [setting.key, typeof setting.value === "string" ? setting.value : ""]));
  const ticketPrintProfilesSetting = companySettings.find((setting) => setting.key === "ticket_print_profiles");
  const boutiquesConfig = Array.isArray(boutiquesConfigSetting?.value)
    ? boutiquesConfigSetting.value as Array<{ id: string; name?: string; address?: string; phone?: string }>
    : [];
  const enrichedWarehouses = warehouses.map((warehouse) => {
    const config = boutiquesConfig.find((item) => item.id === warehouse.id);
    return {
      ...warehouse,
      address: config?.address || warehouse.address || "",
      phone: config?.phone || ""
    };
  });
  return ok(res, {
    customers,
    warehouses: enrichedWarehouses,
    sellers,
    registers,
    transporters,
    currencies: currencies.map((currency) => ({ ...currency, rateFromMad: Number(currency.rateFromMad) })),
    paymentMethods,
    company: {
      name: settingsMap.company_name || "Galerie des Tanneurs",
      logoUrl: settingsMap.company_logo_url || "",
      address: settingsMap.company_address || "",
      phone: settingsMap.company_phone || "",
      email: settingsMap.company_email || "",
      website: settingsMap.company_website || "",
      cgvTerms: settingsMap.ticket_cgv || "",
      ticketFooter: settingsMap.ticket_footer || "",
      ticketPrintProfiles: ticketPrintProfilesSetting?.value && typeof ticketPrintProfilesSetting.value === "object" ? ticketPrintProfilesSetting.value : null
    }
  });
}));

posRouter.post("/manager-authorization", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = managerAuthorizationSchema.parse(req.body);
  const warehouseId = payload.warehouseId || req.currentUser?.defaultWarehouse?.id || null;
  if (warehouseId) ensureWarehouseAccess(req.currentUser, warehouseId);

  const username = sanitizeLoginUsername(String(payload.code || "").replace(/^MGR[-:]/i, ""));
  if (!username) {
    throw new AppError("Badge manager invalide.", 401);
  }

  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        userRoles: { some: { role: { name: "manager" } } },
        ...(warehouseId ? { defaultWarehouseId: warehouseId } : {})
      }
    }),
    readUserLoginProfiles()
  ]);

  const manager = users.find((item) => {
    const profile = profiles.find((entry) => entry.userId === item.id);
    const profileUsername = sanitizeLoginUsername(profile?.loginUsername || "") || buildDefaultManagerUsername(item.fullName, item.id);
    return profileUsername === username;
  });

  if (!manager) {
    throw new AppError("Badge manager invalide.", 401);
  }

  const managerWarehouse = manager.defaultWarehouseId
    ? await prisma.warehouse.findUnique({
        where: { id: manager.defaultWarehouseId },
        select: { id: true, name: true }
      })
    : null;

  return ok(res, {
    id: manager.id,
    fullName: manager.fullName,
    warehouseId: managerWarehouse?.id ?? null,
    warehouseName: managerWarehouse?.name ?? null
  });
}));

posRouter.get("/reports/cash", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = cashReportQuerySchema.parse(req.query ?? {});
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const warehouseId = query.warehouseId || scopedWarehouseId;
  if (!warehouseId) throw new AppError("Boutique obligatoire pour le rapport caisse.", 422);
  ensureWarehouseAccess(req.currentUser, warehouseId);

  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(query.dateFrom ?? "")) ? String(query.dateFrom) : "";
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo ?? "")) ? String(query.dateTo) : "";
  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date ?? "")) ? String(query.date) : getMoroccoTodayIso();
  const effectiveDateFrom = dateFrom || reportDate;
  const effectiveDateTo = dateTo || reportDate;
  const registerId = String(query.registerId ?? "").trim() || null;
  const paymentMethodsSetting = await prisma.setting.findUnique({ where: { key: "payment_methods" } });
  const paymentLabels = new Map(
    Array.isArray(paymentMethodsSetting?.value)
      ? (paymentMethodsSetting.value as Array<{ code: string; label: string; isActive?: boolean }>)
          .map((item) => [String(item.code || "").trim().toUpperCase(), item.label])
      : []
  );

  const [warehouse, register] = await Promise.all([
    prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, name: true, code: true }
    }),
    registerId
      ? prisma.cashRegister.findUnique({
          where: { id: registerId },
          select: { id: true, name: true, warehouseId: true, isActive: true }
        })
      : prisma.cashRegister.findFirst({
          where: { warehouseId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, warehouseId: true, isActive: true }
        })
  ]);

  if (!warehouse) throw new AppError("Boutique introuvable.", 404);
  if (register && register.warehouseId !== warehouseId) {
    throw new AppError("La caisse selectionnee n'appartient pas a cette boutique.", 422);
  }

  const dateStart = buildDateStart(effectiveDateFrom);
  const dateEnd = buildDateEnd(effectiveDateTo);
  const registerSaleIds = register
    ? (await prisma.auditLog.findMany({
        where: {
          action: "pos.checkout",
          entityType: "sale",
          createdAt: {
            gte: dateStart,
            lte: dateEnd
          }
        },
        select: {
          entityId: true,
          metadata: true
        }
      }))
        .filter((log) => {
          const metadata = log.metadata && typeof log.metadata === "object"
            ? log.metadata as { registerId?: string }
            : null;
          return metadata?.registerId === register.id;
        })
        .map((log) => log.entityId)
        .filter((value): value is string => Boolean(value))
    : [];

  const [session, sales, checkoutLogs, customerCreditRepayments] = await Promise.all([
    prisma.cashSession.findFirst({
      where: {
        register: register ? { id: register.id } : { warehouseId },
        openedAt: {
          gte: dateStart,
          lte: dateEnd
        }
      },
      orderBy: { openedAt: "desc" },
      include: {
        register: { select: { id: true, name: true } },
        openedBy: { select: { id: true, fullName: true } }
      }
    }),
    prisma.sale.findMany({
      where: {
        warehouseId,
        ...(register ? { id: { in: registerSaleIds.length ? registerSaleIds : ["__no_pos_sales_for_register__"] } } : {}),
        createdAt: {
          gte: dateStart,
          lte: dateEnd
        }
      },
      orderBy: { createdAt: "asc" },
      include: {
        payments: true,
        customer: { select: { fullName: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                reference: true,
                category: { select: { id: true, name: true } }
              }
            }
          }
        }
      }
    }),
    prisma.auditLog.findMany({
      where: {
        action: "pos.checkout",
        entityType: "sale",
        createdAt: { gte: dateStart, lte: dateEnd },
        ...(register ? { entityId: { in: registerSaleIds.length ? registerSaleIds : ["__no_pos_sales_for_register__"] } } : {})
      },
      select: {
        entityId: true,
        metadata: true
      }
    }),
    loadCustomerCreditRepayments(prisma)
  ]);

  const openingLog = session
    ? await prisma.auditLog.findFirst({
        where: {
          action: "cash.open",
          entityType: "cash_session",
          entityId: session.id
        },
        orderBy: { createdAt: "desc" }
      })
    : null;
  const closingLog = session
    ? await prisma.auditLog.findFirst({
        where: {
          action: "cash.close",
          entityType: "cash_session",
          entityId: session.id
        },
        orderBy: { createdAt: "desc" }
      })
    : null;
  const openingMetadata = openingLog?.metadata && typeof openingLog.metadata === "object"
    ? openingLog.metadata as {
        openingBreakdown?: Array<{
          currencyCode?: string;
          amount?: number;
          amountMad?: number;
          rateFromMad?: number;
        }>;
      }
    : null;
  const closingMetadata = closingLog?.metadata && typeof closingLog.metadata === "object"
    ? closingLog.metadata as {
        closingBreakdown?: Array<{
          currencyCode?: string;
          amount?: number;
          amountMad?: number;
          rateFromMad?: number;
        }>;
      }
    : null;
  const checkoutLogMap = new Map(
    checkoutLogs.map((log) => [
      String(log.entityId),
      extractCheckoutPayments(log.metadata)
    ])
  );

  const paymentSummaryMap = new Map<string, { method: string; label: string; amount: number }>();
  const categorySummaryMap = new Map<string, {
    categoryId: string | null;
    categoryName: string;
    quantity: number;
    totalAmount: number;
    articles: Map<string, { productId: string; reference: string; name: string; quantity: number; totalAmount: number }>;
  }>();

  let subtotalHt = 0;
  let taxAmount = 0;
  let discountAmount = 0;
  let shippingFee = 0;
  let totalAmount = 0;
  let paidAmount = 0;
  let articlesSold = 0;
  let cashChangeMad = 0;
  let foreignChangeMad = 0;
  let euroTendered = 0;
  let usdTendered = 0;
  let euroChange = 0;
  let usdChange = 0;

  for (const sale of sales) {
    subtotalHt += Number(sale.subtotal);
    taxAmount += Number(sale.taxAmount);
    discountAmount += Number(sale.discountAmount);
    shippingFee += Number(sale.shippingFee);
    totalAmount += Number(sale.totalAmount);
    paidAmount += Number(sale.paidAmount);

    for (const payment of sale.payments) {
      if (payment.direction !== "IN") continue;
      const method = String(payment.method).trim().toUpperCase();
      const current = paymentSummaryMap.get(method) ?? {
        method,
        label: formatPaymentMethodLabel(method, paymentLabels),
        amount: 0
      };
      current.amount += Number(payment.amount);
      paymentSummaryMap.set(method, current);
    }

    for (const payment of checkoutLogMap.get(sale.id) ?? []) {
      if (payment.method === "FOREIGN_CURRENCY") {
        const currencyCode = String(payment.currencyCode ?? "").trim().toUpperCase();
        const tenderedAmount = Number(payment.tenderedAmount ?? 0);
        const changeCurrency = Number(payment.changeCurrency ?? 0);
        const changeMode = String(payment.changeMode ?? "").trim().toUpperCase();
        if (changeMode === "MAD") {
          foreignChangeMad += Number(payment.changeMad ?? 0);
        }
        if (currencyCode === "EUR") {
          euroTendered += tenderedAmount;
          if (changeMode === "CURRENCY") euroChange += changeCurrency;
        }
        if (currencyCode === "USD") {
          usdTendered += tenderedAmount;
          if (changeMode === "CURRENCY") usdChange += changeCurrency;
        }
      }
    }

    for (const item of sale.items) {
      if (item.product.reference === "POS-ORDER-DEPOSIT") continue;
      articlesSold += item.quantity;
      const categoryId = item.product.category?.id ?? null;
      const categoryName = item.product.category?.name ?? "Sans categorie";
      const categoryKey = categoryId ?? "uncategorized";
      const currentCategory = categorySummaryMap.get(categoryKey) ?? {
        categoryId,
        categoryName,
        quantity: 0,
        totalAmount: 0,
        articles: new Map<string, { productId: string; reference: string; name: string; quantity: number; totalAmount: number }>()
      };
      currentCategory.quantity += item.quantity;
      currentCategory.totalAmount += Number(item.lineTotal);
      const currentArticle = currentCategory.articles.get(item.productId) ?? {
        productId: item.productId,
        reference: item.product.reference,
        name: item.product.name,
        quantity: 0,
        totalAmount: 0
      };
      currentArticle.quantity += item.quantity;
      currentArticle.totalAmount += Number(item.lineTotal);
      currentCategory.articles.set(item.productId, currentArticle);
      categorySummaryMap.set(categoryKey, currentCategory);
    }
  }

  for (const repayment of getCustomerCreditRepaymentWindow(customerCreditRepayments, dateStart, dateEnd, warehouseId)) {
    const method = normalizeCustomerCreditRepaymentMethod(repayment.method);
    const current = paymentSummaryMap.get(method) ?? {
      method,
      label: formatPaymentMethodLabel(method, paymentLabels),
      amount: 0
    };
    current.amount += Number(repayment.amount || 0);
    paymentSummaryMap.set(method, current);
    paidAmount += Number(repayment.amount || 0);
  }

  const paymentSummary = Array.from(paymentSummaryMap.values())
    .sort((left, right) => left.label.localeCompare(right.label, "fr"))
    .map((entry) => ({
      ...entry,
      amount: Number(entry.amount.toFixed(2))
    }));

  const categorySummary = Array.from(categorySummaryMap.values())
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName, "fr"))
    .map((entry) => ({
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      quantity: entry.quantity,
      totalAmount: Number(entry.totalAmount.toFixed(2)),
      articles: Array.from(entry.articles.values())
        .sort((left, right) => left.name.localeCompare(right.name, "fr"))
        .map((article) => ({
          ...article,
          totalAmount: Number(article.totalAmount.toFixed(2))
        }))
    }));

  const ticketSummary = sales.map((sale) => ({
    id: sale.id,
    number: sale.number,
    createdAt: sale.createdAt,
    customerName: sale.customer?.fullName ?? "Client comptoir",
    sellerName: sale.sellerName ?? "Non renseigne",
    totalAmount: Number(sale.totalAmount),
    paidAmount: Number(sale.paidAmount),
    remainingAmount: Number(Math.max(0, Number(sale.totalAmount) - Number(sale.paidAmount)).toFixed(2)),
    itemsCount: sale.items.reduce((sum, item) => sum + item.quantity, 0),
    payments: sale.payments
      .filter((payment) => payment.direction === "IN")
      .map((payment) => ({
        method: String(payment.method).trim().toUpperCase(),
        label: formatPaymentMethodLabel(String(payment.method), paymentLabels),
        amount: Number(payment.amount),
        reference: payment.reference ?? null
      }))
  }));
  const openingBreakdown = (openingMetadata?.openingBreakdown ?? [])
    .filter((entry) => Number(entry.amount ?? 0) > 0)
    .map((entry) => ({
      currencyCode: String(entry.currencyCode ?? "").toUpperCase(),
      amount: Number(entry.amount ?? 0),
      amountMad: Number(entry.amountMad ?? 0),
      rateFromMad: Number(entry.rateFromMad ?? 0)
    }));
  const closingBreakdown = (closingMetadata?.closingBreakdown ?? [])
    .filter((entry) => Number(entry.amount ?? 0) > 0)
    .map((entry) => ({
      currencyCode: String(entry.currencyCode ?? "").toUpperCase(),
      amount: Number(entry.amount ?? 0),
      amountMad: Number(entry.amountMad ?? 0),
      rateFromMad: Number(entry.rateFromMad ?? 0)
    }));
  const paymentAmountByMethod = (method: string) => paymentSummary.find((entry) => entry.method === method)?.amount ?? 0;
  const openingCashMad = openingBreakdown.find((entry) => entry.currencyCode === "MAD")?.amountMad ?? 0;
  const openingForeignMad = openingBreakdown
    .filter((entry) => entry.currencyCode !== "MAD")
    .reduce((sum, entry) => sum + entry.amountMad, 0);
  const voucherAmount = paymentAmountByMethod("VOUCHER");
  const cardAmount = paymentAmountByMethod("CARD");
  const cashAmount = paymentAmountByMethod("CASH");
  const foreignAmount = paymentAmountByMethod("FOREIGN_CURRENCY");
  const creditAmount = paymentAmountByMethod("CREDIT");
  const transferAmount = paymentAmountByMethod("TRANSFER");
  const chequeAmount = paymentAmountByMethod("CHEQUE");
  const reportBreakdown = {
    totalDayNet: Number((totalAmount - voucherAmount).toFixed(2)),
    cardAmount: Number(cardAmount.toFixed(2)),
    cashAmount: Number((cashAmount - foreignChangeMad).toFixed(2)),
    foreignAmount: Number((foreignAmount - foreignChangeMad - openingForeignMad).toFixed(2)),
    euroAmount: Number((Math.max(euroTendered - euroChange, 0)).toFixed(2)),
    usdAmount: Number((Math.max(usdTendered - usdChange, 0)).toFixed(2)),
    voucherAmount: Number(voucherAmount.toFixed(2)),
    creditAmount: Number(creditAmount.toFixed(2)),
    transferAmount: Number(transferAmount.toFixed(2)),
    chequeAmount: Number(chequeAmount.toFixed(2)),
    cashChangeMad: Number(cashChangeMad.toFixed(2)),
    foreignChangeMad: Number(foreignChangeMad.toFixed(2)),
    openingCashMad: Number(openingCashMad.toFixed(2)),
    openingForeignMad: Number(openingForeignMad.toFixed(2))
  };

  return ok(res, {
    date: reportDate,
    period: {
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo,
      isRange: effectiveDateFrom !== effectiveDateTo
    },
    warehouse: {
      id: warehouse.id,
      name: warehouse.name,
      code: warehouse.code
    },
    register: register
      ? {
          id: register.id,
          name: register.name
        }
      : null,
    session: session
      ? {
          id: session.id,
          openingAmount: Number(session.openingAmount),
          closingAmount: session.closingAmount == null ? null : Number(session.closingAmount),
          expectedAmount: session.expectedAmount == null ? null : Number(session.expectedAmount),
          varianceAmount: session.varianceAmount == null ? null : Number(session.varianceAmount),
          status: session.status,
          openedAt: session.openedAt,
          closedAt: session.closedAt,
          openedBy: {
            id: session.openedBy.id,
            fullName: session.openedBy.fullName
          },
          openingBreakdown,
          closingBreakdown
        }
      : null,
    totals: {
      ticketsCount: sales.length,
      articlesSold,
      subtotalHt: Number(subtotalHt.toFixed(2)),
      taxAmount: Number(taxAmount.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      shippingFee: Number(shippingFee.toFixed(2)),
      totalAmount: Number(totalAmount.toFixed(2)),
      paidAmount: Number(paidAmount.toFixed(2)),
      openingFund: Number(session?.openingAmount ?? 0),
      cashTheoretical: Number((Number(session?.openingAmount ?? 0) + (paymentSummary.find((entry) => entry.method === "CASH")?.amount ?? 0)).toFixed(2))
    },
    reportBreakdown,
    paymentSummary,
    categorySummary,
    ticketSummary
  });
}));

posRouter.get("/sessions/overview", requirePermissions("cash_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = cashSessionsOverviewQuerySchema.parse(req.query ?? {});
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const warehouseId = query.warehouseId || scopedWarehouseId;
  if (!warehouseId) throw new AppError("Boutique obligatoire pour la synthese caisse.", 422);
  ensureWarehouseAccess(req.currentUser, warehouseId);

  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date ?? "")) ? String(query.date) : getMoroccoTodayIso();
  const registerId = String(query.registerId ?? "").trim() || null;
  const dateStart = buildDateStart(reportDate);
  const dateEnd = buildDateEnd(reportDate);

  const [warehouse, registers, sessions, sessionLogs] = await Promise.all([
    prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, name: true, code: true }
    }),
    prisma.cashRegister.findMany({
      where: { warehouseId, ...(registerId ? { id: registerId } : {}) },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" }
    }),
    prisma.cashSession.findMany({
      where: {
        register: { warehouseId },
        ...(registerId ? { registerId } : {}),
        OR: [
          { openedAt: { gte: dateStart, lte: dateEnd } },
          { closedAt: { gte: dateStart, lte: dateEnd } },
          { status: "OPEN" }
        ]
      },
      include: {
        register: { select: { id: true, name: true, warehouse: { select: { name: true } } } },
        openedBy: { select: { id: true, fullName: true } }
      },
      orderBy: { openedAt: "desc" }
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: "cash_session",
        action: { in: ["cash.open", "cash.close"] }
      },
      include: {
        user: { select: { id: true, fullName: true } }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  if (!warehouse) throw new AppError("Boutique introuvable.", 404);

  const openSessions = sessions.filter((session) => session.status === "OPEN");
  const salesRangeStart = openSessions.length
    ? new Date(Math.min(dateStart.getTime(), ...openSessions.map((session) => session.openedAt.getTime())))
    : dateStart;
  const salesRangeEnd = openSessions.length ? new Date() : dateEnd;

  const [checkoutLogs, sales] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        action: "pos.checkout",
        entityType: "sale",
        createdAt: { gte: salesRangeStart, lte: salesRangeEnd }
      },
      select: {
        entityId: true,
        metadata: true
      }
    }),
    prisma.sale.findMany({
      where: {
        warehouseId,
        createdAt: { gte: salesRangeStart, lte: salesRangeEnd }
      },
      select: {
        id: true,
        number: true,
        createdAt: true,
        totalAmount: true,
        paidAmount: true
      }
    })
  ]);

  const sessionSalesMap = new Map<string, { turnoverAmount: number; paidAmount: number; ticketsCount: number; tickets: Array<{ id: string; number: string; createdAt: Date; totalAmount: number }> }>();
  const relevantRegisterIds = new Set(registers.map((item) => item.id));
  const salesById = new Map(sales.map((sale) => [sale.id, sale]));
  const sessionsByRegister = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const current = sessionsByRegister.get(session.registerId) ?? [];
    current.push(session);
    sessionsByRegister.set(session.registerId, current);
  }
  for (const sessionList of sessionsByRegister.values()) {
    sessionList.sort((left, right) => new Date(left.openedAt).getTime() - new Date(right.openedAt).getTime());
  }

  for (const log of checkoutLogs) {
    const saleId = log.entityId ? String(log.entityId) : null;
    const linkedRegisterId = extractRegisterIdFromAuditMetadata(log.metadata);
    if (!saleId || !linkedRegisterId) continue;
    if (registerId && linkedRegisterId !== registerId) continue;
    relevantRegisterIds.add(linkedRegisterId);
    const sale = salesById.get(saleId);
    if (!sale) continue;
    const registerSessions = sessionsByRegister.get(linkedRegisterId) ?? [];
    const matchingSession = [...registerSessions]
      .reverse()
      .find((session) => {
        const saleTime = sale.createdAt.getTime();
        const openedAt = session.openedAt.getTime();
        const closedAt = session.closedAt ? new Date(session.closedAt).getTime() : Number.POSITIVE_INFINITY;
        return saleTime >= openedAt && saleTime <= closedAt;
      });
    if (!matchingSession) continue;
    const current = sessionSalesMap.get(matchingSession.id) ?? { turnoverAmount: 0, paidAmount: 0, ticketsCount: 0, tickets: [] };
    current.turnoverAmount += Number(sale.totalAmount);
    current.paidAmount += Number(sale.paidAmount);
    current.ticketsCount += 1;
    current.tickets.push({
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      totalAmount: Number(sale.totalAmount)
    });
    sessionSalesMap.set(matchingSession.id, current);
  }

  const sessionLogMap = new Map<string, { openingBreakdown: Array<{ currencyCode: string; amount: number; amountMad: number; rateFromMad: number }>; closingBreakdown: Array<{ currencyCode: string; amount: number; amountMad: number; rateFromMad: number }>; closedBy: { id: string; fullName: string } | null }>();
  for (const log of sessionLogs) {
    const sessionId = log.entityId ? String(log.entityId) : null;
    if (!sessionId) continue;
    const current = sessionLogMap.get(sessionId) ?? { openingBreakdown: [], closingBreakdown: [], closedBy: null };
    if (log.action === "cash.open" && !current.openingBreakdown.length) {
      current.openingBreakdown = extractCurrencyBreakdown(log.metadata, "openingBreakdown");
    }
    if (log.action === "cash.close" && !current.closingBreakdown.length) {
      current.closingBreakdown = extractCurrencyBreakdown(log.metadata, "closingBreakdown");
      current.closedBy = log.user ? { id: log.user.id, fullName: log.user.fullName } : null;
    }
    sessionLogMap.set(sessionId, current);
  }

  const history = sessions.map((session) => {
    const sessionLogsEntry = sessionLogMap.get(session.id);
    const salesSummary = sessionSalesMap.get(session.id);
    return {
      id: session.id,
      register: {
        id: session.register.id,
        name: session.register.name
      },
      warehouse: {
        id: warehouse.id,
        name: session.register.warehouse.name
      },
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openingAmount: Number(session.openingAmount),
      closingAmount: session.closingAmount == null ? null : Number(session.closingAmount),
      expectedAmount: session.expectedAmount == null ? null : Number(session.expectedAmount),
      varianceAmount: session.varianceAmount == null ? null : Number(session.varianceAmount),
      openedBy: {
        id: session.openedBy.id,
        fullName: session.openedBy.fullName
      },
      closedBy: sessionLogsEntry?.closedBy ?? null,
      openingBreakdown: sessionLogsEntry?.openingBreakdown ?? [],
      closingBreakdown: sessionLogsEntry?.closingBreakdown ?? [],
      turnoverAmount: Number((salesSummary?.turnoverAmount ?? 0).toFixed(2)),
      paidAmount: Number((salesSummary?.paidAmount ?? 0).toFixed(2)),
      ticketsCount: salesSummary?.ticketsCount ?? 0
    };
  });

  const registerSummaries = Array.from(new Set([...Array.from(relevantRegisterIds), ...registers.map((item) => item.id)]))
    .map((id) => {
      const register = registers.find((item) => item.id === id) ?? null;
      const registerHistory = history.filter((entry) => entry.register.id === id).sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime());
      const latestSession = registerHistory[0] ?? null;
      const salesSummary = latestSession ? sessionSalesMap.get(latestSession.id) : null;
      if (!register && !latestSession && !salesSummary) return null;
      return {
        register: {
          id,
          name: register?.name ?? latestSession?.register.name ?? "Caisse"
        },
        status: latestSession?.status ?? "IDLE",
        openedAt: latestSession?.openedAt ?? null,
        closedAt: latestSession?.closedAt ?? null,
        openedBy: latestSession?.openedBy ?? null,
        turnoverAmount: Number((salesSummary?.turnoverAmount ?? 0).toFixed(2)),
        paidAmount: Number((salesSummary?.paidAmount ?? 0).toFixed(2)),
        ticketsCount: salesSummary?.ticketsCount ?? 0,
        openingAmount: latestSession?.openingAmount ?? 0,
        closingAmount: latestSession?.closingAmount ?? null
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.register.name.localeCompare(right.register.name, "fr"));

  return ok(res, {
    date: reportDate,
    warehouse,
    history,
    registers: registerSummaries
  });
}));

posRouter.get("/tickets", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = String(req.query.query ?? "").trim();
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [sales, paymentMethodsSetting, checkoutLogs] = await Promise.all([
    prisma.sale.findMany({
      where: {
        ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}),
        ...(query ? {
          OR: [
            { number: { contains: query, mode: "insensitive" } },
            { sellerName: { contains: query, mode: "insensitive" } },
            { customer: { fullName: { contains: query, mode: "insensitive" } } }
          ]
        } : {}),
        ...(dateFrom || dateTo ? {
          createdAt: {
            ...(dateFrom ? { gte: buildDateStart(dateFrom) } : {}),
            ...(dateTo ? { lte: buildDateEnd(dateTo) } : {})
          }
        } : {})
      },
      include: {
        customer: { select: { fullName: true } },
        warehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true } } } },
        payments: true
      },
      orderBy: { createdAt: "desc" },
      take: 300
    }),
    prisma.setting.findUnique({ where: { key: "payment_methods" } }),
    prisma.auditLog.findMany({
      where: {
        action: "pos.checkout",
        entityType: "sale",
        ...(dateFrom || dateTo ? {
          createdAt: {
            ...(dateFrom ? { gte: buildDateStart(dateFrom) } : {}),
            ...(dateTo ? { lte: buildDateEnd(dateTo) } : {})
          }
        } : {})
      },
      select: {
        entityId: true,
        metadata: true
      }
    })
  ]);

  const paymentLabels = new Map(
    Array.isArray(paymentMethodsSetting?.value)
      ? (paymentMethodsSetting.value as Array<{ code: string; label: string; isActive?: boolean }>)
          .map((item) => [String(item.code || "").trim().toUpperCase(), item.label])
      : []
  );
  const checkoutLogMap = new Map(
    checkoutLogs.map((log) => [
      String(log.entityId),
      extractCheckoutPayments(log.metadata)
    ])
  );

  return ok(res, sales.map((sale) => ({
    ...mapSaleToTicket(sale, {
      checkoutPayments: checkoutLogMap.get(String(sale.id)) ?? [],
      paymentLabels
    })
  })));
}));

posRouter.get("/detax-tickets", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = detaxTicketsQuerySchema.parse(req.query ?? {});
  const query = String(payload.query ?? "").trim().toLowerCase();
  const logs = await prisma.auditLog.findMany({
    where: {
      action: "pos.detax.ticket.create",
      entityType: "sale",
      ...(payload.dateFrom || payload.dateTo ? {
        createdAt: {
          ...(payload.dateFrom ? { gte: buildDateStart(payload.dateFrom) } : {}),
          ...(payload.dateTo ? { lte: buildDateEnd(payload.dateTo) } : {})
        }
      } : {})
    },
    include: {
      user: { select: { fullName: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 400
  });

  const rows = logs
    .map((log) => mapDetaxTicketFromAuditLog(log))
    .filter((row): row is DetaxTicketRecord => Boolean(row))
    .filter((row) => {
      if (!query) return true;
      return [
        row.number,
        row.sourceTicketNumber,
        ...row.sourceTickets.map((ticket) => ticket.sourceTicketNumber),
        row.customerName ?? "",
        row.warehouseName,
        row.sellerName ?? ""
      ].some((value) => String(value).toLowerCase().includes(query));
    });

  return ok(res, rows);
}));

posRouter.post("/detax-tickets/preview", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = detaxPreviewSchema.parse(req.body ?? {});
  const normalizedCode = normalizeTicketLookupValue(payload.ticketCode);
  const normalizedDigits = normalizeTicketDigits(payload.ticketCode);
  const [sale, paymentMethodsSetting] = await Promise.all([
    prisma.sale.findFirst({
      where: {
        OR: [
          { number: normalizedCode },
          ...(normalizedDigits.length >= 3
            ? [
                { number: { endsWith: normalizedDigits } },
                { number: { contains: normalizedDigits } }
              ]
            : [])
        ]
      },
      include: {
        customer: { select: { fullName: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                reference: true,
                isTaxExempt: true
              }
            }
          }
        },
        payments: true
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.setting.findUnique({ where: { key: "payment_methods" } })
  ]);
  if (!sale) throw new AppError("Ticket de caisse introuvable.", 404);
  if (hasTicketMarker(sale.note, POS_TICKET_MARKERS.invoiced)) {
    throw new AppError("Un ticket facture ne peut pas passer en detaxe.", 400);
  }
  if (hasTicketMarker(sale.note, POS_TICKET_MARKERS.detaxed)) {
    throw new AppError("Ce ticket est deja passe en detaxe.", 400);
  }

  const detaxableItems = mapDetaxEligibleItems(sale);
  const skippedItems = mapDetaxSkippedItems(sale);
  const paymentLabels = new Map(
    Array.isArray(paymentMethodsSetting?.value)
      ? (paymentMethodsSetting.value as Array<{ code: string; label: string; isActive?: boolean }>)
          .map((item) => [String(item.code || "").trim().toUpperCase(), item.label])
      : []
  );
  const checkoutPayments = extractCheckoutPayments((await prisma.auditLog.findFirst({
    where: {
      action: "pos.checkout",
      entityType: "sale",
      entityId: sale.id
    },
    select: { metadata: true },
    orderBy: { createdAt: "desc" }
  }))?.metadata);

  const payments = sale.payments.map((payment) => ({
    method: payment.method,
    displayMethod: buildDisplayPaymentLabel(payment.method, checkoutPayments, paymentLabels),
    amount: Number(payment.amount),
    reference: payment.reference
  }));
  const subtotal = Number(
    detaxableItems.reduce((sum, item) => sum + item.lineTotal / (1 + item.taxRate / 100), 0).toFixed(2)
  );
  const totalAmount = Number(detaxableItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const taxAmount = Number((totalAmount - subtotal).toFixed(2));

  return ok(res, {
    sourceTicketId: sale.id,
    sourceTicketNumber: sale.number,
    sourceTicketDate: sale.createdAt,
    sourceTickets: [{
      sourceTicketId: sale.id,
      sourceTicketNumber: sale.number,
      sourceTicketDate: sale.createdAt.toISOString(),
      warehouseId: sale.warehouse.id,
      warehouseName: sale.warehouse.name,
      customerName: sale.customer?.fullName ?? null,
      sellerName: sale.sellerName ?? null
    }],
    warehouseId: sale.warehouse.id,
    warehouseName: sale.warehouse.name,
    customerName: sale.customer?.fullName ?? null,
    sellerName: sale.sellerName ?? null,
    items: detaxableItems,
    skippedItems,
    subtotal,
    taxAmount,
    totalAmount,
    payments
  });
}));

posRouter.post("/detax-tickets", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = detaxCreateSchema.parse(req.body ?? {});
  const sourceTicketIds = Array.from(new Set(payload.sourceTickets.map((entry) => entry.sourceTicketId)));
  const [sales, paymentMethodsSetting, checkoutLogs] = await Promise.all([
    prisma.sale.findMany({
      where: { id: { in: sourceTicketIds } },
      include: {
        customer: { select: { fullName: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                reference: true,
                isTaxExempt: true
              }
            }
          }
        },
        payments: true
      }
    }),
    prisma.setting.findUnique({ where: { key: "payment_methods" } }),
    prisma.auditLog.findMany({
      where: {
        action: "pos.checkout",
        entityType: "sale",
        entityId: { in: sourceTicketIds }
      },
      select: { entityId: true, metadata: true },
      orderBy: { createdAt: "desc" }
    })
  ]);
  if (sales.length !== sourceTicketIds.length) {
    throw new AppError("Un ou plusieurs tickets de caisse sont introuvables.", 404);
  }

  const saleMap = new Map(sales.map((sale) => [sale.id, sale]));
  const firstSale = sales[0];
  if (!firstSale?.warehouse.id) throw new AppError("Ticket de caisse introuvable.", 404);

  for (const sale of sales) {
    if (hasTicketMarker(sale.note, POS_TICKET_MARKERS.invoiced)) {
      throw new AppError(`Le ticket ${sale.number} est facture et ne peut pas passer en detaxe.`, 400);
    }
    if (hasTicketMarker(sale.note, POS_TICKET_MARKERS.detaxed)) {
      throw new AppError(`Le ticket ${sale.number} est deja passe en detaxe.`, 400);
    }
  }

  const selectedItems = payload.sourceTickets.flatMap((entry) => {
    const sale = saleMap.get(entry.sourceTicketId);
    if (!sale) return [];
    const eligibleItems = mapDetaxEligibleItems(sale);
    return eligibleItems.filter((item) => entry.itemIds.includes(item.saleItemId));
  });
  if (!selectedItems.length) {
    throw new AppError("Aucun article detaxable selectionne.", 400);
  }

  const sourceTickets = payload.sourceTickets.map((entry) => {
    const sale = saleMap.get(entry.sourceTicketId);
    if (!sale) throw new AppError("Ticket de caisse introuvable.", 404);
    return {
      sourceTicketId: sale.id,
      sourceTicketNumber: sale.number,
      sourceTicketDate: sale.createdAt.toISOString(),
      warehouseId: sale.warehouse.id,
      warehouseName: sale.warehouse.name,
      customerName: sale.customer?.fullName ?? null,
      sellerName: sale.sellerName ?? null
    };
  });

  const now = new Date();
  const [existingCount] = await prisma.$transaction(async (tx) => {
    const count = await tx.auditLog.count({
      where: {
        action: "pos.detax.ticket.create",
        createdAt: {
          gte: buildDateStart(now.toISOString().slice(0, 10)),
          lte: buildDateEnd(now.toISOString().slice(0, 10))
        }
      }
    });
    for (const sale of sales) {
      await tx.sale.update({
        where: { id: sale.id },
        data: { note: setTicketMarker(sale.note, POS_TICKET_MARKERS.detaxed, true) }
      });
    }
    return [count] as const;
  });

  const paymentLabels = new Map(
    Array.isArray(paymentMethodsSetting?.value)
      ? (paymentMethodsSetting.value as Array<{ code: string; label: string; isActive?: boolean }>)
          .map((item) => [String(item.code || "").trim().toUpperCase(), item.label])
      : []
  );
  const checkoutLogMap = new Map(checkoutLogs.map((log) => [String(log.entityId), extractCheckoutPayments(log.metadata)]));
  const payments = sales.flatMap((sale) => {
    const checkoutPayments = checkoutLogMap.get(sale.id) ?? [];
    return sale.payments.map((payment) => ({
      method: payment.method,
      displayMethod: buildDisplayPaymentLabel(payment.method, checkoutPayments, paymentLabels),
      amount: Number(payment.amount),
      reference: payment.reference
    }));
  });
  const subtotal = Number(
    selectedItems.reduce((sum, item) => sum + item.lineTotal / (1 + item.taxRate / 100), 0).toFixed(2)
  );
  const totalAmount = Number(selectedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const taxAmount = Number((totalAmount - subtotal).toFixed(2));
  const recordNumber = buildDetaxNumber(existingCount + 1, now);
  const primarySourceTicket = sourceTickets[0];
  const record: Omit<DetaxTicketRecord, "id"> = {
    number: recordNumber,
    sourceTicketId: primarySourceTicket.sourceTicketId,
    sourceTicketNumber: primarySourceTicket.sourceTicketNumber,
    sourceTicketDate: primarySourceTicket.sourceTicketDate,
    sourceTickets,
    warehouseId: primarySourceTicket.warehouseId,
    warehouseName: primarySourceTicket.warehouseName,
    customerName: String(payload.customerName ?? sourceTickets.find((entry) => entry.customerName)?.customerName ?? "").trim() || null,
    sellerName: sourceTickets.length === 1 ? primarySourceTicket.sellerName : null,
    createdByName: req.currentUser?.fullName ?? null,
    createdAt: now.toISOString(),
    subtotal,
    taxAmount,
    totalAmount,
    itemCount: selectedItems.length,
    items: selectedItems,
    payments
  };

  const log = await prisma.auditLog.create({
    data: {
      userId: req.currentUser?.id ?? null,
      action: "pos.detax.ticket.create",
      entityType: "sale",
      entityId: primarySourceTicket.sourceTicketId,
      metadata: record as Prisma.InputJsonValue
    }
  });

  return ok(res, { id: log.id, ...record }, "Ticket detaxe cree.");
}));

posRouter.get("/tickets/:id", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);
  const [sale, paymentMethodsSetting, checkoutLog] = await Promise.all([
    prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                name: true,
                reference: true,
                variants: { select: { id: true }, take: 1 }
              }
            }
          }
        },
        payments: true
      }
    }),
    prisma.setting.findUnique({ where: { key: "payment_methods" } }),
    prisma.auditLog.findFirst({
      where: {
        action: "pos.checkout",
        entityType: "sale",
        entityId: saleId
      },
      select: {
        metadata: true
      },
      orderBy: { createdAt: "desc" }
    })
  ]);
  if (!sale) throw new AppError("Ticket introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouse.id);
  const paymentLabels = new Map(
    Array.isArray(paymentMethodsSetting?.value)
      ? (paymentMethodsSetting.value as Array<{ code: string; label: string; isActive?: boolean }>)
          .map((item) => [String(item.code || "").trim().toUpperCase(), item.label])
      : []
  );
  return ok(res, buildTicketDetail(sale, {
    checkoutPayments: extractCheckoutPayments(checkoutLog?.metadata),
    paymentLabels
  }));
}));

posRouter.post("/tickets/:id/reprint", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);
  const [sale, paymentMethodsSetting, checkoutLog] = await Promise.all([
    prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                name: true,
                reference: true,
                variants: { select: { id: true }, take: 1 }
              }
            }
          }
        },
        payments: true
      }
    }),
    prisma.setting.findUnique({ where: { key: "payment_methods" } }),
    prisma.auditLog.findFirst({
      where: {
        action: "pos.checkout",
        entityType: "sale",
        entityId: saleId
      },
      select: { metadata: true },
      orderBy: { createdAt: "desc" }
    })
  ]);
  if (!sale) throw new AppError("Ticket introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouse.id);

  const paymentLabels = new Map(
    Array.isArray(paymentMethodsSetting?.value)
      ? (paymentMethodsSetting.value as Array<{ code: string; label: string; isActive?: boolean }>)
          .map((item) => [String(item.code || "").trim().toUpperCase(), item.label])
      : []
  );

  const reprintCount = await prisma.$transaction(async (tx) => {
    const previousCount = await tx.auditLog.count({
      where: {
        action: "pos.ticket.reprint",
        entityType: "sale",
        entityId: saleId
      }
    });
    const nextCount = previousCount + 1;
    await tx.auditLog.create({
      data: {
        userId: req.currentUser?.id ?? null,
        action: "pos.ticket.reprint",
        entityType: "sale",
        entityId: saleId,
        metadata: {
          number: sale.number,
          reprintCount: nextCount
        } as Prisma.InputJsonValue
      }
    });
    return nextCount;
  });

  return ok(res, {
    ticket: buildTicketDetail(sale, {
      checkoutPayments: extractCheckoutPayments(checkoutLog?.metadata),
      paymentLabels
    }),
    reprintCount
  }, "Re-impression ticket enregistree.");
}));

const ticketMarkerSchema = z.object({
  enabled: z.coerce.boolean().optional().default(true)
});

posRouter.post("/tickets/:id/facture", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);
  const payload = ticketMarkerSchema.parse(req.body ?? {});
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: { select: { fullName: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true } } } },
      payments: true
    }
  });
  if (!sale) throw new AppError("Ticket introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouseId);
  if (payload.enabled && hasTicketMarker(sale.note, POS_TICKET_MARKERS.detaxed)) {
    throw new AppError("Un ticket deja passe en detaxe ne peut pas etre facture.", 400);
  }

  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: { note: setTicketMarker(sale.note, POS_TICKET_MARKERS.invoiced, payload.enabled) },
    include: {
      customer: { select: { fullName: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true } } } },
      payments: true
    }
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: payload.enabled ? "pos.ticket.invoice" : "pos.ticket.invoice.remove",
    entityType: "sale",
    entityId: saleId
  });

  return ok(res, mapSaleToTicket(updated), payload.enabled ? "Ticket marque facture." : "Marquage facture retire.");
}));

posRouter.post("/tickets/:id/detaxe", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);
  const payload = ticketMarkerSchema.parse(req.body ?? {});
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: { select: { fullName: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true } } } },
      payments: true
    }
  });
  if (!sale) throw new AppError("Ticket introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouseId);
  if (payload.enabled && hasTicketMarker(sale.note, POS_TICKET_MARKERS.invoiced)) {
    throw new AppError("Un ticket facture ne peut pas passer en detaxe.", 400);
  }

  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: { note: setTicketMarker(sale.note, POS_TICKET_MARKERS.detaxed, payload.enabled) },
    include: {
      customer: { select: { fullName: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true } } } },
      payments: true
    }
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: payload.enabled ? "pos.ticket.detax" : "pos.ticket.detax.remove",
    entityType: "sale",
    entityId: saleId
  });

  return ok(res, mapSaleToTicket(updated), payload.enabled ? "Ticket marque detaxe." : "Marquage detaxe retire.");
}));

posRouter.put("/tickets/:id", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);
  const payload = ticketUpdateSchema.parse(req.body ?? {});

  const updated = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                reference: true,
                stockOnHand: true,
                variants: { select: { id: true }, take: 1 }
              }
            }
          }
        },
        payments: true
      }
    });

    if (!sale) throw new AppError("Ticket introuvable.", 404);
    ensureWarehouseAccess(req.currentUser, sale.warehouse.id);

    const editBlockedReason = getTicketEditBlockedReason(sale);
    if (editBlockedReason) throw new AppError(editBlockedReason, 422);

    const saleItemsById = new Map(sale.items.map((item) => [item.id, item]));
    const { preservedLines } = splitSaleNote(sale.note);
    const nextExistingItemIds = new Set(payload.items.map((item) => item.id).filter(Boolean) as string[]);
    const removedItems = sale.items.filter((item) => !nextExistingItemIds.has(item.id));
    const currentProducts = new Map(sale.items.map((item) => [item.productId, item.product]));
    const draftProducts = new Map<string, { id: string; name: string; reference: string; stockOnHand: number; taxRate: number }>();
    const orderNotes = [] as string[];
    let balances = await readStockBalances(tx);
    let variantBalances = await readVariantStockBalances(tx);
    const linePlans = [] as Array<{
      existingItemId?: string;
      productId: string;
      quantity: number;
      unitPriceHt: number;
      unitPriceTtc: number;
      discountAmount: number;
      taxRate: number;
      lineTotal: number;
      stockTracked: boolean;
    }>;

    for (const item of payload.items) {
      if (item.id && !saleItemsById.has(item.id)) {
        throw new AppError("Ligne ticket introuvable.", 422);
      }
    }

    for (const removedItem of removedItems) {
      if (removedItem.product.reference === "POS-ORDER-DEPOSIT") continue;
      const product = currentProducts.get(removedItem.productId);
      if (!product) throw new AppError("Article introuvable.", 404);
      balances = await ensureProductStockSeeded(tx, balances, product, sale.warehouse.id);
      balances = applyLocationDelta(balances, product.id, sale.warehouse.id, removedItem.quantity);
      const nextStock = product.stockOnHand + removedItem.quantity;
      await tx.product.update({
        where: { id: product.id },
        data: { stockOnHand: nextStock }
      });
      currentProducts.set(removedItem.productId, { ...product, stockOnHand: nextStock });
    }

    for (const item of payload.items) {
      const currentItem = item.id ? saleItemsById.get(item.id) : null;
      const isExistingOrderDeposit = currentItem?.product.reference === "POS-ORDER-DEPOSIT";
      const isOrderDeposit = item.kind === "ORDER_DEPOSIT" || isExistingOrderDeposit;

      if (isOrderDeposit) {
        const depositProduct = currentItem?.product.reference === "POS-ORDER-DEPOSIT"
          ? currentItem.product
          : await tx.product.upsert({
              where: { reference: "POS-ORDER-DEPOSIT" },
              update: { status: "INACTIVE" },
              create: {
                reference: "POS-ORDER-DEPOSIT",
                name: "Acompte commande",
                purchasePriceHt: 0,
                purchasePriceTtc: 0,
                salePriceHt: 0,
                salePriceTtc: 0,
                taxRate: 0,
                stockOnHand: 0,
                minStock: 0,
                status: "INACTIVE"
              }
            });
        const quantity = 1;
        const depositAmount = Number(item.depositAmount ?? item.unitPriceTtc ?? currentItem?.unitPriceTtc ?? 0);
        if (depositAmount <= 0) throw new AppError("Montant acompte commande invalide.", 422);
        const lineTotal = Number(depositAmount.toFixed(2));
        orderNotes.push(`Acompte commande ${String(item.orderNumber ?? "").trim()} (${String(item.orderType ?? "Commande").trim()}) - Total ${Number(item.orderTotal ?? 0)} MAD - Acompte ${depositAmount} MAD`);
        linePlans.push({
          existingItemId: currentItem?.id,
          productId: depositProduct.id,
          quantity,
          unitPriceHt: depositAmount,
          unitPriceTtc: depositAmount,
          discountAmount: 0,
          taxRate: 0,
          lineTotal,
          stockTracked: false
        });
        continue;
      }

      if (currentItem) {
        const product = currentProducts.get(currentItem.productId);
        if (!product) throw new AppError("Article introuvable.", 404);
        balances = await ensureProductStockSeeded(tx, balances, product, sale.warehouse.id);
        const delta = item.quantity - currentItem.quantity;

        balances = applyLocationDelta(balances, product.id, sale.warehouse.id, -delta);
        const nextStock = product.stockOnHand - delta;
        await tx.product.update({
          where: { id: product.id },
          data: { stockOnHand: nextStock }
        });
        currentProducts.set(currentItem.productId, { ...product, stockOnHand: nextStock });

        const lineDiscount = Math.min(Number(currentItem.discountAmount), Number((item.unitPriceTtc * item.quantity).toFixed(2)));
        const unitPriceHt = Number((item.unitPriceTtc / (1 + Number(currentItem.taxRate) / 100)).toFixed(2));
        const lineTotal = Number((item.unitPriceTtc * item.quantity - lineDiscount).toFixed(2));
        linePlans.push({
          existingItemId: currentItem.id,
          productId: currentItem.productId,
          quantity: item.quantity,
          unitPriceHt,
          unitPriceTtc: item.unitPriceTtc,
          discountAmount: lineDiscount,
          taxRate: Number(currentItem.taxRate),
          lineTotal,
          stockTracked: true
        });
        continue;
      }

      if (!item.productId) throw new AppError("Article introuvable.", 404);
      let product = draftProducts.get(item.productId);
      if (!product) {
        const foundProduct = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, reference: true, stockOnHand: true, taxRate: true, variants: { select: { id: true }, take: 1 } }
        });
        if (!foundProduct) throw new AppError("Article introuvable.", 404);
        if (foundProduct.variants.length) {
          throw new AppError("Ajout article a variantes indisponible dans la modification ticket.", 422);
        }
        product = {
          id: foundProduct.id,
          name: foundProduct.name,
          reference: foundProduct.reference,
          stockOnHand: foundProduct.stockOnHand,
          taxRate: Number(foundProduct.taxRate)
        };
      }
      balances = await ensureProductStockSeeded(tx, balances, product, sale.warehouse.id);
      balances = applyLocationDelta(balances, product.id, sale.warehouse.id, -item.quantity);
      const nextStock = product.stockOnHand - item.quantity;
      await tx.product.update({
        where: { id: product.id },
        data: { stockOnHand: nextStock }
      });
      draftProducts.set(item.productId, { ...product, stockOnHand: nextStock });

      const unitPriceHt = Number((item.unitPriceTtc / (1 + product.taxRate / 100)).toFixed(2));
      const lineTotal = Number((item.unitPriceTtc * item.quantity).toFixed(2));
      linePlans.push({
        productId: product.id,
        quantity: item.quantity,
        unitPriceHt,
        unitPriceTtc: item.unitPriceTtc,
        discountAmount: 0,
        taxRate: product.taxRate,
        lineTotal,
        stockTracked: true
      });
    }

    if (removedItems.length) {
      await tx.saleItem.deleteMany({
        where: {
          saleId,
          id: { in: removedItems.map((item) => item.id) }
        }
      });
    }

    let subtotal = 0;
    let taxAmount = 0;
    let discountAmount = 0;

    for (const item of linePlans) {
      subtotal += Number((item.unitPriceHt * item.quantity).toFixed(2));
      taxAmount += Number(((item.unitPriceTtc - item.unitPriceHt) * item.quantity).toFixed(2));
      discountAmount += item.discountAmount;

      if (item.existingItemId) {
        await tx.saleItem.update({
          where: { id: item.existingItemId },
          data: {
            quantity: item.quantity,
            unitPriceHt: item.unitPriceHt,
            unitPriceTtc: item.unitPriceTtc,
            lineTotal: item.lineTotal,
            discountAmount: item.discountAmount,
            taxRate: item.taxRate
          }
        });
      } else {
        await tx.saleItem.create({
          data: {
            saleId,
            productId: item.productId,
            quantity: item.quantity,
            unitPriceHt: item.unitPriceHt,
            unitPriceTtc: item.unitPriceTtc,
            lineTotal: item.lineTotal,
            discountAmount: item.discountAmount,
            taxRate: item.taxRate
          }
        });
      }
    }

    const currentPaymentIds = new Set(sale.payments.map((payment) => payment.id));
    const nextPaymentIds = new Set(payload.payments.map((payment) => payment.id).filter(Boolean) as string[]);
    const removedPaymentIds = sale.payments.filter((payment) => !nextPaymentIds.has(payment.id)).map((payment) => payment.id);

    if (removedPaymentIds.length) {
      await tx.payment.deleteMany({
        where: {
          saleId,
          id: { in: removedPaymentIds }
        }
      });
    }

    for (const payment of payload.payments) {
      const paymentData = {
        amount: payment.amount,
        method: payment.method as PaymentMethod,
        direction: "IN" as const,
        reference: payment.reference ? String(payment.reference).trim() : null
      };

      if (payment.id) {
        if (!currentPaymentIds.has(payment.id)) throw new AppError("Paiement introuvable.", 422);
        await tx.payment.update({
          where: { id: payment.id },
          data: paymentData
        });
      } else {
        await tx.payment.create({
          data: {
            saleId,
            ...paymentData
          }
        });
      }
    }

    await saveStockBalances(tx, balances);

    await tx.stockMovement.deleteMany({
      where: {
        referenceType: "sale",
        referenceId: saleId
      }
    });

    const refreshedItems = await tx.saleItem.findMany({
      where: { saleId },
      include: { product: true }
    });

    for (const item of refreshedItems) {
      if (item.product.reference === "POS-ORDER-DEPOSIT") continue;
      const beforeStock = getLocationStock(balances, item.productId, sale.warehouse.id) + item.quantity;
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: sale.warehouse.id,
          type: "OUT",
          quantity: item.quantity,
          beforeStock,
          afterStock: getLocationStock(balances, item.productId, sale.warehouse.id),
          referenceType: "sale",
          referenceId: saleId,
          notes: "Vente caisse modifiee"
        }
      });
    }

    const paidAmount = payload.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const totalAmount = Number((refreshedItems.reduce((sum, item) => sum + Number(item.lineTotal), 0) + Number(sale.shippingFee)).toFixed(2));
    const status = paidAmount >= totalAmount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";

    return tx.sale.update({
      where: { id: saleId },
      data: {
        sellerName: payload.sellerName ?? null,
        subtotal,
        taxAmount,
        discountAmount,
        totalAmount,
        paidAmount,
        status,
        note: [...preservedLines, ...orderNotes].filter(Boolean).join("\n") || null
      },
      include: {
        customer: { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                name: true,
                reference: true,
                variants: { select: { id: true }, take: 1 }
              }
            }
          }
        },
        payments: true
      }
    });
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "pos.ticket.update",
    entityType: "sale",
    entityId: saleId,
    meta: payload
  });

  return ok(res, buildTicketDetail(updated), "Ticket modifie.");
}));

posRouter.delete("/tickets/:id", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: {
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                reference: true,
                stockOnHand: true,
                variants: { select: { id: true }, take: 1 }
              }
            }
          }
        },
        payments: { select: { method: true } }
      }
    });

    if (!sale) throw new AppError("Ticket introuvable.", 404);
    ensureWarehouseAccess(req.currentUser, sale.warehouse.id);

    const editBlockedReason = getTicketEditBlockedReason(sale);
    if (editBlockedReason) throw new AppError(editBlockedReason, 422);

    const hasVariantProduct = sale.items.some((item) => item.product.reference !== "POS-ORDER-DEPOSIT" && item.product.variants.length > 0);
    if (hasVariantProduct) {
      throw new AppError("Suppression indisponible pour les tickets contenant des variantes.", 422);
    }

    let balances = await readStockBalances(tx);

    for (const item of sale.items) {
      if (item.product.reference === "POS-ORDER-DEPOSIT") continue;
      balances = await ensureProductStockSeeded(tx, balances, item.product, sale.warehouse.id);
      balances = applyLocationDelta(balances, item.productId, sale.warehouse.id, item.quantity);
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockOnHand: item.product.stockOnHand + item.quantity
        }
      });
    }

    await saveStockBalances(tx, balances);

    await tx.stockMovement.deleteMany({
      where: {
        referenceType: "sale",
        referenceId: saleId
      }
    });

    await tx.payment.deleteMany({ where: { saleId } });
    await tx.saleItem.deleteMany({ where: { saleId } });
    await tx.sale.delete({ where: { id: saleId } });
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "pos.ticket.delete",
    entityType: "sale",
    entityId: saleId
  });

  return ok(res, true, "Ticket supprime.");
}));

posRouter.post("/credits/preview", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = creditPreviewSchema.parse(req.body);
  const lookupCode = payload.ticketCode?.trim() || payload.ticket?.trim() || "";
  const normalizedCode = normalizeTicketLookupValue(lookupCode);
  const normalizedDigits = normalizeTicketDigits(lookupCode);

  const sale = await prisma.sale.findFirst({
    where: {
      OR: [
        { number: normalizedCode },
        ...(normalizedDigits ? [{ number: { endsWith: normalizedDigits } }] : []),
        ...(normalizedDigits ? [{ number: { contains: normalizedDigits } }] : [])
      ]
    },
    include: {
      customer: { select: { id: true, fullName: true, phone: true } },
      warehouse: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              reference: true,
              stockOnHand: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!sale) throw new AppError("Ticket de caisse introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouse.id);

  const store = await loadPosCreditStore(prisma);
  const creditedByItem = buildCreditedQuantityMap(store, sale.id);
  const items = sale.items
    .filter((item) => item.product.reference !== "POS-ORDER-DEPOSIT")
    .map((item) => {
      const creditedQty = Number(creditedByItem.get(item.id) ?? 0);
      const remainingQty = Math.max(0, item.quantity - creditedQty);
      return {
        saleItemId: item.id,
        productId: item.productId,
        reference: item.product.reference ?? "",
        barcode: null,
        productName: item.product.name,
        soldQty: item.quantity,
        creditedQty,
        remainingQty,
        unitPriceTtc: Number(item.unitPriceTtc),
        lineTotal: Number(item.lineTotal),
        alreadyFullyCredited: remainingQty <= 0
      };
    });

  return ok(res, {
    id: sale.id,
    number: sale.number,
    createdAt: sale.createdAt,
    customerName: sale.customer?.fullName ?? "",
    customerPhone: sale.customer?.phone ?? "",
    warehouse: sale.warehouse,
    items
  });
}));

posRouter.post("/credits", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = creditCreateSchema.parse(req.body);

  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: payload.sourceTicketId },
      include: {
        customer: { select: { id: true, fullName: true, phone: true } },
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                reference: true,
                stockOnHand: true,
                variants: { select: { id: true }, take: 1 }
              }
            }
          }
        }
      }
    });

    if (!sale) throw new AppError("Ticket de caisse introuvable.", 404);
    ensureWarehouseAccess(req.currentUser, sale.warehouse.id);

    const store = await loadPosCreditStore(tx);
    const creditedByItem = buildCreditedQuantityMap(store, sale.id);
    const saleItems = new Map(sale.items.map((item) => [item.id, item]));
    const productStocks = new Map(sale.items.map((item) => [item.productId, item.product.stockOnHand]));
    const number = buildPosCreditNumber(store);
    const voucherNumber = number;
    let balances = await readStockBalances(tx);
    const selectedItems = payload.items.map((entry) => {
      const saleItem = saleItems.get(entry.saleItemId);
      if (!saleItem) throw new AppError("Article ticket introuvable.", 404);
      if (saleItem.product.reference === "POS-ORDER-DEPOSIT") {
        throw new AppError("Les lignes de commande/acompte ne peuvent pas generer de bon d'avoir.", 422);
      }
      const alreadyCredited = Number(creditedByItem.get(saleItem.id) ?? 0);
      const remainingQty = Math.max(0, saleItem.quantity - alreadyCredited);
      if (entry.quantity > remainingQty) {
        throw new AppError(`Quantite d'avoir invalide pour ${saleItem.product.name}.`, 422);
      }
      return { saleItem, quantity: entry.quantity };
    });

    const creditAmount = Number(selectedItems.reduce((sum, entry) => sum + Number(entry.saleItem.unitPriceTtc) * entry.quantity, 0).toFixed(2));
    if (creditAmount <= 0) throw new AppError("Montant de bon d'avoir invalide.", 422);

    for (const entry of selectedItems) {
      balances = await ensureProductStockSeeded(tx, balances, entry.saleItem.product, sale.warehouse.id);
      const beforeLocationStock = getLocationStock(balances, entry.saleItem.productId, sale.warehouse.id);
      balances = applyLocationDelta(balances, entry.saleItem.productId, sale.warehouse.id, entry.quantity);
      const nextStock = Number(productStocks.get(entry.saleItem.productId) ?? entry.saleItem.product.stockOnHand) + entry.quantity;
      productStocks.set(entry.saleItem.productId, nextStock);
      await tx.product.update({
        where: { id: entry.saleItem.productId },
        data: { stockOnHand: nextStock }
      });
      await tx.stockMovement.create({
        data: {
          productId: entry.saleItem.productId,
          warehouseId: sale.warehouse.id,
          type: "IN",
          quantity: entry.quantity,
          beforeStock: beforeLocationStock,
          afterStock: beforeLocationStock + entry.quantity,
          referenceType: "customer_credit_note",
          referenceId: number,
          notes: `Bon d'avoir caisse ${number}`
        }
      });
    }

    await saveStockBalances(tx, balances);

    const credit: PosCreditDocument = {
      id: `credit-${Date.now()}-${Math.round(Math.random() * 100000)}`,
      number,
      createdAt: new Date().toISOString(),
      sourceType: "TICKET",
      sourceId: sale.id,
      sourceNumber: sale.number,
      customerName: payload.customerName.trim(),
      customerPhone: payload.customerPhone.trim(),
      warehouseId: sale.warehouse.id,
      warehouseName: sale.warehouse.name,
      origin: "POS",
      createdByName: req.currentUser?.fullName ?? "",
      voucherNumber,
      voucherInitialAmount: creditAmount,
      voucherBalanceAmount: creditAmount,
      reason: payload.reason?.trim() || "Bon d'avoir client",
      amount: creditAmount,
      items: selectedItems.map((entry) => ({
        id: `${entry.saleItem.id}-${Date.now()}`,
        productId: entry.saleItem.productId,
        sourceSaleItemId: entry.saleItem.id,
        productName: entry.saleItem.product.name,
        reference: entry.saleItem.product.reference ?? "",
        quantity: entry.quantity,
        unitPriceTtc: Number(entry.saleItem.unitPriceTtc),
        lineTotal: Number((Number(entry.saleItem.unitPriceTtc) * entry.quantity).toFixed(2))
      }))
    };

    const updatedStore: PosCreditStore = {
      ...store,
      credits: [credit, ...store.credits]
    };
    await savePosCreditStore(tx, updatedStore);

    await tx.$executeRaw`
      INSERT INTO "GiftVoucher" (
        "id", "number", "initialAmount", "balanceAmount", "customerId", "customerName", "customerPhone",
        "warehouseId", "origin", "sourceDocumentId", "sourceDocumentNumber", "createdByUserId", "note",
        "isActive", "createdAt", "updatedAt"
      ) VALUES (
        ${`gift-${credit.id}`},
        ${voucherNumber},
        ${creditAmount},
        ${creditAmount},
        ${sale.customer?.id ?? null},
        ${payload.customerName.trim()},
        ${payload.customerPhone.trim()},
        ${sale.warehouse.id},
        ${"POS"},
        ${credit.id},
        ${credit.number},
        ${req.currentUser?.id ?? null},
        ${credit.reason},
        ${true},
        NOW(),
        NOW()
      )
    `;

    return {
      credit,
      voucher: {
        id: `gift-${credit.id}`,
        number: voucherNumber,
        initialAmount: creditAmount,
        balanceAmount: creditAmount,
        customerName: payload.customerName.trim(),
        customerPhone: payload.customerPhone.trim(),
        warehouseId: sale.warehouse.id,
        warehouseName: sale.warehouse.name,
        origin: "POS"
      }
    };
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "pos.credit.create",
    entityType: "gift_voucher",
    entityId: result.voucher.id,
    meta: {
      ticketId: payload.sourceTicketId,
      ticketNumber: result.credit.sourceNumber,
      creditNumber: result.credit.number,
      voucherNumber: result.voucher.number
    }
  });

  return ok(res, result, "Bon d'avoir client cree.");
}));

posRouter.get("/customer-credits", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = customerCreditQuerySchema.parse(req.query ?? {});
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const warehouseId = query.warehouseId || scopedWarehouseId || null;
  if (warehouseId) ensureWarehouseAccess(req.currentUser, warehouseId);

  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(query.dateFrom ?? "")) ? String(query.dateFrom) : "";
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo ?? "")) ? String(query.dateTo) : "";
  const dateFilter = dateFrom || dateTo
    ? {
        createdAt: {
          ...(dateFrom ? { gte: buildDateStart(dateFrom) } : {}),
          ...(dateTo ? { lte: buildDateEnd(dateTo) } : {})
        }
      }
    : {};

  const [sales, repaymentStore] = await Promise.all([
    prisma.sale.findMany({
      where: {
        ...(warehouseId ? { warehouseId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...dateFilter,
        payments: { some: { method: "CREDIT", direction: "IN" } }
      },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, fullName: true, phone: true, email: true } },
        warehouse: { select: { id: true, name: true } },
        payments: true
      }
    }),
    loadCustomerCreditRepayments(prisma)
  ]);

  const search = String(query.query ?? "").trim().toLowerCase();
  const rows = sales.map((sale) => {
    const creditAmount = sale.payments
      .filter((payment) => payment.direction === "IN" && payment.method === "CREDIT")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const repayments = repaymentStore
      .filter((entry) => !entry.deletedAt && entry.saleId === sale.id)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const repaidAmount = repayments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const balanceAmount = Number(Math.max(0, creditAmount - repaidAmount).toFixed(2));
    const status = balanceAmount <= 0.009 ? "paid" : repaidAmount > 0 ? "partial" : "open";
    return {
      id: sale.id,
      saleId: sale.id,
      saleNumber: sale.number,
      createdAt: sale.createdAt,
      customer: sale.customer
        ? { id: sale.customer.id, fullName: sale.customer.fullName, phone: sale.customer.phone, email: sale.customer.email }
        : { id: null, fullName: "Client non renseigne", phone: null, email: null },
      warehouse: { id: sale.warehouse.id, name: sale.warehouse.name },
      sellerName: sale.sellerName ?? "Non renseigne",
      creditAmount: Number(creditAmount.toFixed(2)),
      repaidAmount: Number(repaidAmount.toFixed(2)),
      balanceAmount,
      status,
      repayments
    };
  }).filter((row) => {
    if (query.status !== "all" && row.status !== query.status) return false;
    if (!search) return true;
    return [
      row.saleNumber,
      row.customer.fullName,
      row.customer.phone ?? "",
      row.customer.email ?? "",
      row.warehouse.name,
      row.sellerName
    ].some((value) => String(value).toLowerCase().includes(search));
  });

  const summary = rows.reduce((acc, row) => {
    acc.creditAmount += row.creditAmount;
    acc.repaidAmount += row.repaidAmount;
    acc.balanceAmount += row.balanceAmount;
    if (row.status === "open") acc.openCount += 1;
    if (row.status === "partial") acc.partialCount += 1;
    if (row.status === "paid") acc.paidCount += 1;
    return acc;
  }, { creditAmount: 0, repaidAmount: 0, balanceAmount: 0, openCount: 0, partialCount: 0, paidCount: 0 });

  return ok(res, {
    rows,
    summary: {
      ...summary,
      creditAmount: Number(summary.creditAmount.toFixed(2)),
      repaidAmount: Number(summary.repaidAmount.toFixed(2)),
      balanceAmount: Number(summary.balanceAmount.toFixed(2))
    }
  });
}));

posRouter.post("/customer-credits/:saleId/repayments", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = customerCreditRepaymentSchema.parse(req.body);
  const method = normalizeCustomerCreditRepaymentMethod(payload.method);
  const saleId = String(req.params.saleId ?? "");
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: { select: { id: true, fullName: true } },
      warehouse: { select: { id: true, name: true } },
      payments: true
    }
  });
  if (!sale) throw new AppError("Credit client introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouseId);
  const creditAmount = sale.payments
    .filter((payment) => payment.direction === "IN" && payment.method === "CREDIT")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (creditAmount <= 0) throw new AppError("Ce ticket n'est pas un credit client.", 422);

  const repayment = await prisma.$transaction(async (tx) => {
    const entries = await loadCustomerCreditRepayments(tx);
    const alreadyRepaid = sumActiveRepayments(entries, sale.id);
    const balance = Number(Math.max(0, creditAmount - alreadyRepaid).toFixed(2));
    if (payload.amount > balance + 0.009) {
      throw new AppError(`Montant superieur au solde restant (${balance.toFixed(2)} MAD).`, 422);
    }
    const entry: CustomerCreditRepaymentEntry = {
      id: `CCR-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      saleId: sale.id,
      saleNumber: sale.number,
      customerId: sale.customerId ?? null,
      customerName: sale.customer?.fullName ?? "Client non renseigne",
      warehouseId: sale.warehouse.id,
      warehouseName: sale.warehouse.name,
      amount: Number(payload.amount.toFixed(2)),
      method,
      reference: payload.reference?.trim() || null,
      note: payload.note?.trim() || null,
      createdAt: new Date().toISOString(),
      createdById: req.currentUser?.id ?? null,
      createdByName: req.currentUser?.fullName ?? null
    };
    await saveCustomerCreditRepayments(tx, [entry, ...entries]);
    return entry;
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "pos.customer_credit.repayment.create",
    entityType: "sale",
    entityId: sale.id,
    meta: repayment
  });
  return ok(res.status(201), repayment);
}));

posRouter.put("/customer-credits/repayments/:repaymentId", requirePermissions("sales_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = customerCreditRepaymentSchema.parse(req.body);
  const method = normalizeCustomerCreditRepaymentMethod(payload.method);
  const repaymentId = String(req.params.repaymentId ?? "");
  const updated = await prisma.$transaction(async (tx) => {
    const entries = await loadCustomerCreditRepayments(tx);
    const index = entries.findIndex((entry) => entry.id === repaymentId && !entry.deletedAt);
    if (index < 0) throw new AppError("Remboursement introuvable.", 404);
    const current = entries[index];
    ensureWarehouseAccess(req.currentUser, current.warehouseId);
    const sale = await tx.sale.findUnique({ where: { id: current.saleId }, include: { payments: true } });
    if (!sale) throw new AppError("Ticket credit introuvable.", 404);
    const creditAmount = sale.payments
      .filter((payment) => payment.direction === "IN" && payment.method === "CREDIT")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const alreadyRepaid = sumActiveRepayments(entries, current.saleId, current.id);
    if (payload.amount > Number((creditAmount - alreadyRepaid).toFixed(2)) + 0.009) {
      throw new AppError("Montant superieur au solde restant du credit.", 422);
    }
    const nextEntry: CustomerCreditRepaymentEntry = {
      ...current,
      amount: Number(payload.amount.toFixed(2)),
      method,
      reference: payload.reference?.trim() || null,
      note: payload.note?.trim() || null,
      updatedAt: new Date().toISOString(),
      updatedById: req.currentUser?.id ?? null
    };
    entries[index] = nextEntry;
    await saveCustomerCreditRepayments(tx, entries);
    return { before: current, after: nextEntry };
  });
  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "pos.customer_credit.repayment.update",
    entityType: "customer_credit_repayment",
    entityId: repaymentId,
    meta: updated
  });
  return ok(res, updated.after);
}));

posRouter.delete("/customer-credits/repayments/:repaymentId", requirePermissions("sales_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const repaymentId = String(req.params.repaymentId ?? "");
  const deleted = await prisma.$transaction(async (tx) => {
    const entries = await loadCustomerCreditRepayments(tx);
    const index = entries.findIndex((entry) => entry.id === repaymentId && !entry.deletedAt);
    if (index < 0) throw new AppError("Remboursement introuvable.", 404);
    const current = entries[index];
    ensureWarehouseAccess(req.currentUser, current.warehouseId);
    const nextEntry: CustomerCreditRepaymentEntry = {
      ...current,
      deletedAt: new Date().toISOString(),
      deletedById: req.currentUser?.id ?? null
    };
    entries[index] = nextEntry;
    await saveCustomerCreditRepayments(tx, entries);
    return { before: current, after: nextEntry };
  });
  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "pos.customer_credit.repayment.delete",
    entityType: "customer_credit_repayment",
    entityId: repaymentId,
    meta: deleted
  });
  return ok(res, { id: repaymentId });
}));

posRouter.get("/vouchers/:number", requirePermissions("pos_use"), asyncHandler(async (req, res) => {
  const number = normalizeVoucherNumber(String(req.params.number ?? ""));
  if (!number) throw new AppError("Numero de bon achat obligatoire.", 422);
  const warehouseId = String(req.query.warehouseId ?? "").trim() || null;
  const vouchers = await prisma.$queryRaw<Array<{
    id: string;
    number: string;
    initialAmount: number | string;
    balanceAmount: number | string;
    customerName: string | null;
    customerPhone: string | null;
    warehouseId: string | null;
    origin: string | null;
    sourceDocumentNumber: string | null;
    isActive: boolean;
    expiresAt: Date | null;
  }>>`SELECT "id", "number", "initialAmount", "balanceAmount", "customerName", "customerPhone", "warehouseId", "origin", "sourceDocumentNumber", "isActive", "expiresAt" FROM "GiftVoucher" WHERE "number" = ${number} LIMIT 1`;
  const voucher = vouchers[0];
  if (!voucher) throw new AppError("Bon achat introuvable.", 404);
  if (!voucher.isActive) throw new AppError("Bon achat inactif.", 422);
  if (voucher.expiresAt && voucher.expiresAt < new Date()) throw new AppError("Bon achat expire.", 422);
  const warehouse = voucher.warehouseId ? await prisma.warehouse.findUnique({ where: { id: voucher.warehouseId }, select: { id: true, name: true } }) : null;
  return ok(res, {
    id: voucher.id,
    number: voucher.number,
    initialAmount: Number(voucher.initialAmount),
    balanceAmount: Number(voucher.balanceAmount),
    customerName: voucher.customerName ?? "",
    customerPhone: voucher.customerPhone ?? "",
    warehouseId: voucher.warehouseId ?? null,
    warehouseName: warehouse?.name ?? "",
    origin: voucher.origin ?? "ADMIN",
    sourceDocumentNumber: voucher.sourceDocumentNumber ?? null,
    usableInCurrentWarehouse: !warehouseId || !voucher.warehouseId || voucher.warehouseId === warehouseId,
    isActive: voucher.isActive,
    expiresAt: voucher.expiresAt
  });
}));

posRouter.get("/orders/delivery/:number", requirePermissions("pos_use"), asyncHandler(async (req, res) => {
  const orderNumber = String(req.params.number ?? "").trim();
  if (!orderNumber) throw new AppError("Numero de commande obligatoire.", 422);
  const deliveryData = await buildDeliveryOrderData(orderNumber);
  if (!deliveryData.legacyOrder) {
    throw new AppError("Commande non validee. Complete d'abord la fiche commande.", 404);
  }
  return ok(res, deliveryData.payload);
}));

posRouter.post("/orders/delivery/:number/mark-delivered", requirePermissions("pos_use"), asyncHandler(async (req, res) => {
  const orderNumber = String(req.params.number ?? "").trim();
  if (!orderNumber) throw new AppError("Numero de commande obligatoire.", 422);
  const deliveryData = await buildDeliveryOrderData(orderNumber);
  if (!deliveryData.legacyOrder) {
    throw new AppError("Commande non validee. Complete d'abord la fiche commande.", 404);
  }
  await markLegacyOrderAsPaid(orderNumber, "");
  return ok(res, true, "Commande marquee comme livree.");
}));

posRouter.post("/sessions/open", requirePermissions("cash_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = sessionSchema.parse(req.body);
  const register = await prisma.cashRegister.findUnique({ where: { id: payload.registerId }, select: { warehouseId: true } });
  if (!register) throw new AppError("Caisse introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, register.warehouseId);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const existingOpenSessions = await prisma.cashSession.findMany({
    where: {
      registerId: payload.registerId,
      status: "OPEN"
    },
    include: {
      openedBy: { select: { fullName: true } },
      register: { select: { name: true } }
    },
    orderBy: { openedAt: "desc" }
  });
  if (existingOpenSessions.length) {
    await prisma.$transaction(existingOpenSessions.map((session) => prisma.cashSession.update({
      where: { id: session.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closingAmount: Number(session.openingAmount),
        expectedAmount: Number(session.openingAmount),
        varianceAmount: 0
      }
    })));
    await Promise.all(existingOpenSessions.map((session) => writeAuditLog({
      userId: req.currentUser?.id,
      action: session.openedAt >= todayStart ? "cash.close.auto-replaced" : "cash.close.auto-stale",
      entityType: "cash_session",
      entityId: session.id,
      meta: {
        reason: session.openedAt >= todayStart
          ? "Remplacement automatique d'une session deja ouverte sur cette caisse."
          : "Ouverture automatique d'une nouvelle session apres une session precedente non fermee.",
        openedBy: session.openedBy?.fullName ?? null,
        openedAt: session.openedAt,
        registerId: session.registerId
      }
    })));
  }
  const currencies = await prisma.currency.findMany({ where: { isActive: true }, select: { code: true, rateFromMad: true } });
  const currencyRates = new Map(currencies.map((currency) => [currency.code.toUpperCase(), Number(currency.rateFromMad)]));
  const openingBreakdown = payload.openingBreakdown
    .map((entry) => {
      const currencyCode = entry.currencyCode.trim().toUpperCase();
      const rateFromMad = resolveRateFromMad(currencyCode, entry.rateFromMad, currencyRates.get(currencyCode));
      const amount = Number(entry.amount || 0);
      const amountMad = currencyCode === "MAD" ? amount : Number((amount / rateFromMad).toFixed(2));
      return { currencyCode, amount, amountMad, rateFromMad };
    })
    .filter((entry) => entry.amount > 0);
  const openingAmount = Number((openingBreakdown.reduce((total, entry) => total + entry.amountMad, 0) || payload.openingAmount).toFixed(2));
  if (openingAmount <= 0) throw new AppError("Le fond d'ouverture doit etre superieur a 0.", 422);
  const normalizedPayload = { ...payload, openingAmount, openingBreakdown };
  const session = await prisma.cashSession.create({ data: { registerId: payload.registerId, openingAmount, openedById: req.currentUser!.id, status: "OPEN" } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "cash.open", entityType: "cash_session", entityId: session.id, meta: normalizedPayload });
  return ok(res, session, "Session de caisse ouverte.");
}));

posRouter.get("/sessions/current", requirePermissions("cash_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const warehouseId = String(req.query.warehouseId ?? "").trim() || null;
  if (warehouseId) ensureWarehouseAccess(req.currentUser, warehouseId);
  const session = await prisma.cashSession.findFirst({
    where: {
      openedById: req.currentUser!.id,
      status: "OPEN",
      ...(warehouseId ? { register: { warehouseId } } : {})
    },
    include: {
      register: {
        select: {
          id: true,
          name: true,
          warehouseId: true,
          warehouse: { select: { name: true } }
        }
      }
    },
    orderBy: { openedAt: "desc" }
  });
  if (!session) {
    return ok(res, null);
  }
  const openingLog = await prisma.auditLog.findFirst({
    where: {
      action: "cash.open",
      entityType: "cash_session",
      entityId: session.id
    },
    orderBy: { createdAt: "desc" }
  });
  const openingMetadata = openingLog?.metadata && typeof openingLog.metadata === "object"
    ? openingLog.metadata as {
        openingBreakdown?: Array<{
          currencyCode?: string;
          amount?: number;
          amountMad?: number;
          rateFromMad?: number;
        }>;
      }
    : null;
  return ok(res, {
    id: session.id,
    openingAmount: Number(session.openingAmount),
    status: session.status,
    openedAt: session.openedAt,
    openingBreakdown: (openingMetadata?.openingBreakdown ?? [])
      .filter((entry) => Number(entry.amount ?? 0) > 0)
      .map((entry) => ({
        currencyCode: String(entry.currencyCode ?? "").toUpperCase(),
        amount: Number(entry.amount ?? 0),
        amountMad: Number(entry.amountMad ?? 0),
        rateFromMad: Number(entry.rateFromMad ?? 0)
      })),
    register: {
      id: session.register.id,
      name: session.register.name,
      warehouseId: session.register.warehouseId,
      warehouseName: session.register.warehouse.name
    }
  });
}));

posRouter.post("/sessions/:id/close", requirePermissions("cash_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const closingAmount = Number(req.body.closingAmount ?? 0);
  const closingBreakdown = Array.isArray(req.body?.closingBreakdown) ? req.body.closingBreakdown : [];
  const sessionId = String(req.params.id);
  const session = await prisma.cashSession.findUniqueOrThrow({ where: { id: sessionId }, include: { register: { select: { warehouseId: true } } } });
  ensureWarehouseAccess(req.currentUser, session.register.warehouseId);
  const updated = await prisma.cashSession.update({ where: { id: session.id }, data: { closingAmount, expectedAmount: closingAmount, varianceAmount: closingAmount - Number(session.openingAmount), status: "CLOSED", closedAt: new Date() } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "cash.close", entityType: "cash_session", entityId: updated.id, meta: { closingAmount, closingBreakdown } });
  return ok(res, updated, "Session de caisse cloturee.");
}));

posRouter.post("/checkout", requirePermissions("pos_use"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = checkoutSchema.parse(req.body);
  ensureWarehouseAccess(req.currentUser, payload.warehouseId);
  const register = await prisma.cashRegister.findUnique({
    where: { id: payload.registerId },
    select: { id: true, warehouseId: true, isActive: true }
  });
  if (!register || !register.isActive) throw new AppError("Caisse introuvable.", 404);
  if (register.warehouseId !== payload.warehouseId) {
    throw new AppError("La caisse selectionnee n'appartient pas a cette boutique.", 422);
  }
  const sale = await prisma.$transaction(async (tx) => {
    const number = await generatePosTicketNumber(tx, payload.warehouseId);
    let subtotal = 0;
    let taxAmount = 0;
    const orderNotes = [] as string[];
    let balances = await readStockBalances(tx);
    let variantBalances = await readVariantStockBalances(tx);
    const computedItems = [] as Array<{
      productId: string;
      variantId?: string | null;
      quantity: number;
      unitPriceHt: number;
      unitPriceTtc: number;
      discountAmount: number;
      taxRate: number;
      lineTotal: number;
      stockBefore: number;
      stockAfter: number;
      locationStockBefore: number;
      locationStockAfter: number;
      stockTracked: boolean;
      variantLabel?: string | null;
    }>;

    for (const item of payload.items) {
      if (item.kind === "ORDER_DEPOSIT") {
        const depositAmount = Number(item.depositAmount ?? item.unitPriceTtc ?? 0);
        if (depositAmount <= 0) throw new AppError("Montant acompte commande invalide.", 422);
        const product = await tx.product.upsert({
          where: { reference: "POS-ORDER-DEPOSIT" },
          update: { status: "INACTIVE" },
          create: {
            reference: "POS-ORDER-DEPOSIT",
            name: "Acompte commande",
            purchasePriceHt: 0,
            purchasePriceTtc: 0,
            salePriceHt: 0,
            salePriceTtc: 0,
            taxRate: 0,
            stockOnHand: 0,
            minStock: 0,
            status: "INACTIVE"
          }
        });
        const lineTotal = Math.max(0, depositAmount - item.discountAmount);
        subtotal += lineTotal;
        computedItems.push({ productId: product.id, quantity: 1, unitPriceHt: depositAmount, unitPriceTtc: depositAmount, discountAmount: item.discountAmount, taxRate: 0, lineTotal, stockBefore: Number(product.stockOnHand), stockAfter: Number(product.stockOnHand), locationStockBefore: 0, locationStockAfter: 0, stockTracked: false });
        orderNotes.push(`Acompte commande ${item.orderNumber ?? ""} (${item.orderType ?? "Commande"}) - Total ${Number(item.orderTotal ?? 0)} MAD - Acompte ${depositAmount} MAD`);
        continue;
      }

      if (item.variantId) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId }, include: { product: true } });
        if (!variant || variant.productId !== item.productId) throw new AppError("Variante introuvable.", 404);
        balances = await ensureProductStockSeeded(tx, balances, variant.product, payload.warehouseId);
        variantBalances = await ensureVariantStockSeeded(tx, variantBalances, variant, payload.warehouseId);
        const locationStock = getVariantLocationStock(variantBalances, variant.id, payload.warehouseId);
        const hasPromoPrice = Boolean(variant.product.promoPriceActive && variant.product.promoPriceTtc && Number(variant.product.promoPriceTtc) > 0);
        const unitPriceTtc = hasPromoPrice ? Number(variant.product.promoPriceTtc) : Number(variant.product.salePriceTtc);
        const unitPriceHt = hasPromoPrice && variant.product.promoPriceHt ? Number(variant.product.promoPriceHt) : Number((unitPriceTtc / (1 + Number(variant.product.taxRate) / 100)).toFixed(2));
        const lineDiscount = hasPromoPrice ? 0 : item.discountAmount;
        const lineTotal = unitPriceTtc * item.quantity - lineDiscount;
        subtotal += unitPriceHt * item.quantity;
        taxAmount += (unitPriceTtc - unitPriceHt) * item.quantity;
        computedItems.push({
          productId: variant.productId,
          variantId: variant.id,
          quantity: item.quantity,
          unitPriceHt,
          unitPriceTtc,
          discountAmount: lineDiscount,
          taxRate: Number(variant.product.taxRate),
          lineTotal,
          stockBefore: variant.stockOnHand,
          stockAfter: variant.stockOnHand - item.quantity,
          locationStockBefore: locationStock,
          locationStockAfter: locationStock - item.quantity,
          stockTracked: true,
          variantLabel: [variant.color, variant.size].filter(Boolean).join(" / ") || variant.label
        });
        continue;
      }

      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
      balances = await ensureProductStockSeeded(tx, balances, product, payload.warehouseId);
      const locationStock = getLocationStock(balances, product.id, payload.warehouseId);
      const hasPromoPrice = Boolean(product.promoPriceActive && product.promoPriceTtc && Number(product.promoPriceTtc) > 0);
      const unitPriceTtc = hasPromoPrice ? Number(product.promoPriceTtc) : Number(product.salePriceTtc);
      const unitPriceHt = hasPromoPrice && product.promoPriceHt ? Number(product.promoPriceHt) : Number((unitPriceTtc / (1 + Number(product.taxRate) / 100)).toFixed(2));
      const lineDiscount = hasPromoPrice ? 0 : item.discountAmount;
      const lineTotal = unitPriceTtc * item.quantity - lineDiscount;
      subtotal += unitPriceHt * item.quantity;
      taxAmount += (unitPriceTtc - unitPriceHt) * item.quantity;
      computedItems.push({ productId: product.id, quantity: item.quantity, unitPriceHt, unitPriceTtc, discountAmount: lineDiscount, taxRate: Number(product.taxRate), lineTotal, stockBefore: product.stockOnHand, stockAfter: product.stockOnHand - item.quantity, locationStockBefore: locationStock, locationStockAfter: locationStock - item.quantity, stockTracked: true });
    }

    const shippingFee = Number(payload.shippingFee ?? 0);
    for (const payment of payload.payments) {
      if (String(payment.method).trim().toUpperCase() !== "VOUCHER") continue;
      const reference = normalizeVoucherNumber(String(payment.reference ?? ""));
      if (!reference) throw new AppError("Numero de bon achat obligatoire.", 422);
      const vouchers = await tx.$queryRaw<Array<{
        id: string;
        balanceAmount: number | string;
        isActive: boolean;
        expiresAt: Date | null;
        warehouseId: string | null;
      }>>`SELECT "id", "balanceAmount", "isActive", "expiresAt", "warehouseId" FROM "GiftVoucher" WHERE "number" = ${reference} LIMIT 1`;
      const voucher = vouchers[0];
      if (!voucher) throw new AppError("Bon achat introuvable.", 404);
      if (!voucher.isActive) throw new AppError("Bon achat inactif.", 422);
      if (voucher.expiresAt && voucher.expiresAt < new Date()) throw new AppError("Bon achat expire.", 422);
      if (voucher.warehouseId && voucher.warehouseId !== payload.warehouseId) {
        throw new AppError("Ce bon d'avoir appartient a une autre boutique et ne peut pas etre utilise ici.", 422);
      }
      if (Number(voucher.balanceAmount) < payment.amount) throw new AppError("Solde insuffisant sur le bon achat.", 422);
      const nextBalance = Number((Number(voucher.balanceAmount) - payment.amount).toFixed(2));
      await tx.$executeRaw`UPDATE "GiftVoucher" SET "balanceAmount" = ${nextBalance}, "isActive" = ${nextBalance > 0}, "updatedAt" = NOW() WHERE "id" = ${voucher.id}`;
    }
    const totalAmount = computedItems.reduce((sum, item) => sum + item.lineTotal, 0) + shippingFee;
    const paidAmount = payload.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const status = paidAmount >= totalAmount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";
    const creditPaymentAmount = payload.payments
      .filter((payment) => String(payment.method).trim().toUpperCase() === "CREDIT")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    if (creditPaymentAmount > 0) {
      if (!payload.customerId) throw new AppError("Client obligatoire pour un paiement credit.", 422);
      const customer = await tx.customer.findUnique({
        where: { id: payload.customerId },
        select: { id: true, fullName: true }
      });
      if (!customer) throw new AppError("Client introuvable pour le credit.", 404);
      const creditLimits = await loadCustomerCreditLimits(tx);
      const configuredCreditLimit = creditLimits[customer.id] ?? null;
      if (configuredCreditLimit != null) {
        const currentCreditBalance = await getCustomerCreditBalance(tx, customer.id);
        const nextCreditBalance = Number((currentCreditBalance + creditPaymentAmount).toFixed(2));
        const creditLimit = Number(configuredCreditLimit);
        if (nextCreditBalance > creditLimit + 0.009) {
          throw new AppError(`Plafond credit depasse pour ${customer.fullName}. Plafond: ${creditLimit.toFixed(2)} MAD, solde apres ticket: ${nextCreditBalance.toFixed(2)} MAD.`, 422);
        }
      }
    }
    const saleNote = [payload.note, ...orderNotes].filter(Boolean).join("\n") || null;
    const createdSale = await tx.sale.create({ data: { number, customerId: payload.customerId, warehouseId: payload.warehouseId, createdById: req.currentUser!.id, transporterId: payload.transporterId || null, sellerName: payload.sellerName, status, subtotal, discountAmount: computedItems.reduce((sum, item) => sum + item.discountAmount, 0), taxAmount, shippingFee, totalAmount, paidAmount, note: saleNote, items: { create: computedItems.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPriceHt: item.unitPriceHt, unitPriceTtc: item.unitPriceTtc, discountAmount: item.discountAmount, taxRate: item.taxRate, lineTotal: item.lineTotal })) }, payments: { create: payload.payments.map((payment) => ({ amount: payment.amount, method: payment.method as PaymentMethod, direction: "IN", reference: payment.reference ? String(payment.reference).trim() : null })) } }, include: { items: true, payments: true, transporter: true } });

    for (const item of computedItems.filter((computedItem) => computedItem.stockTracked)) {
      balances = applyLocationDelta(balances, item.productId, payload.warehouseId, -item.quantity);
      if (item.variantId) {
        variantBalances = applyVariantLocationDelta(variantBalances, item.variantId, payload.warehouseId, -item.quantity);
        await saveVariantStockBalances(tx, variantBalances);
        await syncVariantGlobalStock(tx, variantBalances, item.variantId);
        await tx.productVariant.update({ where: { id: item.variantId }, data: { stockOnHand: item.stockAfter } });
        const remainingStock = await tx.productVariant.aggregate({ where: { productId: item.productId }, _sum: { stockOnHand: true } });
        await tx.product.update({ where: { id: item.productId }, data: { stockOnHand: remainingStock._sum.stockOnHand ?? 0 } });
        await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: payload.warehouseId, type: "OUT", quantity: item.quantity, beforeStock: item.locationStockBefore, afterStock: item.locationStockAfter, referenceType: "sale", referenceId: createdSale.id, notes: item.variantLabel ? `Vente caisse - Variante ${item.variantLabel}` : "Vente caisse - Variante" } });
        continue;
      }

      await tx.product.update({ where: { id: item.productId }, data: { stockOnHand: item.stockAfter } });
      await tx.stockMovement.create({ data: { productId: item.productId, warehouseId: payload.warehouseId, type: "OUT", quantity: item.quantity, beforeStock: item.locationStockBefore, afterStock: item.locationStockAfter, referenceType: "sale", referenceId: createdSale.id, notes: "Vente caisse" } });
    }
    await saveStockBalances(tx, balances);
    await saveVariantStockBalances(tx, variantBalances);
    return createdSale;
  }, { maxWait: 10_000, timeout: 30_000 });

  const legacyOrdersToFinalize = Array.from(new Set(
    payload.items
      .filter((item) => item.kind === "ORDER_DEPOSIT" && item.orderSource === "LEGACY" && item.orderNumber)
      .map((item) => String(item.orderNumber).trim())
      .filter(Boolean)
  ));

  for (const legacyOrderNumber of legacyOrdersToFinalize) {
    const deliveryData = await buildDeliveryOrderData(legacyOrderNumber);
    if (deliveryData.legacyOrder && deliveryData.payload.remainingAmount <= 0) {
      await markLegacyOrderAsPaid(legacyOrderNumber, sale.number);
    }
  }

  await writeAuditLog({ userId: req.currentUser?.id, action: "pos.checkout", entityType: "sale", entityId: sale.id, meta: payload });
  return ok(res, sale, "Ticket genere.");
}));







