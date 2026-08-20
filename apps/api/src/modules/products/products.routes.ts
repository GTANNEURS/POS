import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import {
  authenticate,
  type AuthenticatedRequest,
  ensureWarehouseAccess,
  getScopedWarehouseId,
  isAdminUser,
  requirePermissions
} from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";
import {
  applyLocationDelta,
  areStockBalancesEqual,
  areVariantStockBalancesEqual,
  ensureProductStockSeeded,
  ensureVariantStockSeeded,
  getLocationStock,
  getProductLocationStockFromVariantBalances,
  getProductStockTotal,
  getProductStockTotalFromVariantBalances,
  getVariantLocationStock,
  readStockBalances,
  readVariantStockBalances,
  saveStockBalances,
  saveVariantStockBalances,
  syncVariantGlobalStock
} from "../../common/stock-balances.js";

const productVariantSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  reference: z.string().min(2),
  barcode: z.string().min(6),
  stockOnHand: z.coerce.number().int().default(0)
});

const productSchema = z.object({
  reference: z.string().min(2),
  barcode: z.string().optional().nullable(),
  name: z.string().min(2),
  typeId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  purchasePriceHt: z.coerce.number(),
  purchasePriceTtc: z.coerce.number(),
  salePriceHt: z.coerce.number(),
  salePriceTtc: z.coerce.number(),
  promoPriceHt: z.coerce.number().optional().nullable(),
  promoPriceTtc: z.coerce.number().optional().nullable(),
  promoPriceActive: z.coerce.boolean().default(false),
  taxRate: z.coerce.number(),
  stockOnHand: z.coerce.number().int(),
  minStock: z.coerce.number().int(),
  imageUrl: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  dimensions: z.string().optional().nullable(),
  weight: z.string().optional().nullable(),
  isTaxExempt: z.coerce.boolean().default(false),
  isCommissioned: z.coerce.boolean().default(false),
  sourcingMode: z.enum(["BUY_RESELL", "CONSIGNMENT", "MANUFACTURED"]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  variants: z.array(productVariantSchema).default([])
});

const metaEntitySchema = z.object({
  name: z.string().min(2),
  symbol: z.string().optional().nullable(),
  code: z.string().optional().nullable(),
  type: z.enum(["STORE", "WAREHOUSE"]).optional(),
  typeId: z.string().optional().nullable()
});

const importSchema = z.object({ rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1) });

type MetaPayload = z.infer<typeof metaEntitySchema>;
type ProductPayload = z.infer<typeof productSchema>;
type ProductVariantPayload = z.infer<typeof productVariantSchema>;
type DbClient = Prisma.TransactionClient | typeof prisma;

export const productsRouter = Router();
productsRouter.use(authenticate);

function slugify(value: string) {
  return value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "WH";
}

function cleanCell(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function pickValue(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = cleanCell(row[alias]);
    if (value) return value;
  }
  return "";
}

function toNumber(value: string, fallback = 0) {
  if (!value) return fallback;
  const normalized = Number(value.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function toInt(value: string, fallback = 0) {
  return Math.round(toNumber(value, fallback));
}

function toBoolean(value: unknown, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "oui", "yes", "vrai"].includes(normalized)) return true;
  if (["false", "0", "non", "no", "faux"].includes(normalized)) return false;
  return fallback;
}

function codePrefix(value: string) {
  return value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 10) || "ITEM";
}

function normalizeWarehouseLabel(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickCentralWarehouseId(warehouses: Array<{ id: string; name: string; type?: string | null }>) {
  return warehouses.find((warehouse) => normalizeWarehouseLabel(warehouse.name).includes("depot central"))?.id
    ?? warehouses.find((warehouse) => warehouse.type === "WAREHOUSE")?.id
    ?? warehouses[0]?.id
    ?? null;
}

async function readBoutiqueNameMap() {
  const setting = await prisma.setting.findUnique({ where: { key: "boutiques_config" } });
  if (!Array.isArray(setting?.value)) return new Map<string, string>();
  const pairs = (setting.value as unknown[])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? "").trim();
      const name = String(row.name ?? "").trim();
      return id && name ? [id, name] as const : null;
    })
    .filter((item): item is readonly [string, string] => Boolean(item));
  return new Map(pairs);
}

async function resolveCurrentUserWarehouse(currentUser: AuthenticatedRequest["currentUser"]) {
  if (!currentUser?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { defaultWarehouseId: true }
  });
  const warehouseId = user?.defaultWarehouseId ?? currentUser.defaultWarehouse?.id ?? null;
  if (!warehouseId) return null;
  return prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, name: true, code: true, type: true }
  });
}

