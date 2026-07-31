import { Router } from "express";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { authenticate, type AuthenticatedRequest, ensureWarehouseAccess, getScopedWarehouseId, getScopedWarehouseIdForRequest, isCommandValidationScope, requirePermissions } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";
import { applyLocationDelta, ensureProductStockSeeded, getLocationStock, readStockBalances, saveStockBalances } from "../../common/stock-balances.js";

export const salesRouter = Router();
salesRouter.use(authenticate, requirePermissions("sales_manage"));

const SALES_DOCUMENTS_KEY = "sales_documents_store";
const BOUTIQUES_CONFIG_KEY = "boutiques_config";
const COMPANY_SETTING_KEYS = [
  "company_name",
  "company_currency",
  "default_tax_rate",
  "ticket_footer",
  "company_logo_url",
  "company_address",
  "company_email",
  "company_website",
  "company_patente",
  "company_ice",
  "company_rc",
  "company_cnss"
] as const;
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const legacyOrdersBridgeScript = resolve(__dirname, "../../../../../../legacy_orders_bridge.php");
const phpBinary = existsSync("C:\\xampp\\php\\php.exe") ? "C:\\xampp\\php\\php.exe" : "php";

const salesLineSchema = z.object({
  id: z.string(),
  productId: z.string().optional().nullable(),
  productName: z.string(),
  reference: z.string().optional().default(""),
  quantity: z.string(),
  unitPriceTtc: z.string()
});

const quoteSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.enum(["DRAFT", "VALIDATED", "TRANSFORMED", "CANCELLED"]),
  createdAt: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  note: z.string().default(""),
  totalAmount: z.number(),
  lines: z.array(salesLineSchema)
});

const deliverySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.enum(["DRAFT", "INVOICED", "CANCELLED"]),
  createdAt: z.string(),
  validatedAt: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  sourceQuoteId: z.string().nullable().optional(),
  sourceQuoteNumber: z.string().nullable().optional(),
  customerId: z.string(),
  customerName: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  note: z.string().default(""),
  totalAmount: z.number(),
  lines: z.array(salesLineSchema)
});

const invoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  createdAt: z.string(),
  sourceDeliveryId: z.string(),
  sourceDeliveryNumber: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  amount: z.number(),
  lines: z.array(salesLineSchema)
});

const creditItemSchema = z.object({
  id: z.string(),
  productId: z.string().optional().nullable(),
  sourceSaleItemId: z.string().optional().nullable(),
  productName: z.string(),
  reference: z.string().default(""),
  quantity: z.number(),
  unitPriceTtc: z.number(),
  lineTotal: z.number()
});

const creditSchema = z.object({
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
  items: z.array(creditItemSchema)
});

const documentsStoreSchema = z.object({
  quotes: z.array(quoteSchema),
  deliveries: z.array(deliverySchema),
  invoices: z.array(invoiceSchema),
  credits: z.array(creditSchema)
});

const idsPayloadSchema = z.object({
  ids: z.array(z.string()).min(1)
});

const createCreditPayloadSchema = creditSchema.omit({
  id: true,
  createdAt: true
});
const commandTabQuerySchema = z.object({
  search: z.string().optional().default(""),
  atelier: z.string().optional().default(""),
  statusKey: z.string().optional().default(""),
  paidState: z.enum(["paid", "unpaid", "all"]).optional().default("all"),
  dateFrom: z.string().optional().default(""),
  dateTo: z.string().optional().default("")
});
const commandStatusUpdateSchema = z.object({
  status: z.enum(["en_cours", "retardee", "annulee", "en_stock", "livree", "en_fabrication"])
});
const commandValidationItemSchema = z.object({
  reference: z.string().optional().default(""),
  model: z.string().min(1),
  material: z.string().optional().default(""),
  color: z.string().optional().default(""),
  size: z.string().optional().default(""),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  details: z.string().optional().default("")
});
const commandValidationSchema = z.object({
  sourceSaleId: z.string().optional().nullable(),
  sourceTicketNumber: z.string().optional().default(""),
  orderNumber: z.string().regex(/^\d{6}$/),
  orderType: z.string().min(1),
  deliveryDate: z.string().min(1),
  workshopId: z.coerce.number().int().positive(),
  storeId: z.coerce.number().int().positive(),
  vendorId: z.coerce.number().int().positive(),
  clientId: z.coerce.number().int().positive(),
  paid: z.boolean(),
  note: z.string().optional().default(""),
  items: z.array(commandValidationItemSchema).min(1)
});
const commandCustomerCreateSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().default(""),
  address: z.string().optional().default("")
});

