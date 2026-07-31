import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok } from "../../common/http.js";
import { authenticate, type AuthenticatedRequest, ensureWarehouseAccess, getScopedWarehouseId, isAdminUser, requirePermissions, requireScopedWarehouse } from "../../common/auth.js";
import { writeAuditLog } from "../../common/audit.js";
import {
  applyLocationDelta,
  applyVariantLocationDelta,
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
  syncProductGlobalStock,
  syncVariantGlobalStock
} from "../../common/stock-balances.js";

const INVENTORY_TRANSFER_NOTIFICATIONS_KEY = "inventory_transfer_notifications";

type InventoryTransferNotification = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  variantLabel?: string | null;
  quantity: number;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  reason: string;
  createdAt: string;
  readByUserIds: string[];
};
type SettingsDb = Pick<typeof prisma, "setting">;

const adjustmentSchema = z.object({
  productId: z.string(),
  variantId: z.string().optional().nullable(),
  warehouseId: z.string(),
  quantity: z.coerce.number().int(),
  reason: z.string().min(2)
});

const transferSchema = z.object({
  productId: z.string(),
  variantId: z.string().optional().nullable(),
  fromWarehouseId: z.string(),
  toWarehouseId: z.string(),
  quantity: z.coerce.number().int().positive(),
  reason: z.string().min(2)
}).refine((payload) => payload.fromWarehouseId !== payload.toWarehouseId, {
  message: "Choisis deux emplacements differents.",
  path: ["toWarehouseId"]
});

function isTransferNotification(value: unknown): value is InventoryTransferNotification {
  if (!value || typeof value !== "object") return false;
  const notification = value as Record<string, unknown>;
  return typeof notification.id === "string"
    && typeof notification.warehouseId === "string"
    && typeof notification.productId === "string"
    && typeof notification.productName === "string"
    && typeof notification.quantity === "number"
    && typeof notification.fromWarehouseId === "string"
    && typeof notification.toWarehouseId === "string"
    && typeof notification.reason === "string"
    && typeof notification.createdAt === "string"
    && Array.isArray(notification.readByUserIds);
}

async function readTransferNotifications(db: SettingsDb) {
  const setting = await db.setting.findUnique({ where: { key: INVENTORY_TRANSFER_NOTIFICATIONS_KEY } });
  if (!Array.isArray(setting?.value)) return [];
  return setting.value.filter(isTransferNotification);
}

async function saveTransferNotifications(
  db: SettingsDb,
  notifications: InventoryTransferNotification[]
) {
  return db.setting.upsert({
    where: { key: INVENTORY_TRANSFER_NOTIFICATIONS_KEY },
    create: { key: INVENTORY_TRANSFER_NOTIFICATIONS_KEY, value: notifications },
    update: { value: notifications }
  });
}

export const inventoryRouter = Router();
inventoryRouter.use(authenticate, requirePermissions("inventory_manage"));

inventoryRouter.get("/movements", asyncHandler(async (req: AuthenticatedRequest, res) => ok(res, await prisma.stockMovement.findMany({
  where: getScopedWarehouseId(req.currentUser) ? { warehouseId: getScopedWarehouseId(req.currentUser)! } : undefined,
  include: { product: true, warehouse: true },
  orderBy: { createdAt: "desc" },
  take: 200
}))));

inventoryRouter.get("/alerts", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const products = await prisma.product.findMany({ where: { status: "ACTIVE" }, orderBy: { stockOnHand: "asc" }, include: { variants: { select: { id: true, stockOnHand: true } } } });
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

  const stockAwareProducts = products.map((product) => ({
    ...product,
    stockOnHand: product.variants.length
      ? scopedWarehouseId
        ? getProductLocationStockFromVariantBalances(product.variants.map((variant) => variant.id), variantBalances, scopedWarehouseId)
        : getProductStockTotalFromVariantBalances(product.variants.map((variant) => variant.id), variantBalances)
      : scopedWarehouseId
        ? getLocationStock(balances, product.id, scopedWarehouseId)
        : getProductStockTotal(balances, product.id)
  }));

  return ok(res, {
    outOfStock: stockAwareProducts.filter((product) => product.stockOnHand <= 0),
    lowStock: stockAwareProducts.filter((product) => product.stockOnHand > 0 && product.stockOnHand <= product.minStock)
  });
}));

