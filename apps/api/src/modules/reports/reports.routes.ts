import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, ok } from "../../common/http.js";
import { authenticate, ensureWarehouseAccess, getScopedWarehouseId, requirePermissions, type AuthenticatedRequest } from "../../common/auth.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate, requirePermissions("reports_view"));

const salesBySellerQuerySchema = z.object({
  warehouseId: z.string().optional(),
  sellerId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});
const salesByStoreQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function toStartOfDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function toEndOfDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function getTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeSellerName(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function paymentMethodLabel(method: string) {
  switch (String(method || "").trim().toUpperCase()) {
    case "CASH":
      return "Espece";
    case "CARD":
      return "Carte de credit";
    case "TRANSFER":
      return "Virement";
    case "CHEQUE":
      return "Cheque";
    case "CREDIT":
      return "Compte clients";
    case "VOUCHER":
      return "Avoir";
    case "FOREIGN_CURRENCY":
      return "Devise";
    default:
      return String(method || "Autre");
  }
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function sumBy<T>(items: T[], pick: (item: T) => number) {
  return round2(items.reduce((sum, item) => sum + pick(item), 0));
}

function sortByAmountDesc<T extends { amount?: number; revenue?: number; totalAmount?: number }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftValue = left.amount ?? left.revenue ?? left.totalAmount ?? 0;
    const rightValue = right.amount ?? right.revenue ?? right.totalAmount ?? 0;
    return rightValue - leftValue;
  });
}

const completedStatuses = new Set(["PAID", "PARTIAL", "UNPAID"]);

reportsRouter.get("/sales-by-seller/bootstrap", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const [warehouses, sellers] = await Promise.all([
    prisma.warehouse.findMany({
      where: scopedWarehouseId ? { id: scopedWarehouseId } : { type: "STORE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, type: true }
    }),
    prisma.seller.findMany({
      where: { isActive: true, ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}) },
      orderBy: { fullName: "asc" },
      include: {
        warehouse: { select: { id: true, name: true } },
        categories: {
          include: { category: { select: { id: true, name: true } } },
          orderBy: { category: { name: "asc" } }
        }
      }
    })
  ]);

  return ok(res, {
    warehouses,
    sellers: sellers.map((seller) => ({
      id: seller.id,
      fullName: seller.fullName,
      warehouseId: seller.warehouseId,
      warehouseName: seller.warehouse?.name ?? "",
      commissionRate: Number(seller.commissionRate),
      categoryNames: seller.categories.map((item) => item.category.name)
    }))
  });
}));