type SalesDocumentsStore = z.infer<typeof documentsStoreSchema>;
type QuoteDocument = z.infer<typeof quoteSchema>;
type DeliveryDocument = z.infer<typeof deliverySchema>;
type InvoiceDocument = z.infer<typeof invoiceSchema>;
type CreditDocument = z.infer<typeof creditSchema>;
type CreditVoucherRow = {
  id: string;
  number: string;
  initialAmount: number;
  balanceAmount: number;
  customerName: string;
  customerPhone: string;
  warehouseId: string | null;
  warehouseName: string;
  origin: string;
  sourceDocumentId: string | null;
  sourceDocumentNumber: string | null;
  createdByUserId: string | null;
  isActive: boolean;
  createdAt: string;
};
type LegacyBridgeOrder = {
  id: number;
  orderNumber: string;
  validationNumber?: string | null;
  clientName: string;
  vendorName: string;
  workshopName: string;
  storeName: string;
  commandType: string;
  totalAmount: number;
  paid: boolean;
  status: string;
  statusKey: string;
  deliveryDate?: string | null;
  createdAt: string;
  note?: string;
  itemsCount: number;
  statusHistory?: Array<{
    id: number;
    status: string;
    actorName: string;
    context: string;
    createdAt: string;
  }>;
  items?: Array<{
    id: number;
    reference: string;
    model: string;
    material: string;
    color: string;
    size: string;
    quantity: number;
    unitPrice: number;
    details: string;
  }>;
};
type LegacyBridgeOptions = {
  vendors: Array<{ id: number; name: string; store_id?: number | null }>;
  workshops: Array<{ id: number; name: string }>;
  clients: Array<{ id: number; name: string }>;
  stores: Array<{ id: number; name: string }>;
};
type SaleWithRelations = {
  id: string;
  number: string;
  note: string | null;
  status: string;
  warehouseId: string;
  sellerName: string | null;
  createdAt: Date;
  paidAmount: number | { toString(): string };
  customer: { fullName: string } | null;
  warehouse: { name: string };
  payments: Array<{ method: string; amount: number | { toString(): string }; reference?: string | null }>;
};
type AggregatedOrderSale = {
  orderNumber: string;
  orderType: string;
  warehouseId: string;
  warehouseName: string;
  sellerName: string | null;
  customerName: string | null;
  createdAt: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  saleIds: string[];
  ticketNumbers: string[];
  notes: string[];
  payments: Array<{ method: string; amount: number; reference?: string | null }>;
};

