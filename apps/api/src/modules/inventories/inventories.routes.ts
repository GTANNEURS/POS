import { Prisma, type Inventory, type InventoryItem } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { authenticate, ensureWarehouseAccess, getScopedWarehouseId, isAdminUser, type AuthenticatedRequest } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import {
  applyLocationDelta,
  applyVariantLocationDelta,
  ensureProductStockSeeded,
  ensureVariantStockSeeded,
  getLocationStock,
  getProductLocationStockFromVariantBalances,
  getProductStockTotalFromVariantBalances,
  getVariantLocationStock,
  readStockBalances,
  readVariantStockBalances,
  saveStockBalances,
  saveVariantStockBalances,
  syncProductGlobalStock,
  syncVariantGlobalStock
} from "../../common/stock-balances.js";
import { prisma } from "../../config/prisma.js";

const inventoryMethodValues = ["COMPLETE", "CATEGORY", "REFERENCE", "TYPE", "LOCATION", "PARTIAL", "CYCLE"] as const;
const inventoryStatusValues = ["DRAFT", "IN_PROGRESS", "PENDING_VALIDATION", "VALIDATED", "CANCELLED"] as const;
const inventoryItemStatusValues = ["PENDING", "COUNTED", "MATCHED", "EXCESS", "SHORTAGE"] as const;

const createInventorySchema = z.object({
  title: z.string().min(3),
  type: z.enum(inventoryMethodValues),
  scope: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  allowCashierCounting: z.coerce.boolean().default(false),
  filters: z.object({
    search: z.string().trim().optional().nullable(),
    categoryId: z.string().trim().optional().nullable(),
    typeId: z.string().trim().optional().nullable(),
    brandId: z.string().trim().optional().nullable(),
    color: z.string().trim().optional().nullable(),
    size: z.string().trim().optional().nullable(),
    warehouseId: z.string().trim().optional().nullable(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional().nullable()
  }).default({})
});

const listInventoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(12),
  search: z.string().trim().optional(),
  status: z.enum(inventoryStatusValues).optional(),
  type: z.enum(inventoryMethodValues).optional()
});

const listInventoryItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  type: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
  warehouseId: z.string().trim().optional(),
  status: z.enum(inventoryItemStatusValues).optional(),
  withDifferenceOnly: z.coerce.boolean().default(false)
});

const updateInventorySchema = z.object({
  title: z.string().trim().min(3).optional(),
  notes: z.string().trim().nullable().optional(),
  scope: z.string().trim().nullable().optional(),
  allowCashierCounting: z.coerce.boolean().optional()
});

const updateInventoryItemSchema = z.object({
  countedQty: z.coerce.number().int().nullable().optional(),
  notes: z.string().trim().nullable().optional()
});

const validateInventorySchema = z.object({
  confirmation: z.literal(true),
  notes: z.string().trim().optional().nullable()
});

type BuildInventoryFilters = z.infer<typeof createInventorySchema>["filters"];
type ProductForInventory = Awaited<ReturnType<typeof loadProductsForInventory>>[number];

export const inventoriesRouter = Router();
inventoriesRouter.use(authenticate);

function getRequestIp(req: AuthenticatedRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) {
    return String(forwarded[0] ?? "").trim() || null;
  }
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return req.ip || req.socket.remoteAddress || null;
}

function readRouteParam(value: string | string[] | undefined, label: string) {
  const normalized = String(Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
  if (!normalized) {
    throw new AppError(`${label} obligatoire.`, 400);
  }
  return normalized;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hasInventoryManageAccess(req: AuthenticatedRequest) {
  return req.currentUser?.permissions.includes("inventory_manage") ?? false;
}

function canValidateInventory(req: AuthenticatedRequest) {
  return req.currentUser?.roles.some((role) => role === "admin" || role === "manager") ?? false;
}

function assertInventoryManager(req: AuthenticatedRequest) {
  if (!hasInventoryManageAccess(req)) {
    throw new AppError("Acces reserve aux admins et managers.", 403);
  }
}

function isInventoryEditable(status: string) {
  return ["DRAFT", "IN_PROGRESS", "PENDING_VALIDATION"].includes(status);
}

function buildItemStatus(theoreticalQty: number, countedQty: number | null | undefined) {
  if (countedQty == null) {
    return {
      status: "PENDING" as const,
      differenceQty: 0,
      differenceValue: 0
    };
  }

  const differenceQty = countedQty - theoreticalQty;
  if (differenceQty === 0) {
    return {
      status: "MATCHED" as const,
      differenceQty,
      differenceValue: 0
    };
  }

  return {
    status: differenceQty > 0 ? ("EXCESS" as const) : ("SHORTAGE" as const),
    differenceQty,
    differenceValue: differenceQty
  };
}

async function nextInventoryReference() {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const latest = await prisma.inventory.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true }
  });

  const lastNumber = latest?.reference.split("-").pop();
  const nextNumber = Number(lastNumber ?? "0") + 1;
  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
}