async function ensureVariantMetaSeeded() {
  const [colorCount, sizeCount] = await Promise.all([prisma.color.count(), prisma.size.count()]);

  if (colorCount === 0) {
    const setting = await prisma.setting.findUnique({ where: { key: "product_colors" } });
    const raw = typeof setting?.value === "string" ? setting.value : "Noir, Camel, Marron, Orange";
    const names = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (names.length) {
      await prisma.color.createMany({
        data: names.map((name, index) => ({ reference: `CLR-${codePrefix(name)}-${String(index + 1).padStart(3, "0")}`, name, type: "Maroquinerie" })),
        skipDuplicates: true
      });
    }
  }

  if (sizeCount === 0) {
    const setting = await prisma.setting.findUnique({ where: { key: "product_sizes" } });
    const raw = typeof setting?.value === "string" ? setting.value : "XS, S, M, L, XL";
    const names = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (names.length) {
      await prisma.size.createMany({
        data: names.map((name, index) => ({ reference: `SIZ-${codePrefix(name)}-${String(index + 1).padStart(3, "0")}`, name, type: "Size" })),
        skipDuplicates: true
      });
    }
  }
}

async function normalizeProductPayload(payload: Partial<ProductPayload>) {
  const normalized: Partial<ProductPayload> = { ...payload };

  if (payload.categoryId) {
    const category = await prisma.productCategory.findUnique({ where: { id: payload.categoryId } });
    if (!category) throw new AppError("Categorie introuvable.", 404);
    if (category.typeId && payload.typeId && category.typeId !== payload.typeId) {
      throw new AppError("La categorie choisie ne correspond pas au type d'article.", 400);
    }
    normalized.typeId = payload.typeId ?? category.typeId ?? null;
  }

  return normalized;
}

function assertProductWriteAccess(req: AuthenticatedRequest) {
  if (!isAdminUser(req.currentUser)) {
    throw new AppError("Seul l'administrateur peut ajouter, modifier ou supprimer un article.", 403);
  }
}

async function syncVariantBalancesForProduct(
  tx: DbClient,
  variants: Array<{ id: string; stockOnHand: number }>,
  warehouseId?: string | null
) {
  let variantBalances = await readVariantStockBalances(tx);
  const variantIds = new Set(variants.map((variant) => variant.id));
  variantBalances = variantBalances.filter((entry) => !variantIds.has(entry.variantId));
  for (const variant of variants) {
    variantBalances = await ensureVariantStockSeeded(tx, variantBalances, { ...variant, product: { warehouseId } }, warehouseId);
  }
  await saveVariantStockBalances(tx, variantBalances);
}

function normalizeVariantPayload(variants: ProductVariantPayload[]) {
  const seenReferences = new Set<string>();
  const seenBarcodes = new Set<string>();

  return variants.map((variant, index) => {
    const reference = String(variant.reference ?? "").trim();
    const barcode = String(variant.barcode ?? "").trim();
    const color = String(variant.color ?? "").trim() || null;
    const size = String(variant.size ?? "").trim() || null;
    const label = String(variant.label ?? "").trim() || [color, size].filter(Boolean).join(" / ") || `Variante ${index + 1}`;

    if (!reference) throw new AppError(`Reference variante manquante sur la ligne ${index + 1}.`, 400);
    if (!barcode) throw new AppError(`Code-barres variante manquant sur la ligne ${index + 1}.`, 400);

    const referenceKey = reference.toUpperCase();
    if (seenReferences.has(referenceKey)) throw new AppError(`Reference variante dupliquee: ${reference}.`, 400);
    if (seenBarcodes.has(barcode)) throw new AppError(`Code-barres variante duplique: ${barcode}.`, 400);

    seenReferences.add(referenceKey);
    seenBarcodes.add(barcode);

    return {
      label,
      color,
      size,
      reference,
      barcode,
      stockOnHand: Number(variant.stockOnHand ?? 0)
    };
  });
}

function toProductCreateData(payload: Omit<ProductPayload, "variants">): Prisma.ProductUncheckedCreateInput {
  return {
    reference: payload.reference,
    barcode: payload.barcode ?? null,
    name: payload.name,
    typeId: payload.typeId ?? null,
    categoryId: payload.categoryId ?? null,
    brandId: payload.brandId ?? null,
    unitId: payload.unitId ?? null,
    warehouseId: payload.warehouseId ?? null,
    purchasePriceHt: payload.purchasePriceHt,
    purchasePriceTtc: payload.purchasePriceTtc,
    salePriceHt: payload.salePriceHt,
    salePriceTtc: payload.salePriceTtc,
    promoPriceHt: payload.promoPriceActive ? payload.promoPriceHt ?? null : null,
    promoPriceTtc: payload.promoPriceActive ? payload.promoPriceTtc ?? null : null,
    promoPriceActive: payload.promoPriceActive,
    taxRate: payload.taxRate,
    stockOnHand: payload.stockOnHand,
    minStock: payload.minStock,
    imageUrl: payload.imageUrl ?? null,
    description: payload.description ?? null,
    dimensions: payload.dimensions ?? null,
    weight: payload.weight ?? null,
    isTaxExempt: payload.isTaxExempt,
    isCommissioned: payload.isCommissioned,
    sourcingMode: payload.sourcingMode,
    status: payload.status
  };
}

