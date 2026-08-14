import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { authenticate, type AuthenticatedRequest, requirePermissions } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";

const defaultColorTypes = ["Maroquinerie", "Chaussure", "Vetement"];
const defaultSizeTypes = ["Chaussure femme", "Chaussure homme", "Sportswear", "Vetement femme", "Vetement homme", "Size"];
const defaultPaymentMethods = [
  { id: "cash", code: "CASH", label: "Especes", isActive: true },
  { id: "card", code: "CARD", label: "Carte", isActive: true },
  { id: "transfer", code: "TRANSFER", label: "Virement", isActive: true },
  { id: "cheque", code: "CHEQUE", label: "Cheque", isActive: true },
  { id: "credit", code: "CREDIT", label: "Credit", isActive: true },
  { id: "voucher", code: "VOUCHER", label: "Bon achat", isActive: true },
  { id: "foreign_currency", code: "FOREIGN_CURRENCY", label: "Devise etrangere", isActive: true },
  { id: "mixed", code: "MIXED", label: "Paiement mixte", isActive: true }
];

const colorSchema = z.object({
  reference: z.string().min(1),
  name: z.string().min(2),
  type: z.string().min(2),
  isAvailable: z.boolean().default(true)
});

const sizeSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(2)
});

const typeNameSchema = z.object({
  name: z.string().min(2)
});


const currencySchema = z.object({
  code: z.string().min(3).max(3),
  name: z.string().min(2),
  symbol: z.string().optional().default(""),
  rateFromMad: z.coerce.number().positive().default(1),
  rateMode: z.enum(["MANUAL", "AUTO"]).default("MANUAL"),
  isActive: z.boolean().default(true)
});

const convertSchema = z.object({
  amountMad: z.coerce.number().default(0),
  currencyId: z.string().min(1)
});
const paymentMethodSchema = z.object({
  code: z.string().min(2).max(24).transform((value) => value.trim().toUpperCase()).refine((value) => /^[A-Z0-9_-]+$/.test(value), "Code de paiement invalide."),
  label: z.string().min(2),
  isActive: z.boolean().default(true)
});
const schema = z.object({
  company_name: z.string().min(2),
  company_currency: z.string().min(2),
  default_tax_rate: z.coerce.number(),
  ticket_cgv: z.string().min(2),
  ticket_footer: z.string().min(2),
  company_logo_url: z.string().optional().default(""),
  company_address: z.string().optional().default(""),
  company_email: z.string().optional().default(""),
  company_website: z.string().optional().default(""),
  company_patente: z.string().optional().default(""),
  company_ice: z.string().optional().default(""),
  company_rc: z.string().optional().default(""),
  company_cnss: z.string().optional().default(""),
  product_colors: z.string().optional().default(""),
  product_sizes: z.string().optional().default(""),
  currencies: z.string().optional().default(""),
  ticket_print_profiles: z.unknown().optional()
});

const boutiqueItemSchema = z.object({
  id: z.string(),
  name: z.string().min(2),
  address: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  managerName: z.string().optional().default(""),
  sellerNames: z.array(z.string()).default([]),
  ticketPrefix: z.string().optional().default("")
});

const boutiqueSchema = z.object({ boutiques: z.array(boutiqueItemSchema) });
const boutiqueCreateSchema = boutiqueItemSchema.omit({ id: true });

const sellerItemSchema = z.object({
  id: z.string(),
  boutiqueId: z.string().optional().nullable(),
  commissionRate: z.coerce.number().default(0),
  categoryIds: z.array(z.string()).default([])
});

const sellerCreateSchema = z.object({
  fullName: z.string().min(2),
  boutiqueId: z.string().optional().nullable(),
  commissionRate: z.coerce.number().default(0),
  categoryIds: z.array(z.string()).default([])
});
const sellerSchema = z.object({ sellers: z.array(sellerItemSchema) });

type BoutiqueSetting = z.infer<typeof boutiqueItemSchema>;
type LegacySellerSetting = { id: string; boutiqueId?: string | null; commissionRate?: number; specialtyCategoryId?: string | null; categoryIds?: string[] };

type SellerWithRelations = Awaited<ReturnType<typeof findSellers>>[number];

function slugify(value: string) {
  return value.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "BOUTIQUE";
}

function normalizeTicketPrefix(value: string) {
  return value.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, "").slice(0, 6);
}