async function createInventoryLog(input: {
  inventoryId: string;
  inventoryItemId?: string | null;
  userId?: string | null;
  action: string;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
}) {
  return prisma.inventoryLog.create({
    data: {
      inventoryId: input.inventoryId,
      inventoryItemId: input.inventoryItemId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      oldValue: input.oldValue ?? Prisma.JsonNull,
      newValue: input.newValue ?? Prisma.JsonNull,
      ipAddress: input.ipAddress ?? null
    }
  });
}

async function getAccessibleWarehouses(req: AuthenticatedRequest, requestedWarehouseId?: string | null) {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (scopedWarehouseId) {
    if (requestedWarehouseId) {
      ensureWarehouseAccess(req.currentUser, requestedWarehouseId);
    }
    return prisma.warehouse.findMany({
      where: { id: scopedWarehouseId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, type: true }
    });
  }

  return prisma.warehouse.findMany({
    where: requestedWarehouseId ? { id: requestedWarehouseId } : undefined,
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, type: true }
  });
}

async function loadProductsForInventory(filters: BuildInventoryFilters, req: AuthenticatedRequest) {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (filters.warehouseId) {
    ensureWarehouseAccess(req.currentUser, filters.warehouseId);
  }

  return prisma.product.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : { status: "ACTIVE" }),
      ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.typeId ? { typeId: filters.typeId } : {}),
      ...(filters.brandId ? { brandId: filters.brandId } : {}),
      ...(filters.search ? {
        OR: [
          { reference: { contains: filters.search, mode: "insensitive" } },
          { barcode: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: filters.search, mode: "insensitive" } },
          {
            variants: {
              some: {
                OR: [
                  { reference: { contains: filters.search, mode: "insensitive" } },
                  { barcode: { contains: filters.search, mode: "insensitive" } },
                  { label: { contains: filters.search, mode: "insensitive" } }
                ]
              }
            }
          }
        ]
      } : {})
    },
    orderBy: [{ name: "asc" }, { reference: "asc" }],
    include: {
      type: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true, code: true, type: true } },
      variants: {
        orderBy: [{ color: "asc" }, { size: "asc" }, { reference: "asc" }],
        select: {
          id: true,
          label: true,
          size: true,
          color: true,
          reference: true,
          barcode: true,
          stockOnHand: true
        }
      }
    }
  });
}

async function seedBalancesForProducts(products: ProductForInventory[], scopedWarehouseId?: string | null) {
  const initialBalances = await readStockBalances();
  const initialVariantBalances = await readVariantStockBalances();
  let balances = initialBalances;
  let variantBalances = initialVariantBalances;

  for (const product of products) {
    balances = await ensureProductStockSeeded(prisma, balances, product, scopedWarehouseId ?? product.warehouseId ?? undefined);
    for (const variant of product.variants) {
      variantBalances = await ensureVariantStockSeeded(
        prisma,
        variantBalances,
        { ...variant, product: { warehouseId: product.warehouseId } },
        scopedWarehouseId ?? product.warehouseId ?? undefined
      );
    }
  }

  if (JSON.stringify(initialBalances) !== JSON.stringify(balances)) {
    await saveStockBalances(prisma, balances);
  }
  if (JSON.stringify(initialVariantBalances) !== JSON.stringify(variantBalances)) {
    await saveVariantStockBalances(prisma, variantBalances);
  }

  return { balances, variantBalances };
}