inventoryRouter.get("/bootstrap", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [products, warehouses, rawBalances, rawVariantBalances] = await Promise.all([
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        reference: true,
        name: true,
        stockOnHand: true,
        minStock: true,
        warehouseId: true,
        variants: { select: { id: true, reference: true, label: true, color: true, size: true, stockOnHand: true } }
      }
    }),
    prisma.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    readStockBalances(),
    readVariantStockBalances()
  ]);

  const initialBalances = rawBalances;
  const initialVariantBalances = rawVariantBalances;
  let balances = rawBalances;
  let variantBalances = rawVariantBalances;
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

  const variantColorNames = Array.from(
    new Set(
      products.flatMap((product) => product.variants.map((variant) => variant.color?.trim()).filter((value): value is string => Boolean(value)))
    )
  );
  const colors = variantColorNames.length
    ? await prisma.color.findMany({ where: { name: { in: variantColorNames } }, select: { name: true, reference: true } })
    : [];
  const colorReferenceMap = new Map(colors.map((color) => [color.name.trim().toLowerCase(), color.reference]));

  const overview = products.map((product) => ({
    id: product.id,
    name: product.name,
    reference: product.reference,
    stockOnHand: product.variants.length
      ? getProductStockTotalFromVariantBalances(product.variants.map((variant) => variant.id), variantBalances)
      : getProductStockTotal(balances, product.id),
    minStock: product.minStock,
    locations: warehouses.map((warehouse) => ({
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      warehouseType: warehouse.type,
      quantity: product.variants.length
        ? getProductLocationStockFromVariantBalances(product.variants.map((variant) => variant.id), variantBalances, warehouse.id)
        : getLocationStock(balances, product.id, warehouse.id)
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      reference: variant.reference,
      label: variant.label,
      color: variant.color,
      colorReference: variant.color ? (colorReferenceMap.get(variant.color.trim().toLowerCase()) ?? null) : null,
      size: variant.size,
      stockOnHand: getProductStockTotalFromVariantBalances([variant.id], variantBalances),
      locations: warehouses.map((warehouse) => ({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        quantity: getProductLocationStockFromVariantBalances([variant.id], variantBalances, warehouse.id)
      }))
    }))
  }));

  return ok(res, {
    products: products.map(({ warehouseId: _warehouseId, ...product }) => product),
    warehouses,
    balances,
    overview
  });
}));

inventoryRouter.get("/notifications", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (!scopedWarehouseId || !req.currentUser) {
    return ok(res, []);
  }

  const notifications = await readTransferNotifications(prisma);
  const unreadNotifications = notifications
    .filter((notification) => notification.warehouseId === scopedWarehouseId && !notification.readByUserIds.includes(req.currentUser!.id))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 8);

  return ok(res, unreadNotifications);
}));

inventoryRouter.get("/notifications/history", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (!scopedWarehouseId || !req.currentUser) {
    return ok(res, []);
  }

  const notifications = await readTransferNotifications(prisma);
  const history = notifications
    .filter((notification) => notification.warehouseId === scopedWarehouseId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 30)
    .map((notification) => ({
      ...notification,
      isRead: notification.readByUserIds.includes(req.currentUser!.id)
    }));

  return ok(res, history);
}));