function defaultTicketPrefix(name: string) {
  const normalizedName = slugify(name);
  const directMap: Record<string, string> = {
    "GUELIZ": "GUE",
    "MOUASSINE": "MOA",
    "MAJORELLE": "MAJ",
    "SOFITEL": "SOF",
    "M-AVENUE": "MAV",
    "MAVENUE": "MAV"
  };
  if (directMap[normalizedName]) return directMap[normalizedName];
  return normalizedName.replace(/-/g, "").slice(0, 3) || "POS";
}

async function readJsonSetting<T>(key: string) {
  const setting = await prisma.setting.findUnique({ where: { key } });
  return Array.isArray(setting?.value) ? setting.value as T[] : [];
}

async function saveJsonSetting<T>(key: string, value: T[]) {
  const jsonValue = value as Prisma.InputJsonValue;
  return prisma.setting.upsert({
    where: { key },
    update: { value: jsonValue },
    create: { key, value: jsonValue }
  });
}

function normalizeTypeList(values: string[]) {
  const normalized = values.map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b, "fr"));
}

async function readTypeSetting(key: "color_types" | "size_types", defaults: string[]) {
  const setting = await prisma.setting.findUnique({ where: { key } });
  const values = Array.isArray(setting?.value)
    ? (setting.value as unknown[]).map((item) => String(item ?? ""))
    : [];
  const normalized = Array.isArray(setting?.value) ? normalizeTypeList(values) : normalizeTypeList(defaults);
  if (!Array.isArray(setting?.value)) {
    await saveJsonSetting(key, normalized);
  }
  return normalized;
}

async function saveTypeSetting(key: "color_types" | "size_types", values: string[]) {
  const normalized = normalizeTypeList(values);
  await saveJsonSetting(key, normalized);
  return normalized;
}

async function readColorTypes() {
  const saved = await readTypeSetting("color_types", defaultColorTypes);
  const used = await prisma.color.findMany({ distinct: ["type"], select: { type: true } });
  const merged = normalizeTypeList([...saved, ...used.map((item) => item.type)]);
  if (merged.join("|") !== saved.join("|")) await saveJsonSetting("color_types", merged);
  return merged;
}

async function readSizeTypes() {
  const saved = await readTypeSetting("size_types", defaultSizeTypes);
  const used = await prisma.size.findMany({ distinct: ["type"], select: { type: true } });
  const merged = normalizeTypeList([...saved, ...used.map((item) => item.type)]);
  if (merged.join("|") !== saved.join("|")) await saveJsonSetting("size_types", merged);
  return merged;
}

async function findSellers() {
  return prisma.seller.findMany({
    where: { isActive: true },
    orderBy: { fullName: "asc" },
    include: { warehouse: true, categories: { include: { category: true }, orderBy: { category: { name: "asc" } } } }
  });
}

function mapSeller(seller: SellerWithRelations) {
  const categoryIds = seller.categories.map((item) => item.categoryId);
  const categoryNames = seller.categories.map((item) => item.category.name);
  return {
    id: seller.id,
    fullName: seller.fullName,
    email: "",
    boutiqueId: seller.warehouseId,
    boutiqueName: seller.warehouse?.name ?? "",
    commissionRate: Number(seller.commissionRate),
    categoryIds,
    categoryNames,
    specialtyCategoryId: categoryIds[0] ?? null,
    specialtyCategoryName: categoryNames[0] ?? ""
  };
}

async function ensureColorsSeeded() {
  const count = await prisma.color.count();
  if (count > 0) return;
  const setting = await prisma.setting.findUnique({ where: { key: "product_colors" } });
  const raw = typeof setting?.value === "string" ? setting.value : "Noir, Camel, Marron, Orange";
  const names = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!names.length) return;
  await prisma.color.createMany({
    data: names.map((name, index) => ({ reference: `CLR-${String(index + 1).padStart(3, "0")}`, name, type: "Maroquinerie" })),
    skipDuplicates: true
  });
}

async function ensureSizesSeeded() {
  const count = await prisma.size.count();
  if (count > 0) return;
  const setting = await prisma.setting.findUnique({ where: { key: "product_sizes" } });
  const raw = typeof setting?.value === "string" ? setting.value : "XS, S, M, L, XL";
  const names = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!names.length) return;
  await prisma.size.createMany({
    data: names.map((name, index) => ({ reference: `SIZ-${String(index + 1).padStart(3, "0")}`, name, type: "Size" })),
    skipDuplicates: true
  });
}