function buildScopeLabel(input: { type: string; filters: BuildInventoryFilters; warehouses: Array<{ name: string }> }) {
  if (input.type === "COMPLETE") return "Inventaire complet";
  if (input.type === "CATEGORY") return input.filters.categoryId ? `Categorie ciblee` : "Inventaire par categorie";
  if (input.type === "REFERENCE") return input.filters.search ? `Reference / recherche : ${input.filters.search}` : "Inventaire par reference";
  if (input.type === "TYPE") return input.filters.typeId ? "Type cible" : "Inventaire par type";
  if (input.type === "LOCATION") return input.warehouses.length === 1 ? input.warehouses[0]!.name : "Inventaire par emplacement";
  if (input.type === "PARTIAL") return "Inventaire partiel";
  return "Inventaire tournant";
}

function shouldKeepVariant(filters: BuildInventoryFilters, product: ProductForInventory, variant: ProductForInventory["variants"][number]) {
  if (filters.color && normalizeText(variant.color) !== normalizeText(filters.color)) return false;
  if (filters.size && normalizeText(variant.size) !== normalizeText(filters.size)) return false;
  if (!filters.search) return true;
  const haystack = [
    product.reference,
    product.barcode,
    product.name,
    variant.reference,
    variant.barcode,
    variant.label,
    variant.color,
    variant.size
  ].map(normalizeText);
  const needle = normalizeText(filters.search);
  return haystack.some((entry) => entry.includes(needle));
}

function shouldKeepSimpleProduct(filters: BuildInventoryFilters, product: ProductForInventory) {
  if (filters.color || filters.size) return false;
  if (!filters.search) return true;
  const haystack = [product.reference, product.barcode, product.name].map(normalizeText);
  const needle = normalizeText(filters.search);
  return haystack.some((entry) => entry.includes(needle));
}

function summarizeInventoryItems(items: Array<Pick<InventoryItem, "theoreticalQty" | "countedQty" | "differenceQty" | "differenceValue" | "status" | "category" | "type" | "location">>) {
  const totalArticles = items.length;
  const theoreticalTotal = items.reduce((sum, item) => sum + item.theoreticalQty, 0);
  const countedTotal = items.reduce((sum, item) => sum + (item.countedQty ?? 0), 0);
  const positiveDifferences = items.filter((item) => item.differenceQty > 0);
  const negativeDifferences = items.filter((item) => item.differenceQty < 0);
  const matchingItems = items.filter((item) => item.status === "MATCHED").length;
  const differenceValueTotal = round2(items.reduce((sum, item) => sum + Number(item.differenceValue ?? 0), 0));

  const byCategory = new Map<string, { label: string; theoreticalQty: number; countedQty: number; differenceQty: number; differenceValue: number; itemsCount: number }>();
  const byType = new Map<string, { label: string; theoreticalQty: number; countedQty: number; differenceQty: number; differenceValue: number; itemsCount: number }>();
  const byLocation = new Map<string, { label: string; theoreticalQty: number; countedQty: number; differenceQty: number; differenceValue: number; itemsCount: number }>();

  for (const item of items) {
    const countedQty = item.countedQty ?? 0;
    const differenceValue = Number(item.differenceValue ?? 0);
    const groups = [
      [byCategory, item.category || "Sans categorie"],
      [byType, item.type || "Sans type"],
      [byLocation, item.location || "Sans emplacement"]
    ] as const;

    for (const [map, label] of groups) {
      const current = map.get(label) ?? {
        label,
        theoreticalQty: 0,
        countedQty: 0,
        differenceQty: 0,
        differenceValue: 0,
        itemsCount: 0
      };
      current.theoreticalQty += item.theoreticalQty;
      current.countedQty += countedQty;
      current.differenceQty += item.differenceQty;
      current.differenceValue = round2(current.differenceValue + differenceValue);
      current.itemsCount += 1;
      map.set(label, current);
    }
  }

  return {
    totalArticles,
    theoreticalTotal,
    countedTotal,
    positiveDifferenceQty: positiveDifferences.reduce((sum, item) => sum + item.differenceQty, 0),
    negativeDifferenceQty: negativeDifferences.reduce((sum, item) => sum + item.differenceQty, 0),
    positiveDifferencesCount: positiveDifferences.length,
    negativeDifferencesCount: negativeDifferences.length,
    differenceValueTotal,
    matchingItems,
    byCategory: Array.from(byCategory.values()).sort((left, right) => left.label.localeCompare(right.label, "fr")),
    byType: Array.from(byType.values()).sort((left, right) => left.label.localeCompare(right.label, "fr")),
    byLocation: Array.from(byLocation.values()).sort((left, right) => left.label.localeCompare(right.label, "fr"))
  };
}