function toProductUpdateData(payload: Partial<Omit<ProductPayload, "variants">>): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  if (payload.reference !== undefined) data.reference = payload.reference;
  if (payload.barcode !== undefined) data.barcode = payload.barcode ?? null;
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.typeId !== undefined) data.typeId = payload.typeId ?? null;
  if (payload.categoryId !== undefined) data.categoryId = payload.categoryId ?? null;
  if (payload.brandId !== undefined) data.brandId = payload.brandId ?? null;
  if (payload.unitId !== undefined) data.unitId = payload.unitId ?? null;
  if (payload.warehouseId !== undefined) data.warehouseId = payload.warehouseId ?? null;
  if (payload.purchasePriceHt !== undefined) data.purchasePriceHt = payload.purchasePriceHt;
  if (payload.purchasePriceTtc !== undefined) data.purchasePriceTtc = payload.purchasePriceTtc;
  if (payload.salePriceHt !== undefined) data.salePriceHt = payload.salePriceHt;
  if (payload.salePriceTtc !== undefined) data.salePriceTtc = payload.salePriceTtc;
  if (payload.promoPriceHt !== undefined) data.promoPriceHt = payload.promoPriceActive ? payload.promoPriceHt ?? null : null;
  if (payload.promoPriceTtc !== undefined) data.promoPriceTtc = payload.promoPriceActive ? payload.promoPriceTtc ?? null : null;
  if (payload.promoPriceActive !== undefined) data.promoPriceActive = payload.promoPriceActive;
  if (payload.taxRate !== undefined) data.taxRate = payload.taxRate;
  if (payload.stockOnHand !== undefined) data.stockOnHand = payload.stockOnHand;
  if (payload.minStock !== undefined) data.minStock = payload.minStock;
  if (payload.imageUrl !== undefined) data.imageUrl = payload.imageUrl ?? null;
  if (payload.description !== undefined) data.description = payload.description ?? null;
  if (payload.dimensions !== undefined) data.dimensions = payload.dimensions ?? null;
  if (payload.weight !== undefined) data.weight = payload.weight ?? null;
  if (payload.isTaxExempt !== undefined) data.isTaxExempt = payload.isTaxExempt;
  if (payload.isCommissioned !== undefined) data.isCommissioned = payload.isCommissioned;
  if (payload.sourcingMode !== undefined) data.sourcingMode = payload.sourcingMode;
  if (payload.status !== undefined) data.status = payload.status;
  return data;
}

async function syncProductLocationBalance(
  tx: DbClient,
  product: { id: string; stockOnHand: number; warehouseId?: string | null },
  nextGlobalStock: number,
  warehouseId?: string | null
) {
  const targetWarehouseId = warehouseId ?? product.warehouseId ?? null;
  if (!targetWarehouseId) return;

  let balances = await readStockBalances(tx);
  balances = await ensureProductStockSeeded(tx, balances, product, targetWarehouseId);
  const delta = Math.round(nextGlobalStock) - Math.round(product.stockOnHand);
  balances = applyLocationDelta(balances, product.id, targetWarehouseId, delta);
  await saveStockBalances(tx, balances);
}