async function nextSizeReference() {
  let index = await prisma.size.count() + 1;
  while (true) {
    const reference = `SIZ-${String(index).padStart(3, "0")}`;
    const exists = await prisma.size.findUnique({ where: { reference } });
    if (!exists) return reference;
    index += 1;
  }
}

function mapCurrency(currency: { id: string; code: string; name: string; symbol: string | null; rateFromMad: { toString(): string }; rateMode: string; isBase: boolean; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return { ...currency, rateFromMad: Number(currency.rateFromMad) };
}

async function fetchAutomaticRateFromMad(code: string) {
  if (code === "MAD") return 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/MAD", { signal: controller.signal });
    if (!response.ok) throw new Error("currency-rate-unavailable");
    const payload = await response.json() as { rates?: Record<string, number> };
    const rate = payload.rates?.[code];
    if (!rate || Number.isNaN(Number(rate))) throw new Error("currency-rate-missing");
    return Number(rate);
  } finally {
    clearTimeout(timeout);
  }
}

async function ensurePaymentMethodsSeeded() {
  const current = await readJsonSetting<{ id: string; code: string; label: string; isActive: boolean }>("payment_methods");
  if (current.length > 0) return current;
  await saveJsonSetting("payment_methods", defaultPaymentMethods);
  return defaultPaymentMethods;
}
async function ensureCurrenciesSeeded() {
  const count = await prisma.currency.count();
  if (count > 0) return;
  const setting = await prisma.setting.findUnique({ where: { key: "currencies" } });
  const raw = typeof setting?.value === "string" ? setting.value : "MAD, EUR, USD";
  const codes = Array.from(new Set(raw.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)));
  if (!codes.includes("MAD")) codes.unshift("MAD");
  await prisma.currency.createMany({
    data: codes.map((code) => ({
      code,
      name: code === "MAD" ? "Dirham marocain" : code,
      symbol: code === "MAD" ? "MAD" : code,
      rateFromMad: code === "MAD" ? 1 : 1,
      rateMode: code === "MAD" ? "MANUAL" : "MANUAL",
      isBase: code === "MAD",
      isActive: true
    })),
    skipDuplicates: true
  });
}
async function ensureSellersSeededFromUsers() {
  const count = await prisma.seller.count();
  if (count > 0) return;
  const [users, saved] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, userRoles: { some: { role: { name: { in: ["vendeur", "manager"] } } } } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, defaultWarehouseId: true }
    }),
    readJsonSetting<LegacySellerSetting>("sellers_config")
  ]);
  for (const user of users) {
    const details = saved.find((item) => item.id === user.id);
    const categoryIds = details?.categoryIds ?? (details?.specialtyCategoryId ? [details.specialtyCategoryId] : []);
    await prisma.seller.create({
      data: {
        fullName: user.fullName,
        warehouseId: details?.boutiqueId ?? user.defaultWarehouseId ?? null,
        commissionRate: details?.commissionRate ?? 0,
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) }
      }
    });
  }
}

export const settingsRouter = Router();
settingsRouter.use(authenticate);

settingsRouter.get("/boutiques", requirePermissions("settings_manage"), asyncHandler(async (_req, res) => {
  const [warehouses, sellers, saved] = await Promise.all([
    prisma.warehouse.findMany({ where: { type: "STORE" }, orderBy: { name: "asc" }, select: { id: true, name: true, address: true } }),
    prisma.seller.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    readJsonSetting<BoutiqueSetting>("boutiques_config")
  ]);
  const boutiques = warehouses.map((warehouse) => {
    const details = saved.find((item) => item.id === warehouse.id);
    return {
      id: warehouse.id,
      name: details?.name || warehouse.name,
      address: details?.address ?? warehouse.address ?? "",
      phone: details?.phone ?? "",
      managerName: details?.managerName ?? "",
      sellerNames: details?.sellerNames ?? [],
      ticketPrefix: normalizeTicketPrefix(details?.ticketPrefix ?? "") || defaultTicketPrefix(details?.name || warehouse.name)
    };
  });
  return ok(res, { boutiques, sellers });
}));