function buildVisibleInventoryWhere(req: AuthenticatedRequest): Prisma.InventoryWhereInput {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (hasInventoryManageAccess(req)) {
    if (!scopedWarehouseId) return {};
    return { items: { some: { warehouseId: scopedWarehouseId } } };
  }

  if (!scopedWarehouseId) {
    return { id: "__never__" };
  }

  return {
    allowCashierCounting: true,
    status: { in: ["DRAFT", "IN_PROGRESS", "PENDING_VALIDATION"] },
    items: { some: { warehouseId: scopedWarehouseId } }
  };
}

async function loadInventoryOrThrow(req: AuthenticatedRequest, inventoryId: string) {
  const inventory = await prisma.inventory.findFirst({
    where: {
      id: inventoryId,
      ...buildVisibleInventoryWhere(req)
    },
    include: {
      createdBy: { select: { id: true, fullName: true } },
      validatedBy: { select: { id: true, fullName: true } }
    }
  });

  if (!inventory) {
    throw new AppError("Inventaire introuvable.", 404);
  }

  return inventory;
}

inventoriesRouter.get("/bootstrap", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [categories, types, brands, warehouses] = await Promise.all([
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productType.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getAccessibleWarehouses(req)
  ]);
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE", ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      reference: true,
      barcode: true,
      name: true,
      category: { select: { id: true, name: true } },
      type: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      variants: { select: { color: true, size: true } }
    },
    take: 250
  });

  const colors = Array.from(new Set(products.flatMap((product) => product.variants.map((variant) => variant.color?.trim()).filter(Boolean)))).sort((a, b) => a!.localeCompare(b!, "fr"));
  const sizes = Array.from(new Set(products.flatMap((product) => product.variants.map((variant) => variant.size?.trim()).filter(Boolean)))).sort((a, b) => a!.localeCompare(b!, "fr"));

  return ok(res, {
    canManage: hasInventoryManageAccess(req),
    canValidate: canValidateInventory(req),
    methods: inventoryMethodValues,
    statuses: inventoryStatusValues,
    itemStatuses: inventoryItemStatusValues,
    filters: {
      categories,
      types,
      brands,
      colors,
      sizes,
      warehouses
    }
  });
}));

inventoriesRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = listInventoriesQuerySchema.parse(req.query ?? {});
  const where: Prisma.InventoryWhereInput = {
    ...buildVisibleInventoryWhere(req),
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.search ? {
      OR: [
        { reference: { contains: query.search, mode: "insensitive" } },
        { title: { contains: query.search, mode: "insensitive" } },
        { scope: { contains: query.search, mode: "insensitive" } }
      ]
    } : {})
  };

  const [total, inventories] = await Promise.all([
    prisma.inventory.count({ where }),
    prisma.inventory.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: {
        createdBy: { select: { id: true, fullName: true } },
        validatedBy: { select: { id: true, fullName: true } },
        items: {
          select: {
            theoreticalQty: true,
            countedQty: true,
            differenceQty: true,
            differenceValue: true,
            status: true,
            category: true,
            type: true,
            location: true
          }
        },
        _count: { select: { logs: true, items: true } }
      }
    })
  ]);

  const rows = inventories.map((inventory) => ({
    ...inventory,
    summary: summarizeInventoryItems(inventory.items),
    items: undefined
  }));

  return ok(res, {
    page: query.page,
    perPage: query.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
    rows
  });
}));

inventoriesRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertInventoryManager(req);
  const payload = createInventorySchema.parse(req.body ?? {});
  const warehouses = await getAccessibleWarehouses(req, payload.filters.warehouseId ?? null);
  if (!warehouses.length) {
    throw new AppError("Aucun emplacement disponible pour cet inventaire.", 400);
  }

  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const products = await loadProductsForInventory(payload.filters, req);
  if (!products.length) {
    throw new AppError("Aucun article ne correspond aux filtres de cet inventaire.", 400);
  }

  const { balances, variantBalances } = await seedBalancesForProducts(products, scopedWarehouseId);
  const itemsData: Prisma.InventoryItemCreateManyInventoryInput[] = [];

  for (const product of products) {
    if (product.variants.length) {
      for (const variant of product.variants.filter((entry) => shouldKeepVariant(payload.filters, product, entry))) {
        for (const warehouse of warehouses) {
          const theoreticalQty = getProductLocationStockFromVariantBalances([variant.id], variantBalances, warehouse.id);
          itemsData.push({
            productId: product.id,
            productVariantId: variant.id,
            warehouseId: warehouse.id,
            productReference: variant.reference || product.reference,
            barcode: variant.barcode || product.barcode,
            productName: variant.label?.trim() ? `${product.name} - ${variant.label}` : product.name,
            category: product.category?.name ?? null,
            type: product.type?.name ?? null,
            brand: product.brand?.name ?? null,
            color: variant.color ?? null,
            size: variant.size ?? null,
            location: warehouse.name,
            theoreticalQty,
            countedQty: null,
            differenceQty: 0,
            unitCost: Number(product.purchasePriceTtc),
            differenceValue: 0,
            status: "PENDING",
            notes: null
          });
        }
      }
      continue;
    }

    if (!shouldKeepSimpleProduct(payload.filters, product)) continue;
    for (const warehouse of warehouses) {
      const theoreticalQty = getLocationStock(balances, product.id, warehouse.id);
      itemsData.push({
        productId: product.id,
        warehouseId: warehouse.id,
        productReference: product.reference,
        barcode: product.barcode,
        productName: product.name,
        category: product.category?.name ?? null,
        type: product.type?.name ?? null,
        brand: product.brand?.name ?? null,
        color: null,
        size: null,
        location: warehouse.name,
        theoreticalQty,
        countedQty: null,
        differenceQty: 0,
        unitCost: Number(product.purchasePriceTtc),
        differenceValue: 0,
        status: "PENDING",
        notes: null
      });
    }
  }

  if (!itemsData.length) {
    throw new AppError("Aucune ligne d'inventaire n'a pu etre preparee.", 400);
  }

  const reference = await nextInventoryReference();
  const scope = payload.scope?.trim() || buildScopeLabel({ type: payload.type, filters: payload.filters, warehouses });
  const created = await prisma.inventory.create({
    data: {
      reference,
      title: payload.title.trim(),
      type: payload.type,
      status: "DRAFT",
      scope,
      filterSnapshot: payload.filters as Prisma.InputJsonValue,
      notes: payload.notes?.trim() || null,
      allowCashierCounting: payload.allowCashierCounting,
      createdById: req.currentUser?.id ?? null,
      items: {
        createMany: {
          data: itemsData
        }
      }
    },
    include: {
      createdBy: { select: { id: true, fullName: true } }
    }
  });

  await createInventoryLog({
    inventoryId: created.id,
    userId: req.currentUser?.id ?? null,
    action: "inventory.created",
    newValue: {
      reference: created.reference,
      title: created.title,
      type: created.type,
      scope: created.scope,
      lines: itemsData.length
    },
    ipAddress: getRequestIp(req)
  });
  await writeAuditLog({
    userId: req.currentUser?.id ?? null,
    action: "inventory.created",
    entityType: "inventory",
    entityId: created.id,
    meta: {
      reference: created.reference,
      lines: itemsData.length,
      type: created.type
    }
  });

  return ok(res, created, "Inventaire cree.");
}));

inventoriesRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  const [items, logs] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { inventoryId: inventory.id },
      orderBy: [{ productReference: "asc" }, { productName: "asc" }],
      select: {
        id: true,
        theoreticalQty: true,
        countedQty: true,
        differenceQty: true,
        differenceValue: true,
        status: true,
        category: true,
        type: true,
        location: true
      }
    }),
    prisma.inventoryLog.findMany({
      where: { inventoryId: inventory.id },
      orderBy: [{ createdAt: "desc" }],
      take: 80,
      include: {
        user: { select: { id: true, fullName: true, email: true } }
      }
    })
  ]);

  return ok(res, {
    ...inventory,
    summary: summarizeInventoryItems(items),
    logs
  });
}));