function getMetaEntityHandler(entity: string) {
  const map = {
    types: {
      create: (payload: MetaPayload) => prisma.productType.create({ data: { name: payload.name } }),
      update: (id: string, payload: MetaPayload) => prisma.productType.update({ where: { id }, data: { name: payload.name } }),
      remove: (id: string) => prisma.productType.delete({ where: { id } })
    },
    categories: {
      create: async (payload: MetaPayload) => {
        if (!payload.typeId) throw new AppError("Choisis un type d'article pour cette categorie.", 400);
        return prisma.productCategory.create({ data: { name: payload.name, typeId: payload.typeId } });
      },
      update: async (id: string, payload: MetaPayload) => {
        if (!payload.typeId) throw new AppError("Choisis un type d'article pour cette categorie.", 400);
        return prisma.productCategory.update({ where: { id }, data: { name: payload.name, typeId: payload.typeId } });
      },
      remove: (id: string) => prisma.productCategory.delete({ where: { id } })
    },
    brands: {
      create: (payload: MetaPayload) => prisma.brand.create({ data: { name: payload.name } }),
      update: (id: string, payload: MetaPayload) => prisma.brand.update({ where: { id }, data: { name: payload.name } }),
      remove: (id: string) => prisma.brand.delete({ where: { id } })
    },
    units: {
      create: (payload: MetaPayload) => prisma.unit.create({ data: { name: payload.name, symbol: payload.symbol ?? payload.name.slice(0, 2).toLowerCase() } }),
      update: (id: string, payload: MetaPayload) => prisma.unit.update({ where: { id }, data: { name: payload.name, symbol: payload.symbol ?? undefined } }),
      remove: (id: string) => prisma.unit.delete({ where: { id } })
    },
    warehouses: {
      create: (payload: MetaPayload) => prisma.warehouse.create({ data: { name: payload.name, code: payload.code ?? payload.name.toUpperCase().replace(/\s+/g, "-"), type: payload.type ?? "STORE" } }),
      update: (id: string, payload: MetaPayload) => prisma.warehouse.update({ where: { id }, data: { name: payload.name, code: payload.code ?? undefined, type: payload.type ?? undefined } }),
      remove: (id: string) => prisma.warehouse.delete({ where: { id } })
    },
    transporters: {
      create: (payload: MetaPayload) => prisma.transporter.create({ data: { name: payload.name } }),
      update: (id: string, payload: MetaPayload) => prisma.transporter.update({ where: { id }, data: { name: payload.name } }),
      remove: (id: string) => prisma.transporter.delete({ where: { id } })
    }
  } as const;

  return map[entity as keyof typeof map] ?? null;
}

async function findOrCreateByName(model: "type" | "category" | "brand" | "unit" | "warehouse", value: string) {
  if (!value) return null;

  if (model === "type") {
    return prisma.productType.upsert({ where: { name: value }, update: {}, create: { name: value } });
  }

  if (model === "category") {
    const existingCategory = await prisma.productCategory.findFirst({ where: { name: value }, include: { type: true } });
    if (existingCategory) return existingCategory;
    return prisma.productCategory.create({ data: { name: value }, include: { type: true } });
  }

  if (model === "brand") {
    return prisma.brand.upsert({ where: { name: value }, update: {}, create: { name: value } });
  }

  if (model === "unit") {
    return prisma.unit.upsert({ where: { name: value }, update: {}, create: { name: value, symbol: value.slice(0, 3).toLowerCase() || "u" } });
  }

  const code = slugify(value);
  return prisma.warehouse.upsert({ where: { name: value }, update: {}, create: { name: value, code, type: "STORE" } });
}

productsRouter.get("/", requirePermissions("products_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const search = String(req.query.search ?? "").trim();
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const products = await prisma.product.findMany({
    where: {
      ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { reference: { contains: search, mode: "insensitive" } },
            { barcode: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
    },
    orderBy: { createdAt: "desc" },
    include: { type: true, category: { include: { type: true } }, brand: true, unit: true, warehouse: true, variants: { select: { id: true, stockOnHand: true } } }
  });

  if (!scopedWarehouseId) {
    const initialBalances = await readStockBalances();
    const initialVariantBalances = await readVariantStockBalances();
    let balances = initialBalances;
    let variantBalances = initialVariantBalances;
    for (const product of products) {
      balances = await ensureProductStockSeeded(prisma, balances, product, product.warehouseId ?? undefined);
      for (const variant of product.variants) {
        variantBalances = await ensureVariantStockSeeded(prisma, variantBalances, { ...variant, product: { warehouseId: product.warehouseId } }, product.warehouseId ?? undefined);
      }
    }
    if (!areStockBalancesEqual(initialBalances, balances)) {
      await saveStockBalances(prisma, balances);
    }
    if (!areVariantStockBalancesEqual(initialVariantBalances, variantBalances)) {
      await saveVariantStockBalances(prisma, variantBalances);
    }

    return ok(res, products.map((product) => ({
      ...product,
      stockOnHand: product.variants.length
        ? getProductStockTotalFromVariantBalances(product.variants.map((variant) => variant.id), variantBalances)
        : getProductStockTotal(balances, product.id)
    })));
  }

  const initialBalances = await readStockBalances();
  const initialVariantBalances = await readVariantStockBalances();
  let balances = initialBalances;
  let variantBalances = initialVariantBalances;
  for (const product of products) {
    balances = await ensureProductStockSeeded(prisma, balances, product, scopedWarehouseId ?? product.warehouseId ?? undefined);
    for (const variant of product.variants) {
      variantBalances = await ensureVariantStockSeeded(prisma, variantBalances, { ...variant, product: { warehouseId: product.warehouseId } }, scopedWarehouseId ?? product.warehouseId ?? undefined);
    }
  }
  if (!areStockBalancesEqual(initialBalances, balances)) {
    await saveStockBalances(prisma, balances);
  }
  if (!areVariantStockBalancesEqual(initialVariantBalances, variantBalances)) {
    await saveVariantStockBalances(prisma, variantBalances);
  }

  return ok(res, products.map((product) => ({
    ...product,
    stockOnHand: product.variants.length
      ? getProductLocationStockFromVariantBalances(product.variants.map((variant) => variant.id), variantBalances, scopedWarehouseId)
      : getLocationStock(balances, product.id, scopedWarehouseId)
  })));
}));