settingsRouter.post("/boutiques", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = boutiqueCreateSchema.parse(req.body);
  const created = await prisma.warehouse.create({
    data: {
      name: payload.name,
      code: `${slugify(payload.name)}-${Date.now().toString().slice(-5)}`,
      type: "STORE",
      address: payload.address || null
    }
  });
  const saved = await readJsonSetting<BoutiqueSetting>("boutiques_config");
  const boutique = {
    id: created.id,
    name: created.name,
    address: payload.address,
    phone: payload.phone,
    managerName: payload.managerName,
    sellerNames: payload.sellerNames,
    ticketPrefix: normalizeTicketPrefix(payload.ticketPrefix ?? "") || defaultTicketPrefix(payload.name)
  };
  await saveJsonSetting("boutiques_config", [...saved.filter((item) => item.id !== created.id), boutique]);
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.boutiques.create", entityType: "warehouse", entityId: created.id, meta: boutique });
  return ok(res, boutique, "Boutique creee.");
}));

settingsRouter.put("/boutiques", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = boutiqueSchema.parse(req.body);
  const normalizedBoutiques = payload.boutiques.map((boutique) => ({
    ...boutique,
    ticketPrefix: normalizeTicketPrefix(boutique.ticketPrefix ?? "") || defaultTicketPrefix(boutique.name)
  }));
  await prisma.$transaction(async (tx) => {
    for (const boutique of normalizedBoutiques) {
      await tx.warehouse.update({ where: { id: boutique.id }, data: { name: boutique.name, address: boutique.address || null } });
    }
    await tx.setting.upsert({
      where: { key: "boutiques_config" },
      update: { value: normalizedBoutiques as Prisma.InputJsonValue },
      create: { key: "boutiques_config", value: normalizedBoutiques as Prisma.InputJsonValue }
    });
  });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.boutiques.update", entityType: "setting", meta: { boutiques: normalizedBoutiques } });
  return ok(res, true, "Boutiques mises a jour.");
}));

settingsRouter.delete("/boutiques/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const [products, stockMoves, purchases, sales, cashRegisters, sellers] = await Promise.all([
    prisma.product.count({ where: { warehouseId: id } }),
    prisma.stockMovement.count({ where: { warehouseId: id } }),
    prisma.purchase.count({ where: { warehouseId: id } }),
    prisma.sale.count({ where: { warehouseId: id } }),
    prisma.cashRegister.count({ where: { warehouseId: id } }),
    prisma.seller.count({ where: { warehouseId: id } })
  ]);
  if (products + stockMoves + purchases + sales + cashRegisters + sellers > 0) {
    throw new AppError("Impossible de supprimer cette boutique car elle est deja utilisee.", 409);
  }
  await prisma.warehouse.delete({ where: { id } });
  const saved = await readJsonSetting<BoutiqueSetting>("boutiques_config");
  await saveJsonSetting("boutiques_config", saved.filter((item) => item.id !== id));
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.boutiques.delete", entityType: "warehouse", entityId: id });
  return ok(res, true, "Boutique supprimee.");
}));

settingsRouter.get("/sellers", requirePermissions("settings_manage"), asyncHandler(async (_req, res) => {
  await ensureSellersSeededFromUsers();
  const [sellers, boutiques, categories] = await Promise.all([
    findSellers(),
    prisma.warehouse.findMany({ where: { type: "STORE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, typeId: true, type: { select: { id: true, name: true } } } })
  ]);
  return ok(res, { sellers: sellers.map(mapSeller), boutiques, categories: categories.map((category) => ({ id: category.id, name: category.name, typeId: category.typeId, typeName: category.type?.name ?? "Sans type" })) });
}));

settingsRouter.post("/sellers", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = sellerCreateSchema.parse(req.body);
  const created = await prisma.seller.create({
    data: {
      fullName: payload.fullName,
      warehouseId: payload.boutiqueId || null,
      commissionRate: payload.commissionRate,
      categories: { create: payload.categoryIds.map((categoryId) => ({ categoryId })) }
    },
    include: { warehouse: true, categories: { include: { category: true } } }
  });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.sellers.create", entityType: "seller", entityId: created.id, meta: payload });
  return ok(res, mapSeller(created), "Vendeur cree.");
}));

settingsRouter.put("/sellers", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = sellerSchema.parse(req.body);
  await prisma.$transaction(async (tx) => {
    for (const seller of payload.sellers) {
      await tx.seller.update({ where: { id: seller.id }, data: { warehouseId: seller.boutiqueId || null, commissionRate: seller.commissionRate } });
      await tx.sellerCategory.deleteMany({ where: { sellerId: seller.id } });
      if (seller.categoryIds.length) {
        await tx.sellerCategory.createMany({ data: seller.categoryIds.map((categoryId) => ({ sellerId: seller.id, categoryId })), skipDuplicates: true });
      }
    }
  });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.sellers.update", entityType: "seller", meta: payload });
  return ok(res, true, "Vendeurs mis a jour.");
}));