inventoriesRouter.get("/:id/items", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  const query = listInventoryItemsQuerySchema.parse(req.query ?? {});

  const where: Prisma.InventoryItemWhereInput = {
    inventoryId: inventory.id,
    ...(query.search ? {
      OR: [
        { productReference: { contains: query.search, mode: "insensitive" } },
        { barcode: { contains: query.search, mode: "insensitive" } },
        { productName: { contains: query.search, mode: "insensitive" } }
      ]
    } : {}),
    ...(query.category ? { category: { equals: query.category, mode: "insensitive" } } : {}),
    ...(query.type ? { type: { equals: query.type, mode: "insensitive" } } : {}),
    ...(query.brand ? { brand: { equals: query.brand, mode: "insensitive" } } : {}),
    ...(query.color ? { color: { equals: query.color, mode: "insensitive" } } : {}),
    ...(query.size ? { size: { equals: query.size, mode: "insensitive" } } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.withDifferenceOnly ? { differenceQty: { not: 0 } } : {})
  };

  const [total, items, summaryBase] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.findMany({
      where,
      orderBy: [{ productReference: "asc" }, { productName: "asc" }, { location: "asc" }],
      skip: (query.page - 1) * query.perPage,
      take: query.perPage
    }),
    prisma.inventoryItem.findMany({
      where: { inventoryId: inventory.id },
      select: {
        theoreticalQty: true,
        countedQty: true,
        differenceQty: true,
        differenceValue: true,
        status: true,
        category: true,
        type: true,
        location: true
      }
    })
  ]);

  return ok(res, {
    inventory: {
      id: inventory.id,
      reference: inventory.reference,
      title: inventory.title,
      status: inventory.status,
      type: inventory.type,
      allowCashierCounting: inventory.allowCashierCounting
    },
    page: query.page,
    perPage: query.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
    summary: summarizeInventoryItems(summaryBase),
    rows: items
  });
}));

inventoriesRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertInventoryManager(req);
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  if (!isInventoryEditable(inventory.status)) {
    throw new AppError("Cet inventaire est verrouille.", 400);
  }

  const payload = updateInventorySchema.parse(req.body ?? {});
  const updated = await prisma.inventory.update({
    where: { id: inventory.id },
    data: {
      title: payload.title?.trim() || undefined,
      notes: payload.notes === undefined ? undefined : payload.notes?.trim() || null,
      scope: payload.scope === undefined ? undefined : payload.scope?.trim() || null,
      allowCashierCounting: payload.allowCashierCounting ?? undefined
    }
  });

  await createInventoryLog({
    inventoryId: inventory.id,
    userId: req.currentUser?.id ?? null,
    action: "inventory.updated",
    oldValue: {
      title: inventory.title,
      notes: inventory.notes,
      scope: inventory.scope,
      allowCashierCounting: inventory.allowCashierCounting
    },
    newValue: {
      title: updated.title,
      notes: updated.notes,
      scope: updated.scope,
      allowCashierCounting: updated.allowCashierCounting
    },
    ipAddress: getRequestIp(req)
  });

  return ok(res, updated, "Inventaire mis a jour.");
}));

inventoriesRouter.patch("/:id/items/:itemId", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventoryItemId = readRouteParam(req.params.itemId as string | string[] | undefined, "Identifiant ligne");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  if (!isInventoryEditable(inventory.status)) {
    throw new AppError("Cet inventaire est verrouille.", 400);
  }
  if (!hasInventoryManageAccess(req) && !inventory.allowCashierCounting) {
    throw new AppError("La saisie caissier n'est pas activee pour cet inventaire.", 403);
  }

  const item = await prisma.inventoryItem.findFirst({
    where: {
      id: inventoryItemId,
      inventoryId: inventory.id
    }
  });
  if (!item) {
    throw new AppError("Ligne d'inventaire introuvable.", 404);
  }

  const payload = updateInventoryItemSchema.parse(req.body ?? {});
  const nextCountedQty = payload.countedQty === undefined ? item.countedQty : payload.countedQty;
  const nextComputed = buildItemStatus(item.theoreticalQty, nextCountedQty);
  const updated = await prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      countedQty: nextCountedQty,
      differenceQty: nextComputed.differenceQty,
      differenceValue: round2(nextComputed.differenceValue * Number(item.unitCost ?? 0)),
      status: nextCountedQty == null ? "PENDING" : nextComputed.status,
      notes: payload.notes === undefined ? item.notes : payload.notes?.trim() || null
    }
  });

  if (inventory.status === "DRAFT") {
    await prisma.inventory.update({
      where: { id: inventory.id },
      data: { status: "IN_PROGRESS" }
    });
  }

  await createInventoryLog({
    inventoryId: inventory.id,
    inventoryItemId: item.id,
    userId: req.currentUser?.id ?? null,
    action: "inventory.item.updated",
    oldValue: {
      countedQty: item.countedQty,
      differenceQty: item.differenceQty,
      differenceValue: item.differenceValue,
      status: item.status,
      notes: item.notes
    },
    newValue: {
      countedQty: updated.countedQty,
      differenceQty: updated.differenceQty,
      differenceValue: updated.differenceValue,
      status: updated.status,
      notes: updated.notes
    },
    ipAddress: getRequestIp(req)
  });
  await writeAuditLog({
    userId: req.currentUser?.id ?? null,
    action: "inventory.item.updated",
    entityType: "inventory_item",
    entityId: item.id,
    meta: {
      inventoryId: inventory.id,
      countedQty: updated.countedQty,
      differenceQty: updated.differenceQty
    }
  });

  return ok(res, updated, "Comptage enregistre.");
}));