reportsRouter.get("/sales-by-seller", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = salesBySellerQuerySchema.parse(req.query ?? {});
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const warehouseId = scopedWarehouseId || (query.warehouseId ? String(query.warehouseId).trim() : "") || null;
  if (warehouseId) ensureWarehouseAccess(req.currentUser, warehouseId);

  const today = getTodayIso();
  const rawDateFrom = isIsoDate(query.dateFrom) ? String(query.dateFrom) : today;
  const rawDateTo = isIsoDate(query.dateTo) ? String(query.dateTo) : rawDateFrom;
  const [dateFrom, dateTo] = rawDateFrom <= rawDateTo ? [rawDateFrom, rawDateTo] : [rawDateTo, rawDateFrom];

  const [warehouses, sellers, sales] = await Promise.all([
    prisma.warehouse.findMany({
      where: warehouseId ? { id: warehouseId } : scopedWarehouseId ? { id: scopedWarehouseId } : { type: "STORE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, type: true }
    }),
    prisma.seller.findMany({
      where: { isActive: true, ...(warehouseId ? { warehouseId } : scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}) },
      orderBy: { fullName: "asc" },
      include: {
        warehouse: { select: { id: true, name: true } },
        categories: {
          include: { category: { select: { id: true, name: true } } },
          orderBy: { category: { name: "asc" } }
        }
      }
    }),
    prisma.sale.findMany({
      where: {
        createdAt: {
          gte: toStartOfDay(dateFrom),
          lte: toEndOfDay(dateTo)
        },
        ...(warehouseId ? { warehouseId } : scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {})
      },
      orderBy: [{ createdAt: "desc" }],
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
                category: { select: { id: true, name: true } }
              }
            }
          }
        },
        payments: true
      }
    })
  ]);

  const filteredSellers = sellers.map((seller) => ({
    id: seller.id,
    fullName: seller.fullName,
    warehouseId: seller.warehouseId,
    warehouseName: seller.warehouse?.name ?? "",
    commissionRate: Number(seller.commissionRate),
    categoryNames: seller.categories.map((item) => item.category.name)
  }));

  const salesForScope = sales.filter((sale) => normalizeSellerName(sale.sellerName));

  const sellerRows = filteredSellers.map((seller) => {
    const matchedSales = salesForScope.filter((sale) => normalizeSellerName(sale.sellerName) === normalizeSellerName(seller.fullName));
    const activeSales = matchedSales.filter((sale) => completedStatuses.has(sale.status));
    const refundedSales = matchedSales.filter((sale) => sale.status === "REFUNDED");
    const cancelledSales = matchedSales.filter((sale) => sale.status === "CANCELLED");

    const turnoverAmount = sumBy(activeSales, (sale) => Number(sale.totalAmount));
    const subtotalHt = sumBy(activeSales, (sale) => Number(sale.subtotal));
    const taxAmount = sumBy(activeSales, (sale) => Number(sale.taxAmount));
    const discountAmount = sumBy(activeSales, (sale) => Number(sale.discountAmount));
    const shippingFee = sumBy(activeSales, (sale) => Number(sale.shippingFee));
    const paidAmount = sumBy(activeSales, (sale) => Number(sale.paidAmount));
    const remainingAmount = sumBy(activeSales, (sale) => Math.max(Number(sale.totalAmount) - Number(sale.paidAmount), 0));
    const itemsSold = activeSales.reduce((sum, sale) => sum + sale.items.reduce((lineSum, item) => lineSum + item.quantity, 0), 0);
    const ticketsCount = activeSales.length;
    const averageBasket = ticketsCount ? round2(turnoverAmount / ticketsCount) : 0;
    const averageBasketHt = ticketsCount ? round2(subtotalHt / ticketsCount) : 0;
    const averageItemsPerTicket = ticketsCount ? round2(itemsSold / ticketsCount) : 0;
    const customersCount = new Set(activeSales.map((sale) => sale.customer?.id || sale.customer?.fullName || sale.id)).size;
    const productsCount = new Set(activeSales.flatMap((sale) => sale.items.map((item) => item.productId))).size;

    const paymentMap = new Map<string, { method: string; label: string; amount: number }>();
    const categoryMap = new Map<string, { id: string | null; name: string; quantity: number; revenue: number }>();
    const productMap = new Map<string, { productId: string; reference: string; name: string; quantity: number; revenue: number }>();
    const salesByDayMap = new Map<string, { date: string; revenue: number; tickets: number }>();

    for (const sale of activeSales) {
      for (const payment of sale.payments.filter((entry) => entry.direction === "IN")) {
        const key = String(payment.method).trim().toUpperCase();
        const current = paymentMap.get(key) ?? { method: key, label: paymentMethodLabel(key), amount: 0 };
        current.amount += Number(payment.amount);
        paymentMap.set(key, current);
      }

      for (const item of sale.items) {
        const categoryKey = item.product.category?.id ?? "uncategorized";
        const categoryCurrent = categoryMap.get(categoryKey) ?? {
          id: item.product.category?.id ?? null,
          name: item.product.category?.name ?? "Sans categorie",
          quantity: 0,
          revenue: 0
        };
        categoryCurrent.quantity += item.quantity;
        categoryCurrent.revenue += Number(item.lineTotal);
        categoryMap.set(categoryKey, categoryCurrent);

        const productCurrent = productMap.get(item.productId) ?? {
          productId: item.productId,
          reference: item.product.reference,
          name: item.product.name,
          quantity: 0,
          revenue: 0
        };
        productCurrent.quantity += item.quantity;
        productCurrent.revenue += Number(item.lineTotal);
        productMap.set(item.productId, productCurrent);
      }

      const dayKey = sale.createdAt.toISOString().slice(0, 10);
      const daily = salesByDayMap.get(dayKey) ?? { date: dayKey, revenue: 0, tickets: 0 };
      daily.revenue += Number(sale.totalAmount);
      daily.tickets += 1;
      salesByDayMap.set(dayKey, daily);
    }

    const paymentBreakdown = sortByAmountDesc(
      Array.from(paymentMap.values()).map((entry) => ({ ...entry, amount: round2(entry.amount) }))
    );
    const categorySummary = sortByAmountDesc(
      Array.from(categoryMap.values()).map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
    );
    const topProducts = sortByAmountDesc(
      Array.from(productMap.values()).map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
    ).slice(0, 8);
    const salesByDay = Array.from(salesByDayMap.values())
      .map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
      .sort((left, right) => left.date.localeCompare(right.date));
    const bestDay = sortByAmountDesc(salesByDay.map((entry) => ({ ...entry, amount: entry.revenue })))[0] ?? null;
    const dominantPayment = paymentBreakdown[0] ?? null;
    const topCategory = categorySummary[0] ?? null;

    return {
      seller: {
        id: seller.id,
        fullName: seller.fullName,
        warehouseId: seller.warehouseId,
        warehouseName: seller.warehouseName,
        commissionRate: seller.commissionRate,
        categoryNames: seller.categoryNames
      },
      metrics: {
        ticketsCount,
        itemsSold,
        turnoverAmount,
        subtotalHt,
        taxAmount,
        discountAmount,
        shippingFee,
        paidAmount,
        remainingAmount,
        averageBasket,
        averageBasketHt,
        averageItemsPerTicket,
        customersCount,
        productsCount,
        refundedTicketsCount: refundedSales.length,
        refundedAmount: sumBy(refundedSales, (sale) => Number(sale.totalAmount)),
        cancelledTicketsCount: cancelledSales.length,
        cancelledAmount: sumBy(cancelledSales, (sale) => Number(sale.totalAmount)),
        estimatedCommission: round2(turnoverAmount * (seller.commissionRate / 100))
      },
      topCategory,
      dominantPayment,
      paymentBreakdown,
      categorySummary,
      topProducts,
      salesByDay,
      bestDay: bestDay
        ? {
            date: bestDay.date,
            revenue: round2(bestDay.amount ?? 0),
            tickets: bestDay.tickets ?? 0
          }
        : null,
      tickets: activeSales.slice(0, 20).map((sale) => ({
        id: sale.id,
        number: sale.number,
        createdAt: sale.createdAt,
        customerName: sale.customer?.fullName ?? "Client comptoir",
        totalAmount: Number(sale.totalAmount),
        paidAmount: Number(sale.paidAmount),
        remainingAmount: round2(Math.max(Number(sale.totalAmount) - Number(sale.paidAmount), 0)),
        status: sale.status,
        itemsCount: sale.items.reduce((sum, item) => sum + item.quantity, 0),
        note: sale.note ?? ""
      }))
    };
  }).sort((left, right) => {
    if (right.metrics.turnoverAmount !== left.metrics.turnoverAmount) {
      return right.metrics.turnoverAmount - left.metrics.turnoverAmount;
    }
    return left.seller.fullName.localeCompare(right.seller.fullName, "fr");
  });

  const selectedSellerId = query.sellerId ? String(query.sellerId).trim() : "";
  const selectedSellerReport = sellerRows.find((entry) => entry.seller.id === selectedSellerId) ?? sellerRows[0] ?? null;
  const scopeSales = sales.filter((sale) => completedStatuses.has(sale.status));
  const refundedScopeSales = sales.filter((sale) => sale.status === "REFUNDED");
  const cancelledScopeSales = sales.filter((sale) => sale.status === "CANCELLED");
  const scopeCustomers = new Set(scopeSales.map((sale) => sale.customer?.id || sale.customer?.fullName || sale.id)).size;
  const scopeItemsSold = scopeSales.reduce((sum, sale) => sum + sale.items.reduce((lineSum, item) => lineSum + item.quantity, 0), 0);
  const scopeTurnoverAmount = sumBy(scopeSales, (sale) => Number(sale.totalAmount));
  const scopeSubtotalHt = sumBy(scopeSales, (sale) => Number(sale.subtotal));
  const scopeTaxAmount = sumBy(scopeSales, (sale) => Number(sale.taxAmount));
  const scopeDiscountAmount = sumBy(scopeSales, (sale) => Number(sale.discountAmount));
  const scopeShippingFee = sumBy(scopeSales, (sale) => Number(sale.shippingFee));
  const scopePaidAmount = sumBy(scopeSales, (sale) => Number(sale.paidAmount));
  const scopeRemainingAmount = sumBy(scopeSales, (sale) => Math.max(Number(sale.totalAmount) - Number(sale.paidAmount), 0));
  const scopeAverageBasket = scopeSales.length ? round2(scopeTurnoverAmount / scopeSales.length) : 0;
  const scopeAverageItemsPerTicket = scopeSales.length ? round2(scopeItemsSold / scopeSales.length) : 0;
  const scopeProductsCount = new Set(scopeSales.flatMap((sale) => sale.items.map((item) => item.productId))).size;
  const scopePaymentMap = new Map<string, { method: string; label: string; amount: number }>();
  const scopeCategoryMap = new Map<string, { id: string | null; name: string; quantity: number; revenue: number }>();
  const scopeProductMap = new Map<string, { productId: string; reference: string; name: string; quantity: number; revenue: number }>();
  const scopeSalesByDayMap = new Map<string, { date: string; revenue: number; tickets: number }>();

  for (const sale of scopeSales) {
    for (const payment of sale.payments.filter((entry) => entry.direction === "IN")) {
      const key = String(payment.method).trim().toUpperCase();
      const current = scopePaymentMap.get(key) ?? { method: key, label: paymentMethodLabel(key), amount: 0 };
      current.amount += Number(payment.amount);
      scopePaymentMap.set(key, current);
    }

    for (const item of sale.items) {
      const categoryKey = item.product.category?.id ?? "uncategorized";
      const categoryCurrent = scopeCategoryMap.get(categoryKey) ?? {
        id: item.product.category?.id ?? null,
        name: item.product.category?.name ?? "Sans categorie",
        quantity: 0,
        revenue: 0
      };
      categoryCurrent.quantity += item.quantity;
      categoryCurrent.revenue += Number(item.lineTotal);
      scopeCategoryMap.set(categoryKey, categoryCurrent);

      const productCurrent = scopeProductMap.get(item.productId) ?? {
        productId: item.productId,
        reference: item.product.reference,
        name: item.product.name,
        quantity: 0,
        revenue: 0
      };
      productCurrent.quantity += item.quantity;
      productCurrent.revenue += Number(item.lineTotal);
      scopeProductMap.set(item.productId, productCurrent);
    }

    const dayKey = sale.createdAt.toISOString().slice(0, 10);
    const daily = scopeSalesByDayMap.get(dayKey) ?? { date: dayKey, revenue: 0, tickets: 0 };
    daily.revenue += Number(sale.totalAmount);
    daily.tickets += 1;
    scopeSalesByDayMap.set(dayKey, daily);
  }

  const scopePaymentBreakdown = sortByAmountDesc(
    Array.from(scopePaymentMap.values()).map((entry) => ({ ...entry, amount: round2(entry.amount) }))
  );
  const scopeCategorySummary = sortByAmountDesc(
    Array.from(scopeCategoryMap.values()).map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
  );
  const scopeTopProducts = sortByAmountDesc(
    Array.from(scopeProductMap.values()).map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
  ).slice(0, 10);
  const scopeSalesByDay = Array.from(scopeSalesByDayMap.values())
    .map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const scopeBestDay = sortByAmountDesc(scopeSalesByDay.map((entry) => ({ ...entry, amount: entry.revenue })))[0] ?? null;
  const scopeDominantPayment = scopePaymentBreakdown[0] ?? null;
  const scopeTopCategory = scopeCategorySummary[0] ?? null;

  return ok(res, {
    period: {
      dateFrom,
      dateTo,
      isRange: dateFrom !== dateTo
    },
    warehouses,
    sellers: filteredSellers,
    scopeSummary: {
      warehouseId: warehouseId,
      warehouseName: warehouses[0]?.name ?? "Toutes boutiques",
      ticketsCount: scopeSales.length,
      turnoverAmount: scopeTurnoverAmount,
      subtotalHt: scopeSubtotalHt,
      taxAmount: scopeTaxAmount,
      discountAmount: scopeDiscountAmount,
      shippingFee: scopeShippingFee,
      paidAmount: scopePaidAmount,
      remainingAmount: scopeRemainingAmount,
      itemsSold: scopeItemsSold,
      customersCount: scopeCustomers,
      sellersCount: sellerRows.filter((entry) => entry.metrics.ticketsCount > 0).length,
      averageBasket: scopeAverageBasket,
      averageItemsPerTicket: scopeAverageItemsPerTicket,
      productsCount: scopeProductsCount,
      refundedTicketsCount: refundedScopeSales.length,
      refundedAmount: sumBy(refundedScopeSales, (sale) => Number(sale.totalAmount)),
      cancelledTicketsCount: cancelledScopeSales.length,
      cancelledAmount: sumBy(cancelledScopeSales, (sale) => Number(sale.totalAmount)),
      topCategory: scopeTopCategory,
      dominantPayment: scopeDominantPayment,
      paymentBreakdown: scopePaymentBreakdown,
      categorySummary: scopeCategorySummary,
      topProducts: scopeTopProducts,
      salesByDay: scopeSalesByDay,
      bestDay: scopeBestDay
        ? {
            date: scopeBestDay.date,
            revenue: round2(scopeBestDay.amount ?? 0),
            tickets: scopeBestDay.tickets ?? 0
          }
        : null
    },
    sellerRanking: sellerRows.map((entry) => ({
      seller: entry.seller,
      metrics: entry.metrics,
      topCategory: entry.topCategory,
      dominantPayment: entry.dominantPayment
    })),
    selectedSeller: selectedSellerReport
  });
}));