settingsRouter.delete("/sellers/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const existing = await prisma.seller.findUnique({ where: { id } });
  if (!existing) throw new AppError("Vendeur introuvable.", 404);
  await prisma.seller.delete({ where: { id } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.sellers.delete", entityType: "seller", entityId: id, meta: { fullName: existing.fullName } });
  return ok(res, true, "Vendeur supprime.");
}));
settingsRouter.get("/payment-methods", requirePermissions("settings_manage"), asyncHandler(async (_req, res) => {
  const paymentMethods = await ensurePaymentMethodsSeeded();
  return ok(res, { paymentMethods });
}));

settingsRouter.post("/payment-methods", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = paymentMethodSchema.parse(req.body);
  const current = await ensurePaymentMethodsSeeded();
  const next = { id: `${payload.code.trim().toLowerCase()}-${Date.now()}`, code: payload.code.trim().toUpperCase(), label: payload.label.trim(), isActive: payload.isActive };
  if (current.some((item) => item.code === next.code)) throw new AppError("Ce mode de paiement existe deja.", 409);
  await saveJsonSetting("payment_methods", [...current, next]);
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.payment_methods.create", entityType: "setting", meta: next });
  return ok(res, next, "Mode de paiement cree.");
}));

settingsRouter.put("/payment-methods/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const payload = paymentMethodSchema.parse(req.body);
  const current = await ensurePaymentMethodsSeeded();
  if (current.some((item) => item.id !== id && item.code === payload.code.trim().toUpperCase())) throw new AppError("Ce code existe deja.", 409);
  const updated = { id, code: payload.code.trim().toUpperCase(), label: payload.label.trim(), isActive: payload.isActive };
  await saveJsonSetting("payment_methods", current.map((item) => item.id === id ? updated : item));
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.payment_methods.update", entityType: "setting", entityId: id, meta: updated });
  return ok(res, updated, "Mode de paiement mis a jour.");
}));

settingsRouter.delete("/payment-methods/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const current = await ensurePaymentMethodsSeeded();
  await saveJsonSetting("payment_methods", current.filter((item) => item.id !== id));
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.payment_methods.delete", entityType: "setting", entityId: id });
  return ok(res, true, "Mode de paiement supprime.");
}));
settingsRouter.get("/colors", requirePermissions("settings_manage"), asyncHandler(async (_req, res) => {
  await ensureColorsSeeded();
  const [colors, types] = await Promise.all([
    prisma.color.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    readColorTypes()
  ]);
  return ok(res, { colors, types });
}));

settingsRouter.post("/colors", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = colorSchema.parse(req.body);
  const exists = await prisma.color.findUnique({ where: { reference: payload.reference } });
  if (exists) throw new AppError("Une couleur existe deja avec cette reference.", 409);
  const color = await prisma.color.create({ data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.colors.create", entityType: "color", entityId: color.id, meta: payload });
  return ok(res, color, "Couleur creee.");
}));

settingsRouter.put("/colors/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const payload = colorSchema.parse(req.body);
  const duplicate = await prisma.color.findUnique({ where: { reference: payload.reference } });
  if (duplicate && duplicate.id !== id) throw new AppError("Une couleur existe deja avec cette reference.", 409);
  const color = await prisma.color.update({ where: { id }, data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.colors.update", entityType: "color", entityId: color.id, meta: payload });
  return ok(res, color, "Couleur mise a jour.");
}));

settingsRouter.delete("/colors/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  await prisma.color.delete({ where: { id } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.colors.delete", entityType: "color", entityId: id });
  return ok(res, true, "Couleur supprimee.");
}));

settingsRouter.post("/color-types", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = typeNameSchema.parse(req.body);
  const current = await readColorTypes();
  if (current.some((type) => type.toLowerCase() === payload.name.trim().toLowerCase())) throw new AppError("Ce type couleur existe deja.", 409);
  const types = await saveTypeSetting("color_types", [...current, payload.name.trim()]);
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.color_types.create", entityType: "setting", meta: payload });
  return ok(res, { types }, "Type couleur cree.");
}));