inventoryRouter.post("/notifications/:notificationId/read", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  if (!scopedWarehouseId || !req.currentUser) {
    return ok(res, true);
  }

  const notifications = await readTransferNotifications(prisma);
  const updatedNotifications = notifications.map((notification) => {
    if (notification.id !== req.params.notificationId || notification.warehouseId !== scopedWarehouseId) {
      return notification;
    }
    if (notification.readByUserIds.includes(req.currentUser!.id)) {
      return notification;
    }
    return {
      ...notification,
      readByUserIds: [...notification.readByUserIds, req.currentUser!.id]
    };
  });

  await saveTransferNotifications(prisma, updatedNotifications);
  return ok(res, true);
}));

inventoryRouter.post("/adjustments", asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (!isAdminUser(req.currentUser)) {
    throw new AppError("Ajustement reserve a l'administrateur.", 403);
  }
  const payload = adjustmentSchema.parse(req.body);
  ensureWarehouseAccess(req.currentUser, payload.warehouseId);
  const product = await prisma.product.findUnique({ where: { id: payload.productId }, include: { variants: true } });
  if (!product) throw new AppError("Article introuvable.", 404);
  const variant = payload.variantId ? product.variants.find((item) => item.id === payload.variantId) ?? null : null;
  if (product.variants.length && !variant) {
    throw new AppError("Choisis une variante pour cet article.", 422);
  }

  await prisma.$transaction(async (tx) => {
    let balances = await readStockBalances(tx);
    balances = await ensureProductStockSeeded(tx, balances, product, payload.warehouseId);
    let variantBalances = await readVariantStockBalances(tx);
    if (variant) {
      variantBalances = await ensureVariantStockSeeded(tx, variantBalances, { ...variant, product: { warehouseId: product.warehouseId } }, payload.warehouseId);
    }

    const beforeLocationStock = variant
      ? getVariantLocationStock(variantBalances, variant.id, payload.warehouseId)
      : getLocationStock(balances, product.id, payload.warehouseId);
    const afterLocationStock = beforeLocationStock + payload.quantity;
    if (afterLocationStock < 0) throw new AppError("Stock insuffisant sur cet emplacement.", 422);

    balances = applyLocationDelta(balances, product.id, payload.warehouseId, payload.quantity);
    await saveStockBalances(tx, balances);
    await syncProductGlobalStock(tx, balances, product.id);

    if (variant) {
      variantBalances = applyVariantLocationDelta(variantBalances, variant.id, payload.warehouseId, payload.quantity);
      await saveVariantStockBalances(tx, variantBalances);
      await syncVariantGlobalStock(tx, variantBalances, variant.id);
    }

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        warehouseId: payload.warehouseId,
        type: "ADJUSTMENT",
        quantity: payload.quantity,
        beforeStock: beforeLocationStock,
        afterStock: afterLocationStock,
        notes: variant ? `${payload.reason} - ${variant.reference}` : payload.reason
      }
    });
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "inventory.adjust", entityType: "product", entityId: product.id, meta: payload });
  return ok(res, true, "Ajustement enregistre.");
}));