productsRouter.get("/meta", requirePermissions("products_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [types, categories, brands, units, warehouses, transporters, colors, sizes] = await Promise.all([
    prisma.productType.findMany({ orderBy: { name: "asc" } }),
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, include: { type: true } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.unit.findMany({ orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: scopedWarehouseId ? { id: scopedWarehouseId } : undefined, orderBy: { name: "asc" } }),
    prisma.transporter.findMany({ orderBy: { name: "asc" } }),
    prisma.color.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.size.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] })
  ]);
  return ok(res, { types, categories, brands, units, warehouses, transporters, colors, sizes });
}));

productsRouter.get("/:id", requirePermissions("products_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const productId = String(req.params.id);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      type: true,
      category: { include: { type: true } },
      brand: true,
      unit: true,
      warehouse: true,
      variants: true,
      stockMovements: { orderBy: { createdAt: "desc" }, take: 12, include: { warehouse: true } }
    }
  });

  if (!product) throw new AppError("Article introuvable.", 404);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const currentUserWarehouse = await resolveCurrentUserWarehouse(req.currentUser);
  const sessionWarehouseId = scopedWarehouseId ?? currentUserWarehouse?.id ?? null;
  const shouldExposeAllWarehouseBalances = isAdminUser(req.currentUser) && !sessionWarehouseId;
  const [warehouses, boutiqueNameMap] = await Promise.all([
    prisma.warehouse.findMany({ select: { id: true, name: true, type: true } }),
    readBoutiqueNameMap()
  ]);
  const displayWarehouseName = (warehouseId: string, fallback?: string | null) => boutiqueNameMap.get(warehouseId) ?? fallback ?? null;
  const preferredSeedWarehouseId = scopedWarehouseId
    ?? currentUserWarehouse?.id
    ?? (shouldExposeAllWarehouseBalances ? pickCentralWarehouseId(warehouses) : null)
    ?? product.warehouseId
    ?? undefined;
  const variantColorNames = Array.from(new Set(product.variants.map((variant) => variant.color?.trim()).filter((value): value is string => Boolean(value))));
  const colors = variantColorNames.length
    ? await prisma.color.findMany({ where: { name: { in: variantColorNames } }, select: { name: true, reference: true } })
    : [];
  const colorReferenceMap = new Map(colors.map((color) => [color.name.trim().toLowerCase(), color.reference]));
  const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, displayWarehouseName(warehouse.id, warehouse.name)]));
  const scopedWarehouse = sessionWarehouseId
    ? {
        ...(currentUserWarehouse ?? warehouses.find((warehouse) => warehouse.id === sessionWarehouseId) ?? { id: sessionWarehouseId, code: "", type: "" }),
        name: displayWarehouseName(sessionWarehouseId, currentUserWarehouse?.name ?? warehouses.find((warehouse) => warehouse.id === sessionWarehouseId)?.name) ?? "Boutique"
      }
    : null;
  const initialBalances = await readStockBalances();
  const initialVariantBalances = await readVariantStockBalances();
  let balances = initialBalances;
  let variantBalances = initialVariantBalances;
  balances = await ensureProductStockSeeded(prisma, balances, product, preferredSeedWarehouseId);
  for (const variant of product.variants) {
    variantBalances = await ensureVariantStockSeeded(prisma, variantBalances, { ...variant, product: { warehouseId: product.warehouseId } }, preferredSeedWarehouseId);
  }
  if (!areStockBalancesEqual(initialBalances, balances)) {
    await saveStockBalances(prisma, balances);
  }
  if (!areVariantStockBalancesEqual(initialVariantBalances, variantBalances)) {
    await saveVariantStockBalances(prisma, variantBalances);
  }
  const variantIds = product.variants.map((variant) => variant.id);
  const scopedStock = variantIds.length
    ? sessionWarehouseId
      ? getProductLocationStockFromVariantBalances(variantIds, variantBalances, sessionWarehouseId)
      : getProductStockTotalFromVariantBalances(variantIds, variantBalances)
    : sessionWarehouseId
      ? getLocationStock(balances, product.id, sessionWarehouseId)
      : getProductStockTotal(balances, product.id);

  return ok(res, {
    ...product,
    scopedWarehouse,
    stockOnHand: scopedStock,
    stockMovements: sessionWarehouseId
      ? product.stockMovements.filter((movement) => movement.warehouse?.id === sessionWarehouseId)
      : product.stockMovements,
    locationBalances: (variantIds.length
      ? warehouses.map((warehouse) => ({
          warehouseId: warehouse.id,
          warehouseName: warehouseMap.get(warehouse.id) ?? null,
          quantity: getProductLocationStockFromVariantBalances(variantIds, variantBalances, warehouse.id)
        }))
      : balances
          .filter((entry) => entry.productId === product.id)
          .map((entry) => ({
            warehouseId: entry.warehouseId,
            warehouseName: warehouseMap.get(entry.warehouseId) ?? null,
            quantity: entry.quantity
          })))
      .filter((entry) => sessionWarehouseId ? entry.warehouseId === sessionWarehouseId : shouldExposeAllWarehouseBalances || entry.quantity > 0),
    variants: product.variants.map((variant) => ({
      ...variant,
      colorReference: variant.color ? (colorReferenceMap.get(variant.color.trim().toLowerCase()) ?? null) : null,
      stockOnHand: getProductStockTotalFromVariantBalances([variant.id], variantBalances),
      locationBalances: warehouses
        .map((warehouse) => ({
          warehouseId: warehouse.id,
          warehouseName: warehouseMap.get(warehouse.id) ?? null,
          quantity: getVariantLocationStock(variantBalances, variant.id, warehouse.id)
        }))
        .filter((entry) => sessionWarehouseId ? entry.warehouseId === sessionWarehouseId : shouldExposeAllWarehouseBalances || entry.quantity > 0)
    }))
  });
}));

