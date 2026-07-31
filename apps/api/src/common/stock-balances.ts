import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

export const STOCK_BALANCES_KEY = "stock_balances";
export const VARIANT_STOCK_BALANCES_KEY = "variant_stock_balances";

export type StockBalanceEntry = {
  productId: string;
  warehouseId: string;
  quantity: number;
};

export type VariantStockBalanceEntry = {
  variantId: string;
  warehouseId: string;
  quantity: number;
};

type StockBalanceDb =
  | Pick<Prisma.TransactionClient, "product" | "productVariant" | "warehouse" | "setting">
  | Pick<typeof prisma, "product" | "productVariant" | "warehouse" | "setting">;

function isStockBalanceEntry(value: unknown): value is StockBalanceEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.productId === "string"
    && typeof entry.warehouseId === "string"
    && typeof entry.quantity === "number"
    && Number.isFinite(entry.quantity);
}

function isVariantStockBalanceEntry(value: unknown): value is VariantStockBalanceEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.variantId === "string"
    && typeof entry.warehouseId === "string"
    && typeof entry.quantity === "number"
    && Number.isFinite(entry.quantity);
}

export function normalizeStockBalances(entries: StockBalanceEntry[]) {
  const merged = new Map<string, StockBalanceEntry>();

  for (const entry of entries) {
    const productId = String(entry.productId ?? "").trim();
    const warehouseId = String(entry.warehouseId ?? "").trim();
    const quantity = Number(entry.quantity ?? 0);

    if (!productId || !warehouseId || !Number.isFinite(quantity)) continue;

    const key = `${productId}::${warehouseId}`;
    const current = merged.get(key);
    if (current) {
      current.quantity += quantity;
    } else {
      merged.set(key, { productId, warehouseId, quantity });
    }
  }

  return Array.from(merged.values())
    .filter((entry) => Math.abs(entry.quantity) > 0.0001)
    .map((entry) => ({ ...entry, quantity: Math.round(entry.quantity) }));
}

export function normalizeVariantStockBalances(entries: VariantStockBalanceEntry[]) {
  const merged = new Map<string, VariantStockBalanceEntry>();

  for (const entry of entries) {
    const variantId = String(entry.variantId ?? "").trim();
    const warehouseId = String(entry.warehouseId ?? "").trim();
    const quantity = Number(entry.quantity ?? 0);

    if (!variantId || !warehouseId || !Number.isFinite(quantity)) continue;

    const key = `${variantId}::${warehouseId}`;
    const current = merged.get(key);
    if (current) {
      current.quantity += quantity;
    } else {
      merged.set(key, { variantId, warehouseId, quantity });
    }
  }

  return Array.from(merged.values())
    .filter((entry) => Math.abs(entry.quantity) > 0.0001)
    .map((entry) => ({ ...entry, quantity: Math.round(entry.quantity) }));
}

export async function readStockBalances(db: StockBalanceDb = prisma) {
  const setting = await db.setting.findUnique({ where: { key: STOCK_BALANCES_KEY } });
  return Array.isArray(setting?.value)
    ? normalizeStockBalances((setting.value as unknown[]).filter(isStockBalanceEntry))
    : [];
}

export async function saveStockBalances(db: StockBalanceDb, entries: StockBalanceEntry[]) {
  const value = normalizeStockBalances(entries) as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key: STOCK_BALANCES_KEY },
    create: { key: STOCK_BALANCES_KEY, value },
    update: { value }
  });
}

export async function readVariantStockBalances(db: StockBalanceDb = prisma) {
  const setting = await db.setting.findUnique({ where: { key: VARIANT_STOCK_BALANCES_KEY } });
  return Array.isArray(setting?.value)
    ? normalizeVariantStockBalances((setting.value as unknown[]).filter(isVariantStockBalanceEntry))
    : [];
}

export async function saveVariantStockBalances(db: StockBalanceDb, entries: VariantStockBalanceEntry[]) {
  const value = normalizeVariantStockBalances(entries) as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key: VARIANT_STOCK_BALANCES_KEY },
    create: { key: VARIANT_STOCK_BALANCES_KEY, value },
    update: { value }
  });
}

export function areStockBalancesEqual(left: StockBalanceEntry[], right: StockBalanceEntry[]) {
  const a = normalizeStockBalances(left);
  const b = normalizeStockBalances(right);
  if (a.length !== b.length) return false;
  return a.every((entry, index) => (
    entry.productId === b[index]?.productId
    && entry.warehouseId === b[index]?.warehouseId
    && entry.quantity === b[index]?.quantity
  ));
}

export function areVariantStockBalancesEqual(left: VariantStockBalanceEntry[], right: VariantStockBalanceEntry[]) {
  const a = normalizeVariantStockBalances(left);
  const b = normalizeVariantStockBalances(right);
  if (a.length !== b.length) return false;
  return a.every((entry, index) => (
    entry.variantId === b[index]?.variantId
    && entry.warehouseId === b[index]?.warehouseId
    && entry.quantity === b[index]?.quantity
  ));
}

export function getLocationStock(entries: StockBalanceEntry[], productId: string, warehouseId: string) {
  return entries.find((entry) => entry.productId === productId && entry.warehouseId === warehouseId)?.quantity ?? 0;
}

export function getProductStockTotal(entries: StockBalanceEntry[], productId: string) {
  return entries
    .filter((entry) => entry.productId === productId)
    .reduce((sum, entry) => sum + entry.quantity, 0);
}