inventoriesRouter.post("/:id/submit", asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertInventoryManager(req);
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  if (!isInventoryEditable(inventory.status)) {
    throw new AppError("Cet inventaire ne peut plus etre soumis.", 400);
  }

  const pendingCount = await prisma.inventoryItem.count({
    where: {
      inventoryId: inventory.id,
      countedQty: null
    }
  });
  if (pendingCount > 0) {
    throw new AppError("Toutes les lignes doivent etre comptees avant envoi en validation.", 400);
  }

  const updated = await prisma.inventory.update({
    where: { id: inventory.id },
    data: { status: "PENDING_VALIDATION" }
  });

  await createInventoryLog({
    inventoryId: inventory.id,
    userId: req.currentUser?.id ?? null,
    action: "inventory.submitted",
    oldValue: inventory.status,
    newValue: updated.status,
    ipAddress: getRequestIp(req)
  });
  await writeAuditLog({
    userId: req.currentUser?.id ?? null,
    action: "inventory.submitted",
    entityType: "inventory",
    entityId: inventory.id,
    meta: { status: updated.status }
  });

  return ok(res, updated, "Inventaire envoye pour validation.");
}));

inventoriesRouter.post("/:id/cancel", asyncHandler(async (req: AuthenticatedRequest, res) => {
  assertInventoryManager(req);
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  if (inventory.status === "VALIDATED") {
    throw new AppError("Un inventaire valide ne peut pas etre annule.", 400);
  }
  if (inventory.status === "CANCELLED") {
    return ok(res, inventory, "Inventaire deja annule.");
  }

  const updated = await prisma.inventory.update({
    where: { id: inventory.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date()
    }
  });

  await createInventoryLog({
    inventoryId: inventory.id,
    userId: req.currentUser?.id ?? null,
    action: "inventory.cancelled",
    oldValue: inventory.status,
    newValue: updated.status,
    ipAddress: getRequestIp(req)
  });

  return ok(res, updated, "Inventaire annule.");
}));