function emptyDocumentsStore(): SalesDocumentsStore {
  return {
    quotes: [],
    deliveries: [],
    invoices: [],
    credits: []
  };
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildDateStart(value: string) {
  return new Date(`${value}T00:00:00`);
}

function buildDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999`);
}

function parseLegacyBridgeJson<T>(stdout: string) {
  const payload = JSON.parse(stdout || "{}") as { ok?: boolean; message?: string; data?: T };
  if (!payload.ok) {
    throw new AppError(payload.message || "Bridge legacy indisponible.", 500);
  }
  return payload.data as T;
}

async function runLegacyOrdersBridge<T>(action: string, payload: Record<string, unknown> = {}) {
  if (!existsSync(legacyOrdersBridgeScript)) {
    throw new AppError("Bridge commandes legacy introuvable.", 500);
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const { stdout } = await execFileAsync(phpBinary, [legacyOrdersBridgeScript, action, encoded], {
    windowsHide: true,
    timeout: 15000
  });
  return parseLegacyBridgeJson<T>(stdout);
}

function parseMadAmount(value: string) {
  return Number(String(value).replace(/\s+/g, "").replace(",", "."));
}

function parseOrderDeposit(note?: string | null) {
  if (!note) return null;
  const match = note.match(/Acompte commande\s+(.+?)\s+\((.+?)\)\s+-\s+Total\s+([0-9.,]+)\s+MAD\s+-\s+Acompte\s+([0-9.,]+)\s+MAD/i);
  if (!match) return null;
  return {
    orderNumber: match[1].trim(),
    orderType: match[2].trim(),
    orderTotal: parseMadAmount(match[3]),
    depositAmount: parseMadAmount(match[4])
  };
}

function extractOrderSales(sales: SaleWithRelations[]) {
  const grouped = new Map<string, AggregatedOrderSale>();

  for (const sale of sales) {
    const parsed = parseOrderDeposit(sale.note);
    if (!parsed || sale.status === "CANCELLED") continue;

    const current: AggregatedOrderSale = grouped.get(parsed.orderNumber) ?? {
      orderNumber: parsed.orderNumber,
      orderType: parsed.orderType,
      warehouseId: sale.warehouseId,
      warehouseName: sale.warehouse.name,
      sellerName: sale.sellerName ?? null,
      customerName: sale.customer?.fullName ?? null,
      createdAt: sale.createdAt.toISOString(),
      totalAmount: parsed.orderTotal,
      paidAmount: 0,
      remainingAmount: parsed.orderTotal,
      saleIds: [],
      ticketNumbers: [],
      notes: [],
      payments: []
    };

    current.totalAmount = parsed.orderTotal;
    current.paidAmount += Number(sale.paidAmount);
    current.remainingAmount = Math.max(0, Number((parsed.orderTotal - current.paidAmount).toFixed(2)));
    current.saleIds.push(sale.id);
    current.ticketNumbers.push(sale.number);
    current.notes.push(sale.note || "");
    current.payments.push(...sale.payments.map((payment) => ({
      method: String(payment.method),
      amount: Number(payment.amount),
      reference: payment.reference
    })));

    if (new Date(sale.createdAt).getTime() < new Date(current.createdAt).getTime()) {
      current.createdAt = sale.createdAt.toISOString();
    }
    if (!current.customerName && sale.customer?.fullName) {
      current.customerName = sale.customer.fullName;
    }
    if (!current.sellerName && sale.sellerName) {
      current.sellerName = sale.sellerName;
    }

    grouped.set(parsed.orderNumber, current);
  }

  return Array.from(grouped.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function mapCommandTypeToAtelier(type: string) {
  const normalized = normalizeText(type);
  if (normalized.includes("sac")) return "sacs";
  if (normalized.includes("vetement")) return "vetements";
  if (normalized.includes("chaussure")) return "chaussures";
  if (normalized.includes("iraqi") || normalized.includes("iraki")) return "iraqi";
  if (normalized.includes("mobilier") || normalized.includes("bois")) return "mobiliers";
  return "autres";
}

function mapAtelierToLegacyType(atelier: string) {
  switch (atelier) {
    case "sacs":
      return "Sac";
    case "vetements":
      return "Vetement";
    case "chaussures":
      return "Chaussure";
    case "iraqi":
      return "Iraqi";
    case "mobiliers":
      return "Mobilier";
    default:
      return "";
  }
}

function mapStatusForLegacyUpdate(status: string) {
  switch (status) {
    case "en_fabrication":
    case "en_cours":
      return "En cours";
    case "retardee":
      return "Retardee";
    case "annulee":
      return "Annulee";
    case "en_stock":
      return "En stock";
    case "livree":
      return "Livree";
    default:
      return "En cours";
  }
}

function resolveAtelierGroup(statusKey: string) {
  if (statusKey === "retardee") return "retardees";
  if (statusKey === "annulee") return "annulees";
  if (statusKey === "en_stock") return "en_stock";
  if (statusKey === "livree" || statusKey === "termine" || statusKey === "terminee") return "livrees";
  return "en_cours";
}

function matchLegacyStoreId(legacyStores: LegacyBridgeOptions["stores"], warehouseName: string) {
  const target = normalizeText(warehouseName);
  return legacyStores.find((store) => normalizeText(store.name).includes(target) || target.includes(normalizeText(store.name)))?.id ?? null;
}

function matchLegacyVendorId(legacyVendors: LegacyBridgeOptions["vendors"], sellerName: string | null | undefined, storeId: number | null) {
  const target = normalizeText(sellerName);
  if (!target) return null;
  const candidates = legacyVendors.filter((vendor) => !storeId || Number(vendor.store_id || 0) === storeId);
  return candidates.find((vendor) => normalizeText(vendor.name) === target)?.id ?? candidates.find((vendor) => normalizeText(vendor.name).includes(target))?.id ?? null;
}

function matchLegacyClientId(legacyClients: LegacyBridgeOptions["clients"], customerName: string | null | undefined) {
  const target = normalizeText(customerName);
  if (!target) return 1;
  return legacyClients.find((client) => normalizeText(client.name) === target)?.id ?? 1;
}

function parseDocumentsStore(value: unknown): SalesDocumentsStore {
  const parsed = documentsStoreSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyDocumentsStore();
}

function buildCreditVoucherNumber(creditNumber: string) {
  return String(creditNumber || "").trim().toUpperCase();
}

async function loadDocumentsStore() {
  const setting = await prisma.setting.findUnique({ where: { key: SALES_DOCUMENTS_KEY } });
  return parseDocumentsStore(setting?.value);
}

async function saveDocumentsStore(db: Pick<typeof prisma, "setting">, store: SalesDocumentsStore) {
  await db.setting.upsert({
    where: { key: SALES_DOCUMENTS_KEY },
    create: { key: SALES_DOCUMENTS_KEY, value: store },
    update: { value: store }
  });
}

async function readCompanySettings() {
  const settings = await prisma.setting.findMany({
    where: { key: { in: [...COMPANY_SETTING_KEYS] } }
  });
  const mapped = new Map(settings.map((item) => [item.key, String(item.value ?? "")]));
  return {
    companyName: mapped.get("company_name") || "Galerie des Tanneurs",
    companyCurrency: mapped.get("company_currency") || "MAD",
    defaultTaxRate: Number(mapped.get("default_tax_rate") || 20),
    ticketFooter: mapped.get("ticket_footer") || "",
    companyLogoUrl: mapped.get("company_logo_url") || "",
    companyAddress: mapped.get("company_address") || "",
    companyEmail: mapped.get("company_email") || "",
    companyWebsite: mapped.get("company_website") || "",
    companyPatente: mapped.get("company_patente") || "",
    companyIce: mapped.get("company_ice") || "",
    companyRc: mapped.get("company_rc") || "",
    companyCnss: mapped.get("company_cnss") || ""
  };
}

async function readBoutiquesConfig() {
  const setting = await prisma.setting.findUnique({ where: { key: BOUTIQUES_CONFIG_KEY } });
  return Array.isArray(setting?.value) ? setting.value as Array<{ id: string; name?: string; address?: string; phone?: string; managerName?: string }> : [];
}

function nextDocumentNumber(prefix: string, existingNumbers: string[]) {
  const year = new Date().getFullYear();
  const currentYearPrefix = `${prefix}-${year}-`;
  const sequence = existingNumbers.filter((number) => number.startsWith(currentYearPrefix)).length + 1;
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

function filterDocumentsByWarehouse(store: SalesDocumentsStore, warehouseId: string | null) {
  if (!warehouseId) return store;
  return {
    quotes: store.quotes.filter((item) => item.warehouseId === warehouseId),
    deliveries: store.deliveries.filter((item) => item.warehouseId === warehouseId),
    invoices: store.invoices.filter((item) => item.warehouseId === warehouseId),
    credits: store.credits.filter((item) => String(item.warehouseId || "") === warehouseId)
  };
}

function mergeScopedDocuments(baseStore: SalesDocumentsStore, scopedStore: SalesDocumentsStore, warehouseId: string | null) {
  if (!warehouseId) return scopedStore;
  return {
    quotes: [...baseStore.quotes.filter((item) => item.warehouseId !== warehouseId), ...scopedStore.quotes],
    deliveries: [...baseStore.deliveries.filter((item) => item.warehouseId !== warehouseId), ...scopedStore.deliveries],
    invoices: [...baseStore.invoices.filter((item) => item.warehouseId !== warehouseId), ...scopedStore.invoices],
    credits: [...baseStore.credits.filter((item) => String(item.warehouseId || "") !== warehouseId), ...scopedStore.credits]
  };
}

salesRouter.get("/bootstrap", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [products, customers, warehouses, documents, company, boutiquesConfig, vouchers] = await Promise.all([
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, reference: true, salePriceTtc: true, taxRate: true }
    }),
    prisma.customer.findMany({
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, phone: true }
    }),
    prisma.warehouse.findMany({
      where: { type: "STORE", ...(scopedWarehouseId ? { id: scopedWarehouseId } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true }
    }),
    loadDocumentsStore(),
    readCompanySettings(),
    readBoutiquesConfig(),
    prisma.$queryRaw<Array<{
      id: string;
      number: string;
      initialAmount: number | string;
      balanceAmount: number | string;
      customerName: string | null;
      customerPhone: string | null;
      warehouseId: string | null;
      origin: string | null;
      sourceDocumentId: string | null;
      sourceDocumentNumber: string | null;
      createdByUserId: string | null;
      isActive: boolean;
      createdAt: Date;
    }>>(scopedWarehouseId
      ? Prisma.sql`SELECT "id", "number", "initialAmount", "balanceAmount", "customerName", "customerPhone", "warehouseId", "origin", "sourceDocumentId", "sourceDocumentNumber", "createdByUserId", "isActive", "createdAt" FROM "GiftVoucher" WHERE "warehouseId" = ${scopedWarehouseId} ORDER BY "createdAt" DESC`
      : Prisma.sql`SELECT "id", "number", "initialAmount", "balanceAmount", "customerName", "customerPhone", "warehouseId", "origin", "sourceDocumentId", "sourceDocumentNumber", "createdByUserId", "isActive", "createdAt" FROM "GiftVoucher" ORDER BY "createdAt" DESC`)
  ]);

  const boutiquesMap = new Map(boutiquesConfig.map((item) => [String(item.id), item]));
  const enrichedWarehouses = warehouses.map((warehouse) => {
    const boutique = boutiquesMap.get(warehouse.id);
    return {
      id: warehouse.id,
      name: boutique?.name || warehouse.name,
      address: boutique?.address || warehouse.address || "",
      phone: boutique?.phone || "",
      managerName: boutique?.managerName || ""
    };
  });

  const voucherRows: CreditVoucherRow[] = vouchers.map((voucher) => ({
    id: voucher.id,
    number: voucher.number,
    initialAmount: Number(voucher.initialAmount),
    balanceAmount: Number(voucher.balanceAmount),
    customerName: String(voucher.customerName ?? ""),
    customerPhone: String(voucher.customerPhone ?? ""),
    warehouseId: voucher.warehouseId ?? null,
    warehouseName: enrichedWarehouses.find((warehouse) => warehouse.id === voucher.warehouseId)?.name ?? "",
    origin: String(voucher.origin ?? "ADMIN"),
    sourceDocumentId: voucher.sourceDocumentId ?? null,
    sourceDocumentNumber: voucher.sourceDocumentNumber ?? null,
    createdByUserId: voucher.createdByUserId ?? null,
    isActive: voucher.isActive,
    createdAt: voucher.createdAt.toISOString()
  }));

  return ok(res, { products, customers, warehouses: enrichedWarehouses, documents: filterDocumentsByWarehouse(documents, scopedWarehouseId), company, vouchers: voucherRows });
}));

salesRouter.put("/documents", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = documentsStoreSchema.parse(req.body);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (scopedWarehouseId) {
    [...payload.quotes, ...payload.deliveries, ...payload.invoices].forEach((item) => ensureWarehouseAccess(req.currentUser, item.warehouseId));
    payload.credits.forEach((item) => ensureWarehouseAccess(req.currentUser, item.warehouseId ?? null));
  }
  const currentStore = await loadDocumentsStore();
  const nextStore = mergeScopedDocuments(currentStore, payload, scopedWarehouseId);
  await saveDocumentsStore(prisma, nextStore);
  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.documents.save",
    entityType: "setting",
    entityId: SALES_DOCUMENTS_KEY,
    meta: {
      quotes: payload.quotes.length,
      deliveries: payload.deliveries.length,
      invoices: payload.invoices.length,
      credits: payload.credits.length,
      warehouseScope: scopedWarehouseId || "ALL"
    }
  });
  return ok(res, filterDocumentsByWarehouse(nextStore, scopedWarehouseId), "Documents de vente enregistres.");
}));

salesRouter.post("/quotes/transform", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = idsPayloadSchema.parse(req.body);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const store = await loadDocumentsStore();
  const selectedQuotes = store.quotes.filter((quote) => payload.ids.includes(quote.id) && (!scopedWarehouseId || quote.warehouseId === scopedWarehouseId) && quote.status !== "CANCELLED" && quote.status !== "TRANSFORMED");
  if (!selectedQuotes.length) {
    throw new AppError("Aucun devis transformable selectionne.", 400);
  }

  const deliveryNumbers = [...store.deliveries.map((delivery) => delivery.number)];
  const createdAt = new Date().toISOString();

  const newDeliveries = selectedQuotes.map((quote, index) => {
    const number = nextDocumentNumber("BLC", deliveryNumbers);
    deliveryNumbers.push(number);
    return {
      id: `delivery-${Date.now()}-${index}`,
      number,
      status: "DRAFT" as const,
      createdAt,
      validatedAt: null,
      invoiceNumber: null,
      sourceQuoteId: quote.id,
      sourceQuoteNumber: quote.number,
      customerId: quote.customerId,
      customerName: quote.customerName,
      warehouseId: quote.warehouseId,
      warehouseName: quote.warehouseName,
      note: quote.note,
      totalAmount: quote.totalAmount,
      lines: quote.lines.map((line) => ({ ...line, id: `line-${Date.now()}-${Math.round(Math.random() * 100000)}` }))
    };
  });

  const nextStore: SalesDocumentsStore = {
    ...store,
    quotes: store.quotes.map((quote) => payload.ids.includes(quote.id) ? { ...quote, status: "TRANSFORMED" as const } : quote),
    deliveries: [...newDeliveries, ...store.deliveries]
  };

  await saveDocumentsStore(prisma, nextStore);
  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.quotes.transform",
    entityType: "setting",
    entityId: SALES_DOCUMENTS_KEY,
    meta: { ids: payload.ids, createdDeliveries: newDeliveries.map((item) => item.number) }
  });

  return ok(res, filterDocumentsByWarehouse(nextStore, scopedWarehouseId), "Devis transformes en bons de livraison.");
}));

salesRouter.post("/delivery-notes/validate", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = idsPayloadSchema.parse(req.body);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);

  const nextStore = await prisma.$transaction(async (tx) => {
    const setting = await tx.setting.findUnique({ where: { key: SALES_DOCUMENTS_KEY } });
    const store = parseDocumentsStore(setting?.value);
    const selectedDeliveries = store.deliveries.filter((delivery) => payload.ids.includes(delivery.id) && (!scopedWarehouseId || delivery.warehouseId === scopedWarehouseId) && delivery.status === "DRAFT");
    if (!selectedDeliveries.length) {
      throw new AppError("Aucun bon de livraison brouillon selectionne.", 400);
    }

    let invoiceSequenceNumbers = store.invoices.map((invoice) => invoice.number);
    const newInvoices: InvoiceDocument[] = [];
    const now = new Date().toISOString();

    for (const delivery of selectedDeliveries) {
      for (const line of delivery.lines) {
        const productId = String(line.productId || "").trim();
        const quantity = Number(line.quantity || 0) || 0;
        if (!productId || quantity <= 0) continue;

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new AppError(`Article introuvable pour le BL ${delivery.number}.`, 404);
        let balances = await readStockBalances(tx);
        balances = await ensureProductStockSeeded(tx, balances, product, delivery.warehouseId);
        const beforeLocationStock = getLocationStock(balances, product.id, delivery.warehouseId);
        if (beforeLocationStock < quantity) throw new AppError(`Stock insuffisant pour ${product.name} dans ${delivery.warehouseName}.`, 400);

        balances = applyLocationDelta(balances, product.id, delivery.warehouseId, -quantity);
        await saveStockBalances(tx, balances);
        const afterStock = product.stockOnHand - quantity;
        await tx.product.update({ where: { id: product.id }, data: { stockOnHand: afterStock } });
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            warehouseId: delivery.warehouseId,
            type: "OUT",
            quantity,
            beforeStock: beforeLocationStock,
            afterStock: beforeLocationStock - quantity,
            referenceType: "customer_delivery_note",
            referenceId: delivery.id,
            notes: `Validation BL ${delivery.number}`
          }
        });
      }

      const invoiceNumber = nextDocumentNumber("FAC", invoiceSequenceNumbers);
      invoiceSequenceNumbers = [...invoiceSequenceNumbers, invoiceNumber];
      newInvoices.push({
        id: `invoice-${Date.now()}-${Math.round(Math.random() * 100000)}`,
        number: invoiceNumber,
        createdAt: now,
        sourceDeliveryId: delivery.id,
        sourceDeliveryNumber: delivery.number,
        customerId: delivery.customerId,
        customerName: delivery.customerName,
        warehouseId: delivery.warehouseId,
        warehouseName: delivery.warehouseName,
        amount: delivery.totalAmount,
        lines: delivery.lines.map((line) => ({ ...line }))
      });
    }

    const updatedStore: SalesDocumentsStore = {
      ...store,
      deliveries: store.deliveries.map((delivery) => {
        const createdInvoice = newInvoices.find((invoice) => invoice.sourceDeliveryId === delivery.id);
        return payload.ids.includes(delivery.id) && delivery.status === "DRAFT"
          ? {
              ...delivery,
              status: "INVOICED" as const,
              validatedAt: now,
              invoiceNumber: createdInvoice?.number ?? delivery.invoiceNumber ?? null
            }
          : delivery;
      }),
      invoices: [...newInvoices, ...store.invoices]
    };

    await saveDocumentsStore(tx, updatedStore);
    return updatedStore;
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.delivery.validate",
    entityType: "setting",
    entityId: SALES_DOCUMENTS_KEY,
    meta: { ids: payload.ids }
  });

  return ok(res, filterDocumentsByWarehouse(nextStore, scopedWarehouseId), "Bons de livraison valides et factures clients creees.");
}));

salesRouter.post("/credits", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = createCreditPayloadSchema.parse(req.body);
  ensureWarehouseAccess(req.currentUser, payload.warehouseId ?? null);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);

  const nextStore = await prisma.$transaction(async (tx) => {
    const setting = await tx.setting.findUnique({ where: { key: SALES_DOCUMENTS_KEY } });
    const store = parseDocumentsStore(setting?.value);
    const credit: CreditDocument = {
      ...payload,
      id: `credit-${Date.now()}-${Math.round(Math.random() * 100000)}`,
      createdAt: new Date().toISOString(),
      customerPhone: String(payload.customerPhone ?? "").trim(),
      origin: payload.origin ?? "ADMIN",
      createdByName: String(payload.createdByName ?? req.currentUser?.fullName ?? "").trim(),
      voucherNumber: buildCreditVoucherNumber(payload.voucherNumber || payload.number),
      voucherInitialAmount: Number(payload.voucherInitialAmount || payload.amount || 0),
      voucherBalanceAmount: Number(payload.voucherBalanceAmount || payload.amount || 0)
    };

    const sourceWarehouseId = String(payload.warehouseId || "").trim();
    for (const item of payload.items) {
      const productId = String(item.productId || "").trim();
      const quantity = Number(item.quantity || 0) || 0;
      if (!productId || !sourceWarehouseId || quantity <= 0) continue;

      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new AppError(`Article introuvable pour l'avoir ${payload.number}.`, 404);

      let balances = await readStockBalances(tx);
      balances = await ensureProductStockSeeded(tx, balances, product, sourceWarehouseId);
      const beforeLocationStock = getLocationStock(balances, product.id, sourceWarehouseId);
      balances = applyLocationDelta(balances, product.id, sourceWarehouseId, quantity);
      await saveStockBalances(tx, balances);
      const afterStock = product.stockOnHand + quantity;
      await tx.product.update({
        where: { id: product.id },
        data: { stockOnHand: afterStock }
      });
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          warehouseId: sourceWarehouseId,
          type: "IN",
          quantity,
          beforeStock: beforeLocationStock,
          afterStock: beforeLocationStock + quantity,
          referenceType: "customer_credit_note",
          referenceId: credit.id,
          notes: `Creation avoir client ${payload.number}`
        }
      });
    }

      const updatedStore: SalesDocumentsStore = {
      ...store,
      credits: [credit, ...store.credits]
    };

    await tx.$executeRaw`
      INSERT INTO "GiftVoucher" (
        "id", "number", "initialAmount", "balanceAmount", "customerId", "customerName", "customerPhone",
        "warehouseId", "origin", "sourceDocumentId", "sourceDocumentNumber", "createdByUserId", "note",
        "isActive", "createdAt", "updatedAt"
      ) VALUES (
        ${`gift-${credit.id}`},
        ${credit.voucherNumber},
        ${credit.voucherInitialAmount},
        ${credit.voucherBalanceAmount},
        ${null},
        ${credit.customerName},
        ${credit.customerPhone || null},
        ${credit.warehouseId ?? null},
        ${credit.origin},
        ${credit.id},
        ${credit.number},
        ${req.currentUser?.id ?? null},
        ${credit.reason || null},
        ${credit.voucherBalanceAmount > 0},
        NOW(),
        NOW()
      )
    `;

    await saveDocumentsStore(tx, updatedStore);
    return updatedStore;
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.credit.create",
    entityType: "setting",
    entityId: SALES_DOCUMENTS_KEY,
    meta: { number: payload.number, sourceType: payload.sourceType, sourceId: payload.sourceId, origin: payload.origin ?? "ADMIN" }
  });

  return ok(res, filterDocumentsByWarehouse(nextStore, scopedWarehouseId), "Avoir client cree et stock reintegre.");
}));