productsRouter.post("/import", requirePermissions("products_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertProductWriteAccess(req);
  const payload = importSchema.parse(req.body);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const errors: Array<{ row: number; message: string }> = [];
  let created = 0;
  let updated = 0;

  for (const [index, rawRow] of payload.rows.entries()) {
    try {
      const reference = pickValue(rawRow, ["reference", "sku", "ref", "code"]);
      const name = pickValue(rawRow, ["name", "nom", "article", "produit", "designation", "productname", "libelle", "libellé", "label"]);
      if (!reference || !name) throw new Error("Reference et nom obligatoires.");

      const type = await findOrCreateByName("type", pickValue(rawRow, ["type", "producttype"]));
      let category = (await findOrCreateByName("category", pickValue(rawRow, ["category", "categorie", "productcategory"]))) as { id: string; typeId?: string | null } | null;
      if (category && type && !category.typeId) {
        category = await prisma.productCategory.update({ where: { id: category.id }, data: { typeId: type.id }, include: { type: true } });
      }
      const brand = await findOrCreateByName("brand", pickValue(rawRow, ["brand", "marque"]));
      const unit = await findOrCreateByName("unit", pickValue(rawRow, ["unit", "unite"]));
      const warehouse = scopedWarehouseId
        ? await prisma.warehouse.findUnique({ where: { id: scopedWarehouseId } })
        : await findOrCreateByName("warehouse", pickValue(rawRow, ["warehouse", "depot", "magasin", "store"]));
      const barcode = pickValue(rawRow, ["barcode", "codebarres", "ean"]);
      const statusValue = pickValue(rawRow, ["status", "statut"]).toUpperCase();
      const status = statusValue === "INACTIVE" || statusValue === "INACTIF" ? "INACTIVE" : "ACTIVE";

      const baseData: Partial<ProductPayload> = {
        reference,
        name,
        barcode: barcode || null,
        description: pickValue(rawRow, ["description", "notes"]) || null,
        imageUrl: pickValue(rawRow, ["imageurl", "image", "photo"]) || null,
        dimensions: pickValue(rawRow, ["dimensions", "dimension", "taille", "size"]) || null,
        weight: pickValue(rawRow, ["weight", "poid", "poids"]) || null,
        typeId: type?.id ?? null,
        categoryId: category?.id ?? null,
        brandId: brand?.id ?? null,
        unitId: unit?.id ?? null,
        warehouseId: warehouse?.id ?? null,
        purchasePriceHt: toNumber(pickValue(rawRow, ["purchasepriceht", "achatht", "prixachatht"])),
        purchasePriceTtc: toNumber(pickValue(rawRow, ["purchasepricettc", "achatttc", "prixachatttc"])),
        salePriceHt: toNumber(pickValue(rawRow, ["salepriceht", "venteht", "prixventeht"])),
        salePriceTtc: toNumber(pickValue(rawRow, ["salepricettc", "ventettc", "prixventettc", "prix", "price", "prixvente", "pvttc"])),
        promoPriceHt: toNumber(pickValue(rawRow, ["promopriceht", "prixpromoht", "prixpromotionht"]), 0) || null,
        promoPriceTtc: toNumber(pickValue(rawRow, ["promopricettc", "prixpromottc", "prixpromotionttc", "prixpromo"]), 0) || null,
        promoPriceActive: toBoolean(rawRow.promo ?? rawRow.PROMO ?? pickValue(rawRow, ["promo", "prixpromoactif", "promotion"]), false),
        taxRate: toNumber(pickValue(rawRow, ["taxrate", "tva", "tax"]), 20),
        stockOnHand: toInt(pickValue(rawRow, ["stockonhand", "stock", "qte"])),
        minStock: toInt(pickValue(rawRow, ["minstock", "stockmini", "stockminimum"])),
        isTaxExempt: toBoolean(rawRow.detaxable ?? rawRow.DETAXABLE ?? pickValue(rawRow, ["detaxable", "isdetaxable"])),
        isCommissioned: toBoolean(rawRow.commission ?? rawRow.COMMISSION ?? pickValue(rawRow, ["commission", "iscommissioned"])),
        status,
        variants: []
      };

      const data = await normalizeProductPayload(baseData);
      const existing = await prisma.product.findUnique({ where: { reference } });
      if (existing) {
        await prisma.$transaction(async (tx) => {
          await tx.product.update({ where: { reference }, data: toProductUpdateData(data) });
          await syncProductLocationBalance(tx, existing, Math.round(Number(data.stockOnHand ?? existing.stockOnHand)), data.warehouseId ?? existing.warehouseId);
        });
        updated += 1;
      } else {
        await prisma.$transaction(async (tx) => {
          const created = await tx.product.create({ data: toProductCreateData(data as Omit<ProductPayload, "variants">) });
          await syncProductLocationBalance(tx, { id: created.id, stockOnHand: 0, warehouseId: created.warehouseId }, Math.round(Number(data.stockOnHand ?? 0)), created.warehouseId);
        });
        created += 1;
      }
    } catch (error) {
      errors.push({ row: index + 2, message: error instanceof Error ? error.message : "Ligne invalide." });
    }
  }

  await writeAuditLog({ userId: req.currentUser?.id, action: "products.import", entityType: "product", meta: { created, updated, errorsCount: errors.length } });
  return ok(res, { created, updated, errors }, "Import CSV termine.");
}));