reportsRouter.get("/sales-by-store", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const query = salesByStoreQuerySchema.parse(req.query ?? {});
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const today = getTodayIso();
  const rawDateFrom = isIsoDate(query.dateFrom) ? String(query.dateFrom) : today;
  const rawDateTo = isIsoDate(query.dateTo) ? String(query.dateTo) : rawDateFrom;
  const [dateFrom, dateTo] = rawDateFrom <= rawDateTo ? [rawDateFrom, rawDateTo] : [rawDateTo, rawDateFrom];

  const sales = await prisma.sale.findMany({
    where: {
      createdAt: {
        gte: toStartOfDay(dateFrom),
        lte: toEndOfDay(dateTo)
      },
      ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {})
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      customer: { select: { id: true, fullName: true } },
      warehouse: { select: { id: true, name: true, code: true } },
      items: {
        include: {
          product: {
            select: {
              category: { select: { id: true, name: true } }
            }
          }
        }
      }
    }
  });

  const byStore = new Map<string, {
    warehouse: { id: string; name: string; code: string };
    ticketsCount: number;
    turnoverAmount: number;
    paidAmount: number;
    itemsSold: number;
    customers: Set<string>;
    sellers: Set<string>;
    discountAmount: number;
    shippingFee: number;
    topCategoryName: string;
    topCategoryRevenue: number;
    topCategoryMap: Map<string, { name: string; revenue: number }>;
  }>();

  for (const sale of sales.filter((entry) => completedStatuses.has(entry.status))) {
    const current = byStore.get(sale.warehouseId) ?? {
      warehouse: { id: sale.warehouse.id, name: sale.warehouse.name, code: sale.warehouse.code },
      ticketsCount: 0,
      turnoverAmount: 0,
      paidAmount: 0,
      itemsSold: 0,
      customers: new Set<string>(),
      sellers: new Set<string>(),
      discountAmount: 0,
      shippingFee: 0,
      topCategoryName: "",
      topCategoryRevenue: 0,
      topCategoryMap: new Map<string, { name: string; revenue: number }>()
    };

    current.ticketsCount += 1;
    current.turnoverAmount += Number(sale.totalAmount);
    current.paidAmount += Number(sale.paidAmount);
    current.discountAmount += Number(sale.discountAmount);
    current.shippingFee += Number(sale.shippingFee);
    current.itemsSold += sale.items.reduce((sum, item) => sum + item.quantity, 0);
    current.customers.add(sale.customer?.id || sale.customer?.fullName || sale.id);
    if (normalizeSellerName(sale.sellerName)) {
      current.sellers.add(normalizeSellerName(sale.sellerName));
    }

    for (const item of sale.items) {
      const key = item.product.category?.id ?? "uncategorized";
      const categoryCurrent = current.topCategoryMap.get(key) ?? {
        name: item.product.category?.name ?? "Sans categorie",
        revenue: 0
      };
      categoryCurrent.revenue += Number(item.lineTotal);
      current.topCategoryMap.set(key, categoryCurrent);
    }

    byStore.set(sale.warehouseId, current);
  }

  const boutiques = Array.from(byStore.values()).map((entry) => {
    const topCategory = sortByAmountDesc(
      Array.from(entry.topCategoryMap.values()).map((category) => ({ ...category, amount: round2(category.revenue) }))
    )[0] ?? null;

    return {
      warehouse: entry.warehouse,
      ticketsCount: entry.ticketsCount,
      turnoverAmount: round2(entry.turnoverAmount),
      paidAmount: round2(entry.paidAmount),
      itemsSold: entry.itemsSold,
      customersCount: entry.customers.size,
      sellersCount: entry.sellers.size,
      averageBasket: entry.ticketsCount ? round2(entry.turnoverAmount / entry.ticketsCount) : 0,
      discountAmount: round2(entry.discountAmount),
      shippingFee: round2(entry.shippingFee),
      topCategoryName: topCategory?.name ?? "Sans categorie",
      topCategoryRevenue: topCategory ? round2(topCategory.amount ?? 0) : 0
    };
  }).sort((left, right) => right.turnoverAmount - left.turnoverAmount);

  return ok(res, {
    period: {
      dateFrom,
      dateTo,
      isRange: dateFrom !== dateTo
    },
    boutiques
  });
}));