salesRouter.get("/command-center/bootstrap", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseIdForRequest(req);
  const [legacyOptions, warehouses, sellers, products] = await Promise.all([
    runLegacyOrdersBridge<LegacyBridgeOptions>("options"),
    prisma.warehouse.findMany({
      where: { type: "STORE", ...(scopedWarehouseId ? { id: scopedWarehouseId } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }),
    prisma.seller.findMany({
      where: scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined,
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, warehouseId: true }
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, reference: true, salePriceTtc: true }
    })
  ]);

  return ok(res, {
    warehouses,
    sellers,
    products: products.map((product) => ({
      ...product,
      reference: product.reference ?? "",
      salePriceTtc: Number(product.salePriceTtc)
    })),
    ateliers: [
      { id: "sacs", label: "Commandes Sacs" },
      { id: "vetements", label: "Commandes Vetements" },
      { id: "chaussures", label: "Commandes Chaussures" },
      { id: "iraqi", label: "Commandes Iraqi" },
      { id: "mobiliers", label: "Commandes Mobiliers" }
    ],
    statuses: [
      { id: "en_cours", label: "En fabrication" },
      { id: "retardee", label: "Retardee" },
      { id: "annulee", label: "Annulee" },
      { id: "en_stock", label: "En stock" },
      { id: "livree", label: "Livree" }
    ],
    legacy: legacyOptions
  });
}));