inventoriesRouter.post("/:id/validate", asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (!canValidateInventory(req)) {
    throw new AppError("Validation finale reservee a un admin ou manager autorise.", 403);
  }

  const payload = validateInventorySchema.parse(req.body ?? {});
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  if (inventory.status === "VALIDATED") {
    throw new AppError("Cet inventaire est deja valide.", 400);
  }
  if (inventory.status === "CANCELLED") {
    throw new AppError("Cet inventaire a ete annule.", 400);
  }
  if (inventory.status !== "PENDING_VALIDATION") {
    throw new AppError("L'inventaire doit etre en attente de validation avant validation finale.", 400);
  }
  if (!payload.confirmation) {
    throw new AppError("Confirmation obligatoire avant validation finale.", 400);
  }

  const items = await prisma.inventoryItem.findMany({
    where: { inventoryId: inventory.id },
    include: {
      product: { select: { id: true, reference: true, variants: { select: { id: true } } } }
    }
  });
  if (items.some((item) => item.countedQty == null)) {
    throw new AppError("Toutes les lignes doivent etre comptees avant validation finale.", 400);
  }

  const touchedProductIds = new Set<string>();
  const touchedVariantIds = new Set<string>();
  const variantProductMap = new Map<string, { productId: string; variantIds: string[] }>();
  for (const item of items) {
    variantProductMap.set(item.productId, {
      productId: item.product.id,
      variantIds: item.product.variants.map((variant) => variant.id)
    });
  }

  await prisma.$transaction(async (tx) => {
    let balances = await readStockBalances(tx);
    let variantBalances = await readVariantStockBalances(tx);

    for (const item of items) {
      if (!item.warehouseId || item.differenceQty === 0) continue;

      if (item.productVariantId) {
        const beforeStock = getVariantLocationStock(variantBalances, item.productVariantId, item.warehouseId);
        const afterStock = beforeStock + item.differenceQty;
        variantBalances = applyVariantLocationDelta(variantBalances, item.productVariantId, item.warehouseId, item.differenceQty);
        touchedVariantIds.add(item.productVariantId);
        touchedProductIds.add(item.productId);

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: item.warehouseId,
            type: "ADJUSTMENT",
            quantity: item.differenceQty,
            beforeStock,
            afterStock,
            referenceType: "inventory",
            referenceId: inventory.id,
            notes: `Inventaire ${inventory.reference} - ${item.productReference}`
          }
        });
        continue;
      }

      const beforeStock = getLocationStock(balances, item.productId, item.warehouseId);
      const afterStock = beforeStock + item.differenceQty;
      balances = applyLocationDelta(balances, item.productId, item.warehouseId, item.differenceQty);
      touchedProductIds.add(item.productId);

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: item.warehouseId,
          type: "ADJUSTMENT",
          quantity: item.differenceQty,
          beforeStock,
          afterStock,
          referenceType: "inventory",
          referenceId: inventory.id,
          notes: `Inventaire ${inventory.reference}`
        }
      });
    }

    await saveStockBalances(tx, balances);
    await saveVariantStockBalances(tx, variantBalances);

    for (const productId of touchedProductIds) {
      const linked = variantProductMap.get(productId);
      if (linked?.variantIds.length) {
        for (const variantId of linked.variantIds.filter((id) => touchedVariantIds.has(id))) {
          await syncVariantGlobalStock(tx, variantBalances, variantId);
        }
        await tx.product.update({
          where: { id: productId },
          data: {
            stockOnHand: Math.max(0, Math.round(getProductStockTotalFromVariantBalances(linked.variantIds, variantBalances)))
          }
        });
      } else {
        await syncProductGlobalStock(tx, balances, productId);
      }
    }

    await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        status: "VALIDATED",
        validatedAt: new Date(),
        validatedById: req.currentUser?.id ?? null,
        notes: payload.notes?.trim() ? `${inventory.notes ? `${inventory.notes}\n` : ""}${payload.notes.trim()}` : inventory.notes
      }
    });
  });

  await createInventoryLog({
    inventoryId: inventory.id,
    userId: req.currentUser?.id ?? null,
    action: "inventory.validated",
    oldValue: inventory.status,
    newValue: "VALIDATED",
    ipAddress: getRequestIp(req)
  });
  await writeAuditLog({
    userId: req.currentUser?.id ?? null,
    action: "inventory.validated",
    entityType: "inventory",
    entityId: inventory.id,
    meta: {
      reference: inventory.reference,
      validatedBy: req.currentUser?.fullName ?? null
    }
  });

  const validated = await prisma.inventory.findUnique({
    where: { id: inventory.id },
    include: {
      createdBy: { select: { id: true, fullName: true } },
      validatedBy: { select: { id: true, fullName: true } }
    }
  });

  return ok(res, validated, "Inventaire valide.");
}));

inventoriesRouter.get("/:id/report", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const inventoryId = readRouteParam(req.params.id as string | string[] | undefined, "Identifiant inventaire");
  const inventory = await loadInventoryOrThrow(req, inventoryId);
  const [items, logs] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { inventoryId: inventory.id },
      orderBy: [{ productReference: "asc" }, { productName: "asc" }],
      select: {
        id: true,
        productReference: true,
        barcode: true,
        productName: true,
        category: true,
        type: true,
        brand: true,
        color: true,
        size: true,
        location: true,
        theoreticalQty: true,
        countedQty: true,
        differenceQty: true,
        unitCost: true,
        differenceValue: true,
        status: true,
        notes: true
      }
    }),
    prisma.inventoryLog.findMany({
      where: { inventoryId: inventory.id },
      orderBy: [{ createdAt: "asc" }],
      include: {
        user: { select: { id: true, fullName: true } }
      }
    })
  ]);

  const summary = summarizeInventoryItems(items);

  return ok(res, {
    inventory,
    summary,
    compliantItems: items.filter((item) => item.differenceQty === 0),
    differenceItems: items.filter((item) => item.differenceQty !== 0),
    logs
  });
}));