reportsRouter.get("/summary", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const salesWhere = scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined;
  const purchasesWhere = scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined;
  const productsWhere = scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined;
  const sales = await prisma.sale.findMany({ where: salesWhere, include: { warehouse: true, items: { include: { product: true } }, customer: true } });
  const purchases = await prisma.purchase.findMany({ where: purchasesWhere });
  const products = await prisma.product.findMany({ where: productsWhere });
  const salesByStore = Object.values(sales.reduce<Record<string, { label: string; revenue: number; tickets: number }>>((acc, sale) => {
    const current = acc[sale.warehouseId] ?? { label: sale.warehouse.name, revenue: 0, tickets: 0 };
    current.revenue += Number(sale.totalAmount);
    current.tickets += 1;
    acc[sale.warehouseId] = current;
    return acc;
  }, {}));
  const topProducts = Object.values(sales.flatMap((sale) => sale.items).reduce<Record<string, { label: string; quantity: number; revenue: number }>>((acc, item) => {
    const current = acc[item.productId] ?? { label: item.product.name, quantity: 0, revenue: 0 };
    current.quantity += item.quantity;
    current.revenue += Number(item.lineTotal);
    acc[item.productId] = current;
    return acc;
  }, {})).sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  return ok(res, {
    salesByStore,
    stockValuation: products.reduce((sum, product) => sum + product.stockOnHand * Number(product.purchasePriceTtc), 0),
    purchasesAmount: purchases.reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0),
    topProducts,
    lowStock: products.filter((product) => product.stockOnHand <= product.minStock)
  });
}));