salesRouter.post("/command-center/customers", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = commandCustomerCreateSchema.parse(req.body);
  const customer = await prisma.customer.create({
    data: {
      fullName: payload.name,
      phone: payload.phone || null,
      address: payload.address || null
    }
  });
  const legacyClient = await runLegacyOrdersBridge<{ id: number; name: string }>("create_client", payload);

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.command.customer.create",
    entityType: "customer",
    entityId: customer.id,
    meta: {
      legacyClientId: legacyClient.id,
      fullName: customer.fullName
    }
  });

  return ok(res, {
    customerId: customer.id,
    customerName: customer.fullName,
    legacyClientId: legacyClient.id,
    legacyClientName: legacyClient.name
  }, "Client ajoute.");
}));

salesRouter.get("/command-center/non-validated", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseIdForRequest(req);
  const query = commandTabQuerySchema.parse(req.query ?? {});
  const createdAtFilter = query.dateFrom || query.dateTo
    ? {
        createdAt: {
          ...(query.dateFrom ? { gte: buildDateStart(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: buildDateEnd(query.dateTo) } : {})
        }
      }
    : {};
  const sales = await prisma.sale.findMany({
    where: {
      ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}),
      note: { contains: "Acompte commande", mode: "insensitive" },
      ...createdAtFilter
    },
    include: {
      customer: true,
      warehouse: true,
      items: { include: { product: true } },
      payments: true
    },
    orderBy: { createdAt: "desc" }
  });

  const orders = extractOrderSales(sales).filter((entry) => {
    if (!query.search.trim()) return true;
    const term = normalizeText(query.search);
    return [
      entry.orderNumber,
      entry.orderType,
      entry.customerName,
      entry.sellerName,
      entry.warehouseName,
      entry.ticketNumbers.join(" ")
    ].some((value) => normalizeText(value).includes(term));
  });
  const legacyOrders = await runLegacyOrdersBridge<LegacyBridgeOrder[]>("list", { numbers: orders.map((entry) => entry.orderNumber) });
  const validated = new Set(legacyOrders.map((entry) => entry.orderNumber));

  return ok(res, orders.filter((entry) => !validated.has(entry.orderNumber)));
}));

