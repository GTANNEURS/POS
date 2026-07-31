import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, ok } from "../../common/http.js";
import { authenticate, getScopedWarehouseId, requirePermissions, type AuthenticatedRequest } from "../../common/auth.js";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate, requirePermissions("dashboard_view"));

dashboardRouter.get("/overview", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
  const scopedWarehouseId = getScopedWarehouseId(req.currentUser);
  const salesWhere = scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined;
  const productsWhere = scopedWarehouseId ? { warehouseId: scopedWarehouseId } : undefined;
  const stores = await prisma.warehouse.findMany({ where: { type: "STORE", ...(scopedWarehouseId ? { id: scopedWarehouseId } : {}) }, include: { sales: { where: salesWhere } } });
  const products = await prisma.product.findMany({ where: productsWhere, orderBy: { stockOnHand: "asc" }, take: 10 });
  const recentSales = await prisma.sale.findMany({ where: salesWhere, take: 8, orderBy: { createdAt: "desc" }, include: { customer: true, warehouse: true } });
  const saleItems = await prisma.saleItem.findMany({ where: scopedWarehouseId ? { sale: { warehouseId: scopedWarehouseId } } : undefined, include: { product: true } });
  const customers = await prisma.customer.findMany({ include: { sales: { where: salesWhere } } });
  const topProducts = Object.values(saleItems.reduce<Record<string, { label: string; quantity: number; revenue: number }>>((acc, item) => { const current = acc[item.productId] ?? { label: item.product.name, quantity: 0, revenue: 0 }; current.quantity += item.quantity; current.revenue += Number(item.lineTotal); acc[item.productId] = current; return acc; }, {})).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  const topCustomers = customers.map((customer) => ({ label: customer.fullName, revenue: customer.sales.reduce((sum, sale) => sum + Number(sale.totalAmount), 0) })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  return ok(res, {
    kpis: {
      todayRevenue: recentSales.filter((sale) => sale.createdAt >= startOfDay).reduce((sum, sale) => sum + Number(sale.totalAmount), 0),
      monthRevenue: recentSales.filter((sale) => sale.createdAt >= startOfMonth).reduce((sum, sale) => sum + Number(sale.totalAmount), 0),
      ticketsCount: await prisma.sale.count({ where: salesWhere }),
      outOfStockCount: products.filter((product) => product.stockOnHand <= 0).length,
      lowStockCount: products.filter((product) => product.stockOnHand > 0 && product.stockOnHand <= product.minStock).length
    },
    byStore: stores.map((store) => ({ id: store.id, name: store.name, todayRevenue: store.sales.filter((sale) => sale.createdAt >= startOfDay).reduce((sum, sale) => sum + Number(sale.totalAmount), 0), monthRevenue: store.sales.filter((sale) => sale.createdAt >= startOfMonth).reduce((sum, sale) => sum + Number(sale.totalAmount), 0), ticketsCount: store.sales.length })),
    topProducts,
    topCustomers,
    recentActivity: recentSales.map((sale) => ({ id: sale.id, number: sale.number, customer: sale.customer?.fullName ?? "Client comptoir", warehouse: sale.warehouse.name, total: sale.totalAmount, createdAt: sale.createdAt }))
  });
}));