settingsRouter.put("/color-types/:name", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const currentName = decodeURIComponent(String(req.params.name));
  const payload = typeNameSchema.parse(req.body);
  const nextName = payload.name.trim();
  const current = await readColorTypes();
  if (!current.includes(currentName)) throw new AppError("Type couleur introuvable.", 404);
  if (current.some((type) => type !== currentName && type.toLowerCase() === nextName.toLowerCase())) throw new AppError("Ce type couleur existe deja.", 409);
  await prisma.color.updateMany({ where: { type: currentName }, data: { type: nextName } });
  const types = await saveTypeSetting("color_types", current.map((type) => type === currentName ? nextName : type));
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.color_types.update", entityType: "setting", meta: { from: currentName, to: nextName } });
  return ok(res, { types }, "Type couleur mis a jour.");
}));

settingsRouter.delete("/color-types/:name", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const name = decodeURIComponent(String(req.params.name));
  const used = await prisma.color.count({ where: { type: name } });
  if (used > 0) throw new AppError("Impossible de supprimer ce type car il est utilise par des couleurs.", 409);
  const current = await readColorTypes();
  const types = await saveTypeSetting("color_types", current.filter((type) => type !== name));
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.color_types.delete", entityType: "setting", meta: { name } });
  return ok(res, { types }, "Type couleur supprime.");
}));

settingsRouter.get("/sizes", requirePermissions("settings_manage"), asyncHandler(async (_req, res) => {
  await ensureSizesSeeded();
  const [sizes, types] = await Promise.all([
    prisma.size.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    readSizeTypes()
  ]);
  return ok(res, { sizes, types });
}));

settingsRouter.post("/sizes", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = sizeSchema.parse(req.body);
  const reference = await nextSizeReference();
  const size = await prisma.size.create({ data: { ...payload, reference } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.sizes.create", entityType: "size", entityId: size.id, meta: payload });
  return ok(res, size, "Taille creee.");
}));

settingsRouter.put("/sizes/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const payload = sizeSchema.parse(req.body);
  const size = await prisma.size.update({ where: { id }, data: payload });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.sizes.update", entityType: "size", entityId: size.id, meta: payload });
  return ok(res, size, "Taille mise a jour.");
}));

settingsRouter.delete("/sizes/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  await prisma.size.delete({ where: { id } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.sizes.delete", entityType: "size", entityId: id });
  return ok(res, true, "Taille supprimee.");
}));

settingsRouter.post("/size-types", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = typeNameSchema.parse(req.body);
  const current = await readSizeTypes();
  if (current.some((type) => type.toLowerCase() === payload.name.trim().toLowerCase())) throw new AppError("Ce type taille existe deja.", 409);
  const types = await saveTypeSetting("size_types", [...current, payload.name.trim()]);
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.size_types.create", entityType: "setting", meta: payload });
  return ok(res, { types }, "Type taille cree.");
}));

settingsRouter.put("/size-types/:name", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const currentName = decodeURIComponent(String(req.params.name));
  const payload = typeNameSchema.parse(req.body);
  const nextName = payload.name.trim();
  const current = await readSizeTypes();
  if (!current.includes(currentName)) throw new AppError("Type taille introuvable.", 404);
  if (current.some((type) => type !== currentName && type.toLowerCase() === nextName.toLowerCase())) throw new AppError("Ce type taille existe deja.", 409);
  await prisma.size.updateMany({ where: { type: currentName }, data: { type: nextName } });
  const types = await saveTypeSetting("size_types", current.map((type) => type === currentName ? nextName : type));
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.size_types.update", entityType: "setting", meta: { from: currentName, to: nextName } });
  return ok(res, { types }, "Type taille mis a jour.");
}));

settingsRouter.delete("/size-types/:name", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const name = decodeURIComponent(String(req.params.name));
  const used = await prisma.size.count({ where: { type: name } });
  if (used > 0) throw new AppError("Impossible de supprimer ce type car il est utilise par des tailles.", 409);
  const current = await readSizeTypes();
  const types = await saveTypeSetting("size_types", current.filter((type) => type !== name));
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.size_types.delete", entityType: "setting", meta: { name } });
  return ok(res, { types }, "Type taille supprime.");
}));
settingsRouter.get("/currencies", requirePermissions("settings_manage"), asyncHandler(async (_req, res) => {
  await ensureCurrenciesSeeded();
  const currencies = await prisma.currency.findMany({ orderBy: [{ isBase: "desc" }, { code: "asc" }] });
  return ok(res, { baseCurrency: "MAD", currencies: currencies.map(mapCurrency) });
}));