inventoryRouter.post("/transfers", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const payload = transferSchema.parse(req.body);
  if (isAdminUser(req.currentUser)) {
    ensureWarehouseAccess(req.currentUser, payload.fromWarehouseId);
    ensureWarehouseAccess(req.currentUser, payload.toWarehouseId);
  } else {
    const scopedWarehouseId = requireScopedWarehouse(req.currentUser);
    if (payload.fromWarehouseId !== scopedWarehouseId) {
      throw new AppError("Le transfert doit partir de ta boutique.", 403);
    }
  }
  const [product, warehouseRecords] = await Promise.all([
    prisma.product.findUnique({ where: { id: payload.productId }, include: { variants: true } }),
    prisma.warehouse.findMany({
      where: { id: { in: [payload.fromWarehouseId, payload.toWarehouseId] } },
      select: { id: true, name: true }
    })
  ]);
  if (!product) throw new AppError("Article introuvable.", 404);
  const sourceWarehouse = warehouseRecords.find((warehouse) => warehouse.id === payload.fromWarehouseId);
  const targetWarehouse = warehouseRecords.find((warehouse) => warehouse.id === payload.toWarehouseId);
  if (!sourceWarehouse || !targetWarehouse) {
    throw new AppError("Boutique ou entrepot introuvable.", 404);
  }
  const variant = payload.variantId ? product.variants.find((item) => item.id === payload.variantId) ?? null : null;
  if (product.variants.length && !variant) {
    throw new AppError("Choisis une variante pour cet article.", 422);
  }
  const variantLabel = variant
    ? [variant.color, variant.size].filter(Boolean).join(" - ") || variant.reference || variant.label || null
    : null;

  await prisma.$transaction(async (tx) => {
    let balances = await readStockBalances(tx);
    balances = await ensureProductStockSeeded(tx, balances, product, payload.fromWarehouseId);
    let variantBalances = await readVariantStockBalances(tx);
    if (variant) {
      variantBalances = await ensureVariantStockSeeded(tx, variantBalances, { ...variant, product: { warehouseId: product.warehouseId } }, payload.fromWarehouseId);
    }

    const beforeSource = variant
      ? getVariantLocationStock(variantBalances, variant.id, payload.fromWarehouseId)
      : getLocationStock(balances, product.id, payload.fromWarehouseId);
    if (beforeSource < payload.quantity) throw new AppError("Stock insuffisant dans l'emplacement source.", 422);
    const beforeTarget = variant
      ? getVariantLocationStock(variantBalances, variant.id, payload.toWarehouseId)
      : getLocationStock(balances, product.id, payload.toWarehouseId);

    balances = applyLocationDelta(balances, product.id, payload.fromWarehouseId, -payload.quantity);
    balances = applyLocationDelta(balances, product.id, payload.toWarehouseId, payload.quantity);
    await saveStockBalances(tx, balances);
    await syncProductGlobalStock(tx, balances, product.id);

    if (variant) {
      variantBalances = applyVariantLocationDelta(variantBalances, variant.id, payload.fromWarehouseId, -payload.quantity);
      variantBalances = applyVariantLocationDelta(variantBalances, variant.id, payload.toWarehouseId, payload.quantity);
      await saveVariantStockBalances(tx, variantBalances);
      await syncVariantGlobalStock(tx, variantBalances, variant.id);
    }

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        warehouseId: payload.fromWarehouseId,
        type: "TRANSFER_OUT",
        quantity: payload.quantity,
        beforeStock: beforeSource,
        afterStock: beforeSource - payload.quantity,
        notes: variant ? `Transfert sortant - ${payload.reason} - ${variant.reference}` : `Transfert sortant - ${payload.reason}`
      }
    });

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        warehouseId: payload.toWarehouseId,
        type: "TRANSFER_IN",
        quantity: payload.quantity,
        beforeStock: beforeTarget,
        afterStock: beforeTarget + payload.quantity,
        notes: variant ? `Transfert entrant - ${payload.reason} - ${variant.reference}` : `Transfert entrant - ${payload.reason}`
      }
    });

    const notifications = await readTransferNotifications(tx);
    notifications.push({
      id: crypto.randomUUID(),
      warehouseId: targetWarehouse.id,
      warehouseName: targetWarehouse.name,
      productId: product.id,
      productName: product.name,
      variantLabel,
      quantity: payload.quantity,
      fromWarehouseId: sourceWarehouse.id,
      fromWarehouseName: sourceWarehouse.name,
      toWarehouseId: targetWarehouse.id,
      toWarehouseName: targetWarehouse.name,
      reason: payload.reason,
      createdAt: new Date().toISOString(),
      readByUserIds: []
    });
    await saveTransferNotifications(tx, notifications);
  });

  await writeAuditLog({ userId: req.currentUser?.id, action: "inventory.transfer", entityType: "product", entityId: product.id, meta: payload });
  return ok(res, true, "Transfert de stock enregistre.");
}));