productsRouter.post("/", requirePermissions("products_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertProductWriteAccess(req);
  const payload = productSchema.parse(req.body);
  if (payload.warehouseId) ensureWarehouseAccess(req.currentUser, payload.warehouseId);
  const { variants, ...basePayload } = payload;
  const normalizedVariants = normalizeVariantPayload(variants ?? []);
  const data = await normalizeProductPayload({
    ...basePayload,
    stockOnHand: normalizedVariants.length ? normalizedVariants.reduce((sum, item) => sum + item.stockOnHand, 0) : basePayload.stockOnHand,
    variants
  });
  if (!String(data.barcode ?? "").trim()) throw new AppError("Code-barres article obligatoire.", 400);

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data: toProductCreateData(data as Omit<ProductPayload, "variants">) });
    if (normalizedVariants.length) {
      await tx.productVariant.createMany({ data: normalizedVariants.map((variant) => ({ ...variant, productId: created.id })) });
      await tx.product.update({ where: { id: created.id }, data: { stockOnHand: normalizedVariants.reduce((sum, item) => sum + item.stockOnHand, 0) } });
    }
    await syncProductLocationBalance(
      tx,
      { id: created.id, stockOnHand: 0, warehouseId: created.warehouseId },
      normalizedVariants.length ? normalizedVariants.reduce((sum, item) => sum + item.stockOnHand, 0) : Number(data.stockOnHand ?? 0),
      created.warehouseId
    );
    const fullProduct = await tx.product.findUniqueOrThrow({ where: { id: created.id }, include: { variants: true } });
    if (fullProduct.variants.length) {
      await syncVariantBalancesForProduct(tx, fullProduct.variants.map((variant) => ({ id: variant.id, stockOnHand: variant.stockOnHand })), fullProduct.warehouseId);
      const variantBalances = await readVariantStockBalances(tx);
      for (const variant of fullProduct.variants) {
        await syncVariantGlobalStock(tx, variantBalances, variant.id);
      }
    }
    return fullProduct;
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "products.create", entityType: "product", entityId: product.id, meta: data });
  return ok(res, product, "Article cree.");
}));