settingsRouter.post("/currencies", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = currencySchema.parse(req.body);
  const code = payload.code.trim().toUpperCase();
  const exists = await prisma.currency.findUnique({ where: { code } });
  if (exists) throw new AppError("Une devise existe deja avec ce code.", 409);
  const rateFromMad = payload.rateMode === "AUTO" ? await fetchAutomaticRateFromMad(code).catch(() => payload.rateFromMad) : payload.rateFromMad;
  const currency = await prisma.currency.create({ data: { ...payload, code, symbol: payload.symbol || code, rateFromMad, isBase: code === "MAD" } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.currencies.create", entityType: "currency", entityId: currency.id, meta: { ...payload, code } });
  return ok(res, mapCurrency(currency), "Devise creee.");
}));

settingsRouter.put("/currencies/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const payload = currencySchema.parse(req.body);
  const code = payload.code.trim().toUpperCase();
  const existing = await prisma.currency.findUnique({ where: { id } });
  if (!existing) throw new AppError("Devise introuvable.", 404);
  const duplicate = await prisma.currency.findUnique({ where: { code } });
  if (duplicate && duplicate.id !== id) throw new AppError("Une devise existe deja avec ce code.", 409);
  const rateFromMad = payload.rateMode === "AUTO" ? await fetchAutomaticRateFromMad(code).catch(() => payload.rateFromMad) : payload.rateFromMad;
  const currency = await prisma.currency.update({ where: { id }, data: { ...payload, code, symbol: payload.symbol || code, rateFromMad, isBase: existing.isBase || code === "MAD" } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.currencies.update", entityType: "currency", entityId: currency.id, meta: { ...payload, code } });
  return ok(res, mapCurrency(currency), "Devise mise a jour.");
}));

settingsRouter.post("/currencies/:id/refresh", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const existing = await prisma.currency.findUnique({ where: { id } });
  if (!existing) throw new AppError("Devise introuvable.", 404);
  const rateFromMad = await fetchAutomaticRateFromMad(existing.code).catch(() => { throw new AppError("Taux automatique indisponible. Utilise le mode manuel pour cette devise.", 503); });
  const currency = await prisma.currency.update({ where: { id }, data: { rateFromMad, rateMode: "AUTO" } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.currencies.refresh", entityType: "currency", entityId: currency.id, meta: { code: currency.code, rateFromMad } });
  return ok(res, mapCurrency(currency), "Taux automatique mis a jour.");
}));

settingsRouter.get("/currencies/convert", requirePermissions("settings_manage"), asyncHandler(async (req, res) => {
  const payload = convertSchema.parse(req.query);
  await ensureCurrenciesSeeded();
  const currency = await prisma.currency.findUnique({ where: { id: payload.currencyId } });
  if (!currency) throw new AppError("Devise introuvable.", 404);
  const convertedAmount = payload.amountMad * Number(currency.rateFromMad);
  return ok(res, { amountMad: payload.amountMad, currency: mapCurrency(currency), convertedAmount });
}));

settingsRouter.delete("/currencies/:id", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const existing = await prisma.currency.findUnique({ where: { id } });
  if (!existing) throw new AppError("Devise introuvable.", 404);
  if (existing.isBase || existing.code === "MAD") throw new AppError("La devise societe MAD ne peut pas etre supprimee.", 409);
  await prisma.currency.delete({ where: { id } });
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.currencies.delete", entityType: "currency", entityId: id });
  return ok(res, true, "Devise supprimee.");
}));
settingsRouter.get("/", requirePermissions("settings_manage"), asyncHandler(async (_req, res) => ok(res, await prisma.setting.findMany())));

settingsRouter.put("/", requirePermissions("settings_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = schema.parse(req.body);
  await Promise.all(
    Object.entries(payload).filter(([, value]) => value !== undefined).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: value as Prisma.InputJsonValue },
        create: { key, value: value as Prisma.InputJsonValue }
      })
    )
  );
  await writeAuditLog({ userId: req.currentUser?.id, action: "settings.update", entityType: "setting", meta: payload });
  return ok(res, true, "Parametres mis a jour.");
}));