export function applyLocationDelta(entries: StockBalanceEntry[], productId: string, warehouseId: string, delta: number) {
  if (!delta) return normalizeStockBalances(entries);

  const next = [...entries];
  const index = next.findIndex((entry) => entry.productId === productId && entry.warehouseId === warehouseId);
  if (index >= 0) {
    next[index] = { ...next[index], quantity: next[index].quantity + delta };
  } else {
    next.push({ productId, warehouseId, quantity: delta });
  }
  return normalizeStockBalances(next);
}

export function getVariantLocationStock(entries: VariantStockBalanceEntry[], variantId: string, warehouseId: string) {
  return entries.find((entry) => entry.variantId === variantId && entry.warehouseId === warehouseId)?.quantity ?? 0;
}

export function getVariantStockTotal(entries: VariantStockBalanceEntry[], variantId: string) {
  return entries
    .filter((entry) => entry.variantId === variantId)
    .reduce((sum, entry) => sum + entry.quantity, 0);
}

export function applyVariantLocationDelta(entries: VariantStockBalanceEntry[], variantId: string, warehouseId: string, delta: number) {
  if (!delta) return normalizeVariantStockBalances(entries);

  const next = [...entries];
  const index = next.findIndex((entry) => entry.variantId === variantId && entry.warehouseId === warehouseId);
  if (index >= 0) {
    next[index] = { ...next[index], quantity: next[index].quantity + delta };
  } else {
    next.push({ variantId, warehouseId, quantity: delta });
  }
  return normalizeVariantStockBalances(next);
}

async function pickFallbackWarehouseId(db: StockBalanceDb, preferredWarehouseId?: string | null) {
  if (preferredWarehouseId) return preferredWarehouseId;
  const warehouses = await db.warehouse.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, type: true }
  });
  return warehouses.find((warehouse) => warehouse.type === "WAREHOUSE")?.id
    ?? warehouses[0]?.id
    ?? null;
}

export async function ensureProductStockSeeded(
  db: StockBalanceDb,
  entries: StockBalanceEntry[],
  product: { id: string; stockOnHand: number; warehouseId?: string | null; variants?: Array<{ id?: string; stockOnHand?: number | null }> },
  preferredWarehouseId?: string | null
) {
  if (entries.some((entry) => entry.productId === product.id)) {
    return normalizeStockBalances(entries);
  }

  const variantStock = product.variants
    ? Math.max(0, product.variants.reduce((sum, variant) => sum + Math.max(0, Math.round(Number(variant.stockOnHand ?? 0))), 0))
    : Math.max(0, Number((await db.productVariant.aggregate({
      where: { productId: product.id },
      _sum: { stockOnHand: true }
    }))._sum.stockOnHand ?? 0));
  const seedQuantity = Math.max(Math.round(product.stockOnHand), Math.round(variantStock));
  if (seedQuantity <= 0) {
    return normalizeStockBalances(entries);
  }

  const fallbackWarehouseId = await pickFallbackWarehouseId(db, preferredWarehouseId ?? product.warehouseId ?? null);
  if (!fallbackWarehouseId) return normalizeStockBalances(entries);

  return normalizeStockBalances([
    ...entries,
    {
      productId: product.id,
      warehouseId: fallbackWarehouseId,
      quantity: seedQuantity
    }
  ]);
}

export async function ensureVariantStockSeeded(
  db: StockBalanceDb,
  entries: VariantStockBalanceEntry[],
  variant: { id: string; stockOnHand: number; product?: { warehouseId?: string | null } | null },
  preferredWarehouseId?: string | null
) {
  if (entries.some((entry) => entry.variantId === variant.id) || variant.stockOnHand <= 0) {
    return normalizeVariantStockBalances(entries);
  }

  const fallbackWarehouseId = await pickFallbackWarehouseId(db, preferredWarehouseId ?? variant.product?.warehouseId ?? null);
  if (!fallbackWarehouseId) return normalizeVariantStockBalances(entries);

  return normalizeVariantStockBalances([
    ...entries,
    {
      variantId: variant.id,
      warehouseId: fallbackWarehouseId,
      quantity: Math.round(variant.stockOnHand)
    }
  ]);
}

export async function syncProductGlobalStock(
  db: StockBalanceDb,
  entries: StockBalanceEntry[],
  productId: string
) {
  const total = getProductStockTotal(entries, productId);
  await db.product.update({
    where: { id: productId },
    data: { stockOnHand: Math.max(0, Math.round(total)) }
  });
}

export async function syncVariantGlobalStock(
  db: StockBalanceDb,
  entries: VariantStockBalanceEntry[],
  variantId: string
) {
  const total = getVariantStockTotal(entries, variantId);
  await db.productVariant.update({
    where: { id: variantId },
    data: { stockOnHand: Math.max(0, Math.round(total)) }
  });
}

export function getProductLocationStockFromVariantBalances(
  variantIds: string[],
  entries: VariantStockBalanceEntry[],
  warehouseId: string
) {
  const ids = new Set(variantIds);
  return entries
    .filter((entry) => ids.has(entry.variantId) && entry.warehouseId === warehouseId)
    .reduce((sum, entry) => sum + entry.quantity, 0);
}

export function getProductStockTotalFromVariantBalances(
  variantIds: string[],
  entries: VariantStockBalanceEntry[]
) {
  const ids = new Set(variantIds);
  return entries
    .filter((entry) => ids.has(entry.variantId))
    .reduce((sum, entry) => sum + entry.quantity, 0);
}