productsRouter.put("/:id", requirePermissions("products_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertProductWriteAccess(req);
  const payload = productSchema.partial().parse(req.body);
  const productId = String(req.params.id);
  const existingProduct = await prisma.product.findUnique({ where: { id: productId }, include: { variants: true } });
  if (!existingProduct) throw new AppError("Article introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, existingProduct.warehouseId);
  if (payload.warehouseId) ensureWarehouseAccess(req.currentUser, payload.warehouseId);
  const { variants, ...basePayload } = payload;
  const normalizedVariants = variants ? normalizeVariantPayload(variants) : null;
  const data = await normalizeProductPayload({
    ...basePayload,
    ...(normalizedVariants ? { stockOnHand: normalizedVariants.reduce((sum, item) => sum + item.stockOnHand, 0) } : {})
  });
  if ("barcode" in payload && !String(payload.barcode ?? "").trim()) throw new AppError("Code-barres article obligatoire.", 400);

  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id: productId }, data: toProductUpdateData(data) });
    if (normalizedVariants) {
      await tx.productVariant.deleteMany({ where: { productId } });
      if (normalizedVariants.length) {
        await tx.productVariant.createMany({ data: normalizedVariants.map((variant) => ({ ...variant, productId })) });
      }
      await tx.product.update({ where: { id: productId }, data: { stockOnHand: normalizedVariants.reduce((sum, item) => sum + item.stockOnHand, 0) } });
    }
    await syncProductLocationBalance(
      tx,
      existingProduct,
      normalizedVariants ? normalizedVariants.reduce((sum, item) => sum + item.stockOnHand, 0) : Number(data.stockOnHand ?? existingProduct.stockOnHand),
      data.warehouseId ?? updated.warehouseId ?? existingProduct.warehouseId
    );
    const fullProduct = await tx.product.findUniqueOrThrow({ where: { id: updated.id }, include: { variants: true } });
    if (normalizedVariants) {
      let variantBalances = await readVariantStockBalances(tx);
      const previousVariantIds = new Set(existingProduct.variants.map((variant) => variant.id));
      variantBalances = variantBalances.filter((entry) => !previousVariantIds.has(entry.variantId));
      await saveVariantStockBalances(tx, variantBalances);
      if (fullProduct.variants.length) {
        await syncVariantBalancesForProduct(tx, fullProduct.variants.map((variant) => ({ id: variant.id, stockOnHand: variant.stockOnHand })), data.warehouseId ?? updated.warehouseId ?? existingProduct.warehouseId);
        variantBalances = await readVariantStockBalances(tx);
        for (const variant of fullProduct.variants) {
          await syncVariantGlobalStock(tx, variantBalances, variant.id);
        }
      }
    }
    return fullProduct;
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "products.update", entityType: "product", entityId: product.id, meta: data });
  return ok(res, product, "Article mis a jour.");
}));

productsRouter.delete("/:id", requirePermissions("products_manage"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertProductWriteAccess(req);
  const productId = String(req.params.id);
  const existingProduct = await prisma.product.findUnique({ where: { id: productId }, select: { warehouseId: true } });
  if (!existingProduct) throw new AppError("Article introuvable.", 404);
  ensureWarehouseAccess(req.currentUser, existingProduct.warehouseId);
  await prisma.$transaction(async (tx) => {
    const balances = await readStockBalances(tx);
    await saveStockBalances(tx, balances.filter((entry) => entry.productId !== productId));
    const variantBalances = await readVariantStockBalances(tx);
    const productVariants = await tx.productVariant.findMany({ where: { productId }, select: { id: true } });
    const variantIds = new Set(productVariants.map((variant) => variant.id));
    await saveVariantStockBalances(tx, variantBalances.filter((entry) => !variantIds.has(entry.variantId)));
    await tx.product.delete({ where: { id: productId } });
  });
  await writeAuditLog({ userId: req.currentUser?.id, action: "products.delete", entityType: "product", entityId: productId });
  return ok(res, true, "Article supprime.");
}));

productsRouter.post("/meta/:entity", requirePermissions("settings_manage"), asyncHandler(async (req, res) => {
  const payload = metaEntitySchema.parse(req.body);
  const entity = String(req.params.entity);
  const handler = getMetaEntityHandler(entity);
  if (!handler) throw new AppError("Meta inconnu.", 404);
  return ok(res, await handler.create(payload), "Element cree.");
}));

productsRouter.put("/meta/:entity/:id", requirePermissions("settings_manage"), asyncHandler(async (req, res) => {
  const payload = metaEntitySchema.parse(req.body);
  const entity = String(req.params.entity);
  const id = String(req.params.id);
  const handler = getMetaEntityHandler(entity);
  if (!handler) throw new AppError("Meta inconnu.", 404);
  return ok(res, await handler.update(id, payload), "Element mis a jour.");
}));

productsRouter.delete("/meta/:entity/:id", requirePermissions("settings_manage"), asyncHandler(async (req, res) => {
  const entity = String(req.params.entity);
  const id = String(req.params.id);
  const handler = getMetaEntityHandler(entity);
  if (!handler) throw new AppError("Meta inconnu.", 404);
  await handler.remove(id);
  return ok(res, true, "Element supprime.");
}));