salesRouter.get("/command-center/validated", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseIdForRequest(req);
  const query = commandTabQuerySchema.parse(req.query ?? {});
  const createdAtFilter = query.dateFrom || query.dateTo
    ? {
        createdAt: {
          ...(query.dateFrom ? { gte: buildDateStart(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: buildDateEnd(query.dateTo) } : {})
        }
      }
    : {};
  const sales = await prisma.sale.findMany({
    where: {
      ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}),
      note: { contains: "Acompte commande", mode: "insensitive" },
      ...createdAtFilter
    },
    include: {
      customer: true,
      warehouse: true,
      items: { include: { product: true } },
      payments: true
    },
    orderBy: { createdAt: "desc" }
  });
  const grouped = extractOrderSales(sales);
  const legacyOrders = await runLegacyOrdersBridge<LegacyBridgeOrder[]>("list", { numbers: grouped.map((entry) => entry.orderNumber) });
  const legacyMap = new Map(legacyOrders.map((entry) => [entry.orderNumber, entry]));

  const items = grouped
    .filter((entry) => legacyMap.has(entry.orderNumber))
    .map((entry) => ({
      ...entry,
      legacy: legacyMap.get(entry.orderNumber) || null
    }))
    .filter((entry) => {
      if (query.paidState === "paid") return entry.remainingAmount <= 0.009;
      if (query.paidState === "unpaid") return entry.remainingAmount > 0.009;
      return true;
    })
    .filter((entry) => {
      if (!query.search.trim()) return true;
      const term = normalizeText(query.search);
      return [
        entry.orderNumber,
        entry.orderType,
        entry.customerName,
        entry.sellerName,
        entry.warehouseName,
        entry.ticketNumbers.join(" ")
      ].some((value) => normalizeText(value).includes(term));
    });

  return ok(res, items);
}));

salesRouter.get("/command-center/legacy-orders", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseIdForRequest(req);
  const query = commandTabQuerySchema.parse(req.query ?? {});
  const legacyOptions = await runLegacyOrdersBridge<LegacyBridgeOptions>("options");
  const warehouses = await prisma.warehouse.findMany({
    where: { type: "STORE", ...(scopedWarehouseId ? { id: scopedWarehouseId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true }
  });
  const scopedWarehouse = scopedWarehouseId ? warehouses.find((warehouse) => warehouse.id === scopedWarehouseId) ?? null : null;
  const scopedLegacyStoreId = scopedWarehouse ? matchLegacyStoreId(legacyOptions.stores, scopedWarehouse.name) : null;

  const items = await runLegacyOrdersBridge<LegacyBridgeOrder[]>("list", {
    search: query.search,
    storeId: scopedLegacyStoreId,
    commandType: mapAtelierToLegacyType(query.atelier),
    statusKey: query.statusKey,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo
  });

  return ok(res, items.map((item) => ({
    ...item,
    atelierGroup: resolveAtelierGroup(item.statusKey)
  })));
}));

salesRouter.get("/command-center/legacy-orders/:orderNumber", asyncHandler(async (req, res) => {
  const orderNumber = String(req.params.orderNumber ?? "").trim();
  if (!orderNumber) throw new AppError("Numero de commande obligatoire.", 422);
  const item = await runLegacyOrdersBridge<LegacyBridgeOrder>("get", { orderNumber });
  return ok(res, item);
}));

salesRouter.patch("/command-center/legacy-orders/:orderNumber", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const targetOrderNumber = String(req.params.orderNumber ?? "").trim();
  if (!targetOrderNumber) throw new AppError("Numero de commande obligatoire.", 422);
  const payload = commandValidationSchema.parse(req.body);
  const normalizedPayload = {
    ...payload,
    orderNumber: String(payload.orderNumber || "").trim()
  };
  if (!normalizedPayload.orderNumber) throw new AppError("Numero de commande obligatoire.", 422);

  const updated = await runLegacyOrdersBridge<LegacyBridgeOrder>("update", {
    ...normalizedPayload,
    actorName: req.currentUser?.fullName || req.currentUser?.email || "Session API",
    targetOrderNumber
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.command.update",
    entityType: "legacy_order",
    entityId: String(updated.id),
    meta: {
      previousOrderNumber: targetOrderNumber,
      orderNumber: updated.orderNumber
    }
  });

  return ok(res, updated, "Commande mise a jour.");
}));

salesRouter.post("/command-center/validate", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = commandValidationSchema.parse(req.body);
  const normalizedPayload = {
    ...payload,
    orderNumber: String(payload.orderNumber || "").trim()
  };
  if (!normalizedPayload.orderNumber) throw new AppError("Numero de commande obligatoire.", 422);
  const scopedWarehouseId = getScopedWarehouseIdForRequest(req);
  const sourceSale = normalizedPayload.sourceSaleId
    ? await prisma.sale.findUnique({
        where: { id: normalizedPayload.sourceSaleId },
        include: { customer: true, warehouse: true }
      })
    : null;

  if (sourceSale) {
    if (!isCommandValidationScope(req)) {
      ensureWarehouseAccess(req.currentUser, sourceSale.warehouseId);
    }
  } else if (scopedWarehouseId) {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: scopedWarehouseId }, select: { id: true } });
    if (!warehouse) throw new AppError("Boutique introuvable.", 404);
  }

  const legacyOptions = await runLegacyOrdersBridge<LegacyBridgeOptions>("options");
  const created = await runLegacyOrdersBridge<LegacyBridgeOrder>("create", {
    ...normalizedPayload,
    actorName: req.currentUser?.fullName || req.currentUser?.email || "Session API",
    sourceSaleId: normalizedPayload.sourceSaleId || undefined,
    sourceTicketNumber: normalizedPayload.sourceTicketNumber || undefined
  });

  if (sourceSale) {
    const selectedLegacyClient = legacyOptions.clients.find((client) => client.id === normalizedPayload.clientId);
    if (selectedLegacyClient) {
      let matchedCustomer = await prisma.customer.findFirst({
        where: { fullName: selectedLegacyClient.name },
        select: { id: true }
      });

      if (!matchedCustomer) {
        matchedCustomer = await prisma.customer.create({
          data: { fullName: selectedLegacyClient.name },
          select: { id: true }
        });
      }

      await prisma.sale.update({
        where: { id: sourceSale.id },
        data: { customerId: matchedCustomer.id }
      });
    }
  }

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.command.validate",
    entityType: "legacy_order",
    entityId: String(created.id),
    meta: {
      orderNumber: created.orderNumber,
      sourceSaleId: normalizedPayload.sourceSaleId || null,
      sourceTicketNumber: normalizedPayload.sourceTicketNumber || null,
      legacyStoreId: normalizedPayload.storeId,
      legacyClientId: normalizedPayload.clientId,
      availableLegacyStores: legacyOptions.stores.length
    }
  });

  return ok(res, created, "Commande validee.");
}));

salesRouter.patch("/command-center/legacy-orders/:orderNumber/status", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const orderNumber = String(req.params.orderNumber ?? "").trim();
  const payload = commandStatusUpdateSchema.parse(req.body);
  if (!orderNumber) throw new AppError("Numero de commande obligatoire.", 422);

  const updated = await runLegacyOrdersBridge<LegacyBridgeOrder>("update_status", {
    orderNumber,
    status: mapStatusForLegacyUpdate(payload.status),
    actorName: req.currentUser?.fullName || req.currentUser?.email || "Session API"
  });

  await writeAuditLog({
    userId: req.currentUser?.id,
    action: "sales.command.status",
    entityType: "legacy_order",
    entityId: String(updated.id),
    meta: { orderNumber, status: payload.status }
  });

  return ok(res, updated, "Statut commande mis a jour.");
}));

salesRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => ok(res, await prisma.sale.findMany({
  where: getScopedWarehouseId(req.currentUser) ? { warehouseId: getScopedWarehouseId(req.currentUser)! } : undefined,
  include: { customer: true, warehouse: true, transporter: true, items: { include: { product: true } }, payments: true },
  orderBy: { createdAt: "desc" }
}))));

salesRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { customer: true, warehouse: true, transporter: true, items: { include: { product: true } }, payments: true, returns: true }
  });
  if (!sale) throw new AppError("Vente introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouseId);
  return ok(res, sale);
}));

salesRouter.post("/:id/cancel", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const saleId = String(req.params.id);
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { id: true, warehouseId: true } });
  if (!sale) throw new AppError("Vente introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, sale.warehouseId);
  await prisma.sale.update({ where: { id: saleId }, data: { status: "CANCELLED" } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "sales.cancel", entityType: "sale", entityId: saleId });
  return ok(res, true, "Vente annulee.");
}));
