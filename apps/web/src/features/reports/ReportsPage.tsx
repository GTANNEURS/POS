import { useEffect, useMemo, useState } from "react";
import { Printer, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select, StatCard } from "../../components/ui/primitives";
import { api } from "../../lib/api";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { useAuth } from "../../providers/AuthProvider";

type ReportsData = {
  salesByStore: Array<{ label: string; revenue: number; tickets: number }>;
  stockValuation: number;
  purchasesAmount: number;
  topProducts: Array<{ label: string; quantity: number; revenue: number }>;
  lowStock: Array<{ id: string; name: string; stockOnHand: number; minStock: number }>;
};

type ReportWarehouse = {
  id: string;
  name: string;
  code: string;
  type: string;
};

type ReportSeller = {
  id: string;
  fullName: string;
  warehouseId: string | null;
  warehouseName: string;
  commissionRate: number;
  categoryNames: string[];
};

type CashRegister = { id: string; name: string; warehouseId: string };
type CashReportType = "X" | "Y";
type CashAdminTab = "report-end-day" | "report-periodic" | "history" | "registers";
type PosCashReport = {
  date: string;
  period: { dateFrom: string; dateTo: string; isRange: boolean };
  warehouse: { id: string; name: string; code: string };
  register: { id: string; name: string } | null;
  session: {
    id: string;
    openingAmount: number;
    closingAmount: number | null;
    expectedAmount: number | null;
    varianceAmount: number | null;
    status: string;
    openedAt: string;
    closedAt: string | null;
    openedBy: { id: string; fullName: string };
    openingBreakdown: Array<{ currencyCode: string; amount: number; amountMad: number; rateFromMad: number }>;
    closingBreakdown: Array<{ currencyCode: string; amount: number; amountMad: number; rateFromMad: number }>;
  } | null;
  totals: {
    ticketsCount: number;
    articlesSold: number;
    subtotalHt: number;
    taxAmount: number;
    discountAmount: number;
    shippingFee: number;
    totalAmount: number;
    paidAmount: number;
    openingFund: number;
    cashTheoretical: number;
  };
  reportBreakdown: {
    totalDayNet: number;
    cardAmount: number;
    cashAmount: number;
    foreignAmount: number;
    euroAmount: number;
    usdAmount: number;
    voucherAmount: number;
    creditAmount: number;
    transferAmount: number;
    chequeAmount: number;
    cashChangeMad: number;
    foreignChangeMad: number;
    openingCashMad: number;
    openingForeignMad: number;
  };
  paymentSummary: PaymentBreakdownEntry[];
  categorySummary: Array<{
    categoryId: string | null;
    categoryName: string;
    quantity: number;
    totalAmount: number;
    articles: Array<{
      productId: string;
      reference: string;
      name: string;
      quantity: number;
      totalAmount: number;
    }>;
  }>;
};

type PosCashSessionsOverview = {
  date: string;
  warehouse: { id: string; name: string; code: string };
  history: Array<{
    id: string;
    register: { id: string; name: string };
    warehouse: { id: string; name: string };
    status: string;
    openedAt: string;
    closedAt: string | null;
    openingAmount: number;
    closingAmount: number | null;
    expectedAmount: number | null;
    varianceAmount: number | null;
    openedBy: { id: string; fullName: string };
    closedBy: { id: string; fullName: string } | null;
    turnoverAmount: number;
    paidAmount: number;
    ticketsCount: number;
  }>;
  registers: Array<{
    register: { id: string; name: string };
    warehouse?: { id: string; name: string; code?: string };
    status: string;
    openedAt: string | null;
    closedAt: string | null;
    openedBy: { id: string; fullName: string } | null;
    turnoverAmount: number;
    paidAmount: number;
    ticketsCount: number;
    openingAmount: number;
    closingAmount: number | null;
  }>;
};

type LiveCashRegisterCard = {
  register: { id: string; name: string };
  warehouse: { id: string; name: string; code?: string };
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  openedBy: { id: string; fullName: string } | null;
  turnoverAmount: number;
  paidAmount: number;
  ticketsCount: number;
  openingAmount: number;
  closingAmount: number | null;
};

type PaymentBreakdownEntry = {
  method: string;
  label: string;
  amount: number;
};

type CategorySummaryEntry = {
  id: string | null;
  name: string;
  quantity: number;
  revenue: number;
};

type ProductSummaryEntry = {
  productId: string;
  reference: string;
  name: string;
  quantity: number;
  revenue: number;
};

type SalesDayEntry = {
  date: string;
  revenue: number;
  tickets: number;
};

type SummaryScope = {
  warehouseId: string | null;
  warehouseName: string;
  ticketsCount: number;
  turnoverAmount: number;
  subtotalHt: number;
  taxAmount: number;
  discountAmount: number;
  shippingFee: number;
  paidAmount: number;
  remainingAmount: number;
  itemsSold: number;
  customersCount: number;
  sellersCount: number;
  averageBasket: number;
  averageItemsPerTicket: number;
  productsCount: number;
  refundedTicketsCount: number;
  refundedAmount: number;
  cancelledTicketsCount: number;
  cancelledAmount: number;
  topCategory: CategorySummaryEntry | null;
  dominantPayment: PaymentBreakdownEntry | null;
  paymentBreakdown: PaymentBreakdownEntry[];
  categorySummary: CategorySummaryEntry[];
  topProducts: ProductSummaryEntry[];
  salesByDay: SalesDayEntry[];
  bestDay: SalesDayEntry | null;
};

type SellerSalesBootstrap = {
  warehouses: ReportWarehouse[];
  sellers: ReportSeller[];
};

type SellerMetrics = {
  ticketsCount: number;
  itemsSold: number;
  turnoverAmount: number;
  subtotalHt: number;
  taxAmount: number;
  discountAmount: number;
  shippingFee: number;
  paidAmount: number;
  remainingAmount: number;
  averageBasket: number;
  averageBasketHt: number;
  averageItemsPerTicket: number;
  customersCount: number;
  productsCount: number;
  refundedTicketsCount: number;
  refundedAmount: number;
  cancelledTicketsCount: number;
  cancelledAmount: number;
  estimatedCommission: number;
};

type SellerRankingEntry = {
  seller: ReportSeller;
  metrics: SellerMetrics;
  topCategory: CategorySummaryEntry | null;
  dominantPayment: PaymentBreakdownEntry | null;
};

type SellerDetailReport = {
  seller: ReportSeller;
  metrics: SellerMetrics;
  topCategory: CategorySummaryEntry | null;
  dominantPayment: PaymentBreakdownEntry | null;
  paymentBreakdown: PaymentBreakdownEntry[];
  categorySummary: CategorySummaryEntry[];
  topProducts: ProductSummaryEntry[];
  salesByDay: SalesDayEntry[];
  bestDay: SalesDayEntry | null;
  tickets: Array<{
    id: string;
    number: string;
    createdAt: string;
    customerName: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    status: string;
    itemsCount: number;
    note: string;
  }>;
};

type SellerSalesReportData = {
  period: { dateFrom: string; dateTo: string; isRange: boolean };
  warehouses: ReportWarehouse[];
  sellers: ReportSeller[];
  scopeSummary: SummaryScope;
  sellerRanking: SellerRankingEntry[];
  selectedSeller: SellerDetailReport | null;
};

type StoreComparisonData = {
  period: { dateFrom: string; dateTo: string; isRange: boolean };
  boutiques: Array<{
    warehouse: { id: string; name: string; code: string };
    ticketsCount: number;
    turnoverAmount: number;
    paidAmount: number;
    itemsSold: number;
    customersCount: number;
    sellersCount: number;
    averageBasket: number;
    discountAmount: number;
    shippingFee: number;
    topCategoryName: string;
    topCategoryRevenue: number;
  }>;
};

type PeriodPreset = "day" | "week" | "month" | "year" | "custom";
type ReportsView = "seller" | "summary" | "detail";

const chartColors = ["#ff9b42", "#ff7a00", "#ffbf80", "#d96b00", "#f0c48f", "#ffb970"];

function toIsoLocal(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPeriodRange(preset: PeriodPreset, customDateFrom: string, customDateTo: string) {
  const now = new Date();
  if (preset === "custom") {
    const fallback = toIsoLocal(now);
    const from = customDateFrom || fallback;
    const to = customDateTo || from;
    return from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from };
  }

  if (preset === "day") {
    const today = toIsoLocal(now);
    return { dateFrom: today, dateTo: today };
  }

  if (preset === "week") {
    const base = new Date(now);
    const day = base.getDay();
    const delta = day === 0 ? 6 : day - 1;
    base.setDate(base.getDate() - delta);
    return { dateFrom: toIsoLocal(base), dateTo: toIsoLocal(now) };
  }

  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: toIsoLocal(start), dateTo: toIsoLocal(now) };
  }

  const start = new Date(now.getFullYear(), 0, 1);
  return { dateFrom: toIsoLocal(start), dateTo: toIsoLocal(now) };
}

function formatForeignCurrency(amount: number, code: string) {
  return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
}

export function ReportsPage() {
  const { user } = useAuth();
  const lowStockPageSize = 6;
  const topProductsPageSize = 5;
  const [view, setView] = useState<ReportsView>("summary");
  const [summary, setSummary] = useState<ReportsData | null>(null);
  const [bootstrap, setBootstrap] = useState<SellerSalesBootstrap | null>(null);
  const [sellerReport, setSellerReport] = useState<SellerSalesReportData | null>(null);
  const [globalSellerReport, setGlobalSellerReport] = useState<SellerSalesReportData | null>(null);
  const [storeComparison, setStoreComparison] = useState<StoreComparisonData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [sellerLoading, setSellerLoading] = useState(true);
  const [globalSellerLoading, setGlobalSellerLoading] = useState(true);
  const [storeComparisonLoading, setStoreComparisonLoading] = useState(true);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("day");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [compareSellerId, setCompareSellerId] = useState("");
  const [lowStockPage, setLowStockPage] = useState(1);
  const [topProductsPage, setTopProductsPage] = useState(1);
  const [cashReportModalOpen, setCashReportModalOpen] = useState(false);
  const [cashReportLoading, setCashReportLoading] = useState(false);
  const [cashAdminTab, setCashAdminTab] = useState<CashAdminTab>("report-end-day");
  const [cashReportType, setCashReportType] = useState<CashReportType>("Y");
  const [cashReportDate, setCashReportDate] = useState("");
  const [cashReportDateFrom, setCashReportDateFrom] = useState("");
  const [cashReportDateTo, setCashReportDateTo] = useState("");
  const [cashReportWarehouseId, setCashReportWarehouseId] = useState("");
  const [cashReportRegisterId, setCashReportRegisterId] = useState("");
  const [cashReportRegisters, setCashReportRegisters] = useState<CashRegister[]>([]);
  const [cashReportData, setCashReportData] = useState<PosCashReport | null>(null);
  const [cashSessionsOverview, setCashSessionsOverview] = useState<PosCashSessionsOverview | null>(null);
  const [cashReportMessage, setCashReportMessage] = useState<string | null>(null);
  const [liveCashModalOpen, setLiveCashModalOpen] = useState(false);
  const [liveCashLoading, setLiveCashLoading] = useState(false);
  const [liveCashMessage, setLiveCashMessage] = useState<string | null>(null);
  const [liveCashRegisters, setLiveCashRegisters] = useState<LiveCashRegisterCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    setBootstrapLoading(true);
    Promise.all([
      api<ReportsData>("/reports/summary"),
      api<SellerSalesBootstrap>("/reports/sales-by-seller/bootstrap")
    ])
      .then(([summaryData, bootstrapData]) => {
        if (cancelled) return;
        setSummary(summaryData);
        setBootstrap(bootstrapData);
        if (!selectedWarehouseId && bootstrapData.warehouses.length) {
          setSelectedWarehouseId(bootstrapData.warehouses[0].id);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setSummaryLoading(false);
        setBootstrapLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sellerOptions = useMemo(() => {
    if (!bootstrap) return [];
    if (!selectedWarehouseId) return bootstrap.sellers;
    return bootstrap.sellers.filter((seller) => seller.warehouseId === selectedWarehouseId);
  }, [bootstrap, selectedWarehouseId]);

  useEffect(() => {
    if (!sellerOptions.length) {
      if (selectedSellerId) setSelectedSellerId("");
      return;
    }
    if (!selectedSellerId || !sellerOptions.some((seller) => seller.id === selectedSellerId)) {
      setSelectedSellerId(sellerOptions[0].id);
    }
  }, [sellerOptions, selectedSellerId]);

  useEffect(() => {
    if (!sellerReport?.sellerRanking.length) {
      if (compareSellerId) setCompareSellerId("");
      return;
    }
    const candidates = sellerReport.sellerRanking.filter((entry) => entry.seller.id !== selectedSellerId);
    if (!candidates.length) {
      if (compareSellerId) setCompareSellerId("");
      return;
    }
    if (!compareSellerId || !candidates.some((entry) => entry.seller.id === compareSellerId)) {
      setCompareSellerId(candidates[0].seller.id);
    }
  }, [sellerReport, selectedSellerId, compareSellerId]);

  const activeRange = useMemo(
    () => getPeriodRange(periodPreset, customDateFrom, customDateTo),
    [periodPreset, customDateFrom, customDateTo]
  );

  const loadSellerReport = async (silent = false) => {
    if (!bootstrap) return;
    if (!silent) setSellerLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedWarehouseId) params.set("warehouseId", selectedWarehouseId);
      if (selectedSellerId) params.set("sellerId", selectedSellerId);
      params.set("dateFrom", activeRange.dateFrom);
      params.set("dateTo", activeRange.dateTo);
      const data = await api<SellerSalesReportData>(`/reports/sales-by-seller?${params.toString()}`);
      setSellerReport(data);
    } finally {
      setSellerLoading(false);
    }
  };

  const loadGlobalSellerReport = async () => {
    if (!bootstrap) return;
    setGlobalSellerLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("dateFrom", activeRange.dateFrom);
      params.set("dateTo", activeRange.dateTo);
      const data = await api<SellerSalesReportData>(`/reports/sales-by-seller?${params.toString()}`);
      setGlobalSellerReport(data);
    } finally {
      setGlobalSellerLoading(false);
    }
  };

  const loadStoreComparison = async () => {
    setStoreComparisonLoading(true);
    const params = new URLSearchParams();
    params.set("dateFrom", activeRange.dateFrom);
    params.set("dateTo", activeRange.dateTo);
    try {
      const data = await api<StoreComparisonData>(`/reports/sales-by-store?${params.toString()}`);
      setStoreComparison(data);
    } finally {
      setStoreComparisonLoading(false);
    }
  };

  useEffect(() => {
    if (!bootstrap) return;
    loadSellerReport();
  }, [bootstrap, selectedWarehouseId, selectedSellerId, activeRange.dateFrom, activeRange.dateTo]);

  useEffect(() => {
    if (!bootstrap) return;
    void loadStoreComparison();
  }, [bootstrap, activeRange.dateFrom, activeRange.dateTo]);

  useEffect(() => {
    if (!bootstrap) return;
    void loadGlobalSellerReport();
  }, [bootstrap, activeRange.dateFrom, activeRange.dateTo]);

  const topSellerChart = useMemo(
    () => (sellerReport?.sellerRanking ?? []).slice(0, 8).map((entry) => ({
      label: entry.seller.fullName,
      ca: entry.metrics.turnoverAmount,
      tickets: entry.metrics.ticketsCount
    })),
    [sellerReport]
  );
  const compareSeller = useMemo(
    () => sellerReport?.sellerRanking.find((entry) => entry.seller.id === compareSellerId) ?? null,
    [sellerReport, compareSellerId]
  );
  const compareSellerOptions = useMemo(
    () => (sellerReport?.sellerRanking ?? []).filter((entry) => entry.seller.id !== selectedSellerId),
    [sellerReport, selectedSellerId]
  );
  const boutiqueChart = useMemo(
    () => (storeComparison?.boutiques ?? []).map((entry) => ({
      label: entry.warehouse.name,
      ca: entry.turnoverAmount,
      tickets: entry.ticketsCount
    })),
    [storeComparison]
  );
  const globalTopSellerChart = useMemo(
    () => (globalSellerReport?.sellerRanking ?? []).slice(0, 8).map((entry) => ({
      label: entry.seller.fullName,
      ca: entry.metrics.turnoverAmount
    })),
    [globalSellerReport]
  );
  const canSeeCashAdmin = useMemo(
    () => (user?.roles ?? []).some((role) => ["admin", "manager"].includes(String(role).toLowerCase())),
    [user]
  );
  const reportRegisters = useMemo(
    () => cashReportRegisters.filter((register) => !cashReportWarehouseId || register.warehouseId === cashReportWarehouseId),
    [cashReportRegisters, cashReportWarehouseId]
  );
  const summaryLowStock = summary?.lowStock ?? [];
  const summaryTopProducts = useMemo(
    () => globalSellerReport?.scopeSummary.topProducts.map((entry) => ({
      id: entry.productId,
      label: `${entry.reference} - ${entry.name}`,
      quantity: entry.quantity,
      revenue: entry.revenue
    })) ?? summary?.topProducts.map((entry) => ({
      id: entry.label,
      label: entry.label,
      quantity: entry.quantity,
      revenue: entry.revenue
    })) ?? [],
    [globalSellerReport, summary]
  );
  const lowStockTotalPages = Math.max(1, Math.ceil(summaryLowStock.length / lowStockPageSize));
  const topProductsTotalPages = Math.max(1, Math.ceil(summaryTopProducts.length / topProductsPageSize));
  const lowStockItems = useMemo(
    () => summaryLowStock.slice((lowStockPage - 1) * lowStockPageSize, lowStockPage * lowStockPageSize),
    [summaryLowStock, lowStockPage]
  );
  const topProductsItems = useMemo(
    () => summaryTopProducts.slice((topProductsPage - 1) * topProductsPageSize, topProductsPage * topProductsPageSize),
    [summaryTopProducts, topProductsPage]
  );

  useEffect(() => {
    setLowStockPage((current) => Math.min(current, lowStockTotalPages));
  }, [lowStockTotalPages]);

  useEffect(() => {
    setTopProductsPage((current) => Math.min(current, topProductsTotalPages));
  }, [topProductsTotalPages]);

  useEffect(() => {
    const today = toIsoLocal(new Date());
    if (!cashReportDate) setCashReportDate(today);
    if (!cashReportDateFrom) setCashReportDateFrom(today);
    if (!cashReportDateTo) setCashReportDateTo(today);
  }, [cashReportDate, cashReportDateFrom, cashReportDateTo]);

  useEffect(() => {
    if (!cashReportWarehouseId && selectedWarehouseId) {
      setCashReportWarehouseId(selectedWarehouseId);
    }
  }, [cashReportWarehouseId, selectedWarehouseId]);

  useEffect(() => {
    if (!cashReportWarehouseId && bootstrap?.warehouses?.length) {
      setCashReportWarehouseId(bootstrap.warehouses[0].id);
    }
  }, [cashReportWarehouseId, bootstrap]);

  useEffect(() => {
    if (!reportRegisters.length) {
      if (cashReportRegisterId) setCashReportRegisterId("");
      return;
    }
    if (!reportRegisters.some((register) => register.id === cashReportRegisterId)) {
      setCashReportRegisterId(reportRegisters[0]?.id ?? "");
    }
  }, [reportRegisters, cashReportRegisterId]);

  function exportSellerRankingCsv() {
    if (!sellerReport) return;
    const rows: string[][] = [
      ["Classement vendeurs", sellerReport.scopeSummary.warehouseName],
      ["Periode debut", sellerReport.period.dateFrom],
      ["Periode fin", sellerReport.period.dateTo],
      [],
      ["Vendeur", "Boutique", "Commandes", "Articles", "CA", "Panier moyen", "Encaisse", "Reste", "Commission estimee", "Top categorie", "Paiement dominant"]
    ];
    sellerReport.sellerRanking.forEach((entry) => {
      rows.push([
        entry.seller.fullName,
        entry.seller.warehouseName || sellerReport.scopeSummary.warehouseName,
        String(entry.metrics.ticketsCount),
        String(entry.metrics.itemsSold),
        String(entry.metrics.turnoverAmount),
        String(entry.metrics.averageBasket),
        String(entry.metrics.paidAmount),
        String(entry.metrics.remainingAmount),
        String(entry.metrics.estimatedCommission),
        entry.topCategory?.name ?? "",
        entry.dominantPayment?.label ?? ""
      ]);
    });
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`).join(";")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `classement-vendeurs-${sellerReport.period.dateFrom}-${sellerReport.period.dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function printSellerRankingReport() {
    if (!sellerReport) return;
    const popup = window.open("", "_blank", "width=1100,height=900");
    if (!popup) return;
    const rankingRows = sellerReport.sellerRanking.map((entry, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${entry.seller.fullName}</td>
        <td>${entry.seller.warehouseName || sellerReport.scopeSummary.warehouseName}</td>
        <td style="text-align:right;">${formatNumber(entry.metrics.ticketsCount)}</td>
        <td style="text-align:right;">${formatNumber(entry.metrics.itemsSold)}</td>
        <td style="text-align:right;">${formatCurrency(entry.metrics.turnoverAmount)}</td>
        <td style="text-align:right;">${formatCurrency(entry.metrics.averageBasket)}</td>
        <td style="text-align:right;">${formatCurrency(entry.metrics.paidAmount)}</td>
        <td style="text-align:right;">${formatCurrency(entry.metrics.estimatedCommission)}</td>
      </tr>
    `).join("");
    popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Classement vendeurs</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            body { font-family: Arial, sans-serif; color: #1b1713; margin: 0; }
            .head { display:flex; justify-content:space-between; gap:20px; border-bottom:2px solid #e5d2bf; padding-bottom:12px; }
            .head h1 { margin:0; font-size:28px; }
            .tag { font-size:11px; text-transform:uppercase; letter-spacing:.28em; color:#a96d2f; font-weight:700; }
            .meta { margin-top:8px; color:#6f6054; font-size:12px; }
            table { width:100%; border-collapse:collapse; margin-top:18px; }
            th, td { border:1px solid #e6d8ca; padding:8px 10px; font-size:12px; }
            th { background:#f8efe8; font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:#7d6148; text-align:left; }
          </style>
        </head>
        <body>
          <div class="head">
            <div>
              <div class="tag">Rapports / Ventes vendeurs</div>
              <h1>Classement vendeurs</h1>
              <div class="meta">${sellerReport.scopeSummary.warehouseName}</div>
            </div>
            <div style="text-align:right;">
              <div class="tag">Periode</div>
              <div class="meta">${formatDate(sellerReport.period.dateFrom)}${sellerReport.period.isRange ? ` - ${formatDate(sellerReport.period.dateTo)}` : ""}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Vendeur</th>
                <th>Boutique</th>
                <th style="text-align:right;">Commandes</th>
                <th style="text-align:right;">Articles</th>
                <th style="text-align:right;">CA</th>
                <th style="text-align:right;">Panier moyen</th>
                <th style="text-align:right;">Encaisse</th>
                <th style="text-align:right;">Commission</th>
              </tr>
            </thead>
            <tbody>${rankingRows || `<tr><td colspan="9">Aucun vendeur</td></tr>`}</tbody>
          </table>
          <script>
            window.onload = function () {
              window.print();
              setTimeout(function () { window.close(); }, 200);
            };
          </script>
        </body>
      </html>
    `);
    popup.document.close();
  }

  function exportSelectedSellerCsv() {
    if (!sellerReport?.selectedSeller) return;
    const selected = sellerReport.selectedSeller;
    const rows: string[][] = [
      ["Rapport vendeur", selected.seller.fullName],
      ["Boutique", selected.seller.warehouseName || sellerReport.scopeSummary.warehouseName],
      ["Periode debut", sellerReport.period.dateFrom],
      ["Periode fin", sellerReport.period.dateTo],
      [],
      ["Indicateur", "Valeur"],
      ["CA vendeur", String(selected.metrics.turnoverAmount)],
      ["Nombre commande", String(selected.metrics.ticketsCount)],
      ["Articles vendus", String(selected.metrics.itemsSold)],
      ["Panier moyen", String(selected.metrics.averageBasket)],
      ["Clients uniques", String(selected.metrics.customersCount)],
      ["Encaisse", String(selected.metrics.paidAmount)],
      ["Reste a encaisser", String(selected.metrics.remainingAmount)],
      ["Remises", String(selected.metrics.discountAmount)],
      ["Frais de port", String(selected.metrics.shippingFee)],
      ["Commission estimee", String(selected.metrics.estimatedCommission)],
      [],
      ["Mode de paiement", "Montant"]
    ];

    selected.paymentBreakdown.forEach((entry) => {
      rows.push([entry.label, String(entry.amount)]);
    });

    rows.push([], ["Categorie", "Quantite", "CA"]);
    selected.categorySummary.forEach((entry) => {
      rows.push([entry.name, String(entry.quantity), String(entry.revenue)]);
    });

    rows.push([], ["Reference", "Article", "Quantite", "CA"]);
    selected.topProducts.forEach((entry) => {
      rows.push([entry.reference, entry.name, String(entry.quantity), String(entry.revenue)]);
    });

    rows.push([], ["Ticket", "Client", "Articles", "CA", "Encaisse", "Reste", "Date"]);
    selected.tickets.forEach((entry) => {
      rows.push([
        entry.number,
        entry.customerName,
        String(entry.itemsCount),
        String(entry.totalAmount),
        String(entry.paidAmount),
        String(entry.remainingAmount),
        entry.createdAt
      ]);
    });

    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`).join(";")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rapport-vendeur-${selected.seller.fullName.replace(/\s+/g, "-").toLowerCase()}-${sellerReport.period.dateFrom}-${sellerReport.period.dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function printSelectedSellerReport() {
    if (!sellerReport?.selectedSeller) return;
    const selected = sellerReport.selectedSeller;
    const popup = window.open("", "_blank", "width=1100,height=900");
    if (!popup) return;

    const paymentRows = selected.paymentBreakdown.map((entry) => `
      <tr><td>${entry.label}</td><td style="text-align:right;">${formatCurrency(entry.amount)}</td></tr>
    `).join("");
    const categoryRows = selected.categorySummary.map((entry) => `
      <tr><td>${entry.name}</td><td style="text-align:right;">${formatNumber(entry.quantity)}</td><td style="text-align:right;">${formatCurrency(entry.revenue)}</td></tr>
    `).join("");
    const productRows = selected.topProducts.map((entry) => `
      <tr><td>${entry.reference}</td><td>${entry.name}</td><td style="text-align:right;">${formatNumber(entry.quantity)}</td><td style="text-align:right;">${formatCurrency(entry.revenue)}</td></tr>
    `).join("");
    const ticketRows = selected.tickets.map((entry) => `
      <tr><td>${entry.number}</td><td>${entry.customerName}</td><td style="text-align:right;">${formatNumber(entry.itemsCount)}</td><td style="text-align:right;">${formatCurrency(entry.totalAmount)}</td><td style="text-align:right;">${formatCurrency(entry.paidAmount)}</td><td>${formatDateTime(entry.createdAt)}</td></tr>
    `).join("");

    popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Rapport vendeur - ${selected.seller.fullName}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            body { font-family: Arial, sans-serif; color: #1b1713; margin: 0; }
            .page { padding: 0; }
            .head { display:flex; justify-content:space-between; gap:20px; border-bottom:2px solid #e5d2bf; padding-bottom:12px; }
            .head h1 { margin:0; font-size:28px; }
            .head p { margin:6px 0 0; color:#6f6054; font-size:12px; }
            .tag { font-size:11px; text-transform:uppercase; letter-spacing:.28em; color:#a96d2f; font-weight:700; }
            .grid { display:grid; gap:10px; margin-top:16px; grid-template-columns:repeat(4, minmax(0,1fr)); }
            .card { border:1px solid #dfccbb; border-radius:14px; padding:10px 12px; }
            .label { font-size:10px; text-transform:uppercase; letter-spacing:.16em; color:#9a6a38; font-weight:700; }
            .value { margin-top:6px; font-size:15px; font-weight:700; }
            .hint { margin-top:4px; font-size:11px; color:#6f6054; }
            .section { margin-top:18px; }
            .section h2 { margin:0 0 10px; font-size:18px; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #e6d8ca; padding:8px 10px; font-size:12px; }
            th { background:#f8efe8; font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:#7d6148; text-align:left; }
            .two { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="head">
              <div>
                <div class="tag">Rapports / Ventes vendeurs</div>
                <h1>${selected.seller.fullName}</h1>
                <p>${selected.seller.warehouseName || sellerReport.scopeSummary.warehouseName}</p>
              </div>
              <div style="text-align:right;">
                <div class="tag">Periode</div>
                <h1 style="font-size:22px;">${formatDate(sellerReport.period.dateFrom)}${sellerReport.period.isRange ? ` - ${formatDate(sellerReport.period.dateTo)}` : ""}</h1>
                <p>Commission ${selected.seller.commissionRate.toFixed(2)}%</p>
              </div>
            </div>

            <div class="grid">
              <div class="card"><div class="label">CA vendeur</div><div class="value">${formatCurrency(selected.metrics.turnoverAmount)}</div><div class="hint">Total TTC</div></div>
              <div class="card"><div class="label">Nombre commande</div><div class="value">${formatNumber(selected.metrics.ticketsCount)}</div><div class="hint">${formatNumber(selected.metrics.itemsSold)} article(s)</div></div>
              <div class="card"><div class="label">Panier moyen</div><div class="value">${formatCurrency(selected.metrics.averageBasket)}</div><div class="hint">HT moyen ${formatCurrency(selected.metrics.averageBasketHt)}</div></div>
              <div class="card"><div class="label">Encaisse</div><div class="value">${formatCurrency(selected.metrics.paidAmount)}</div><div class="hint">Reste ${formatCurrency(selected.metrics.remainingAmount)}</div></div>
            </div>

            <div class="section two">
              <div class="card">
                <div class="label">Indicateurs</div>
                <table>
                  <tbody>
                    <tr><td>Clients uniques</td><td style="text-align:right;">${formatNumber(selected.metrics.customersCount)}</td></tr>
                    <tr><td>References vendues</td><td style="text-align:right;">${formatNumber(selected.metrics.productsCount)}</td></tr>
                    <tr><td>Remises</td><td style="text-align:right;">${formatCurrency(selected.metrics.discountAmount)}</td></tr>
                    <tr><td>Frais de port</td><td style="text-align:right;">${formatCurrency(selected.metrics.shippingFee)}</td></tr>
                    <tr><td>Commission estimee</td><td style="text-align:right;">${formatCurrency(selected.metrics.estimatedCommission)}</td></tr>
                    <tr><td>Tickets rembourses</td><td style="text-align:right;">${formatNumber(selected.metrics.refundedTicketsCount)}</td></tr>
                    <tr><td>Tickets annules</td><td style="text-align:right;">${formatNumber(selected.metrics.cancelledTicketsCount)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div class="card">
                <div class="label">Paiements</div>
                <table>
                  <tbody>${paymentRows || `<tr><td colspan="2">Aucun paiement</td></tr>`}</tbody>
                </table>
              </div>
            </div>

            <div class="section two">
              <div>
                <h2>CA par categorie</h2>
                <table>
                  <thead><tr><th>Categorie</th><th style="text-align:right;">Qte</th><th style="text-align:right;">CA</th></tr></thead>
                  <tbody>${categoryRows || `<tr><td colspan="3">Aucune categorie</td></tr>`}</tbody>
                </table>
              </div>
              <div>
                <h2>Top articles</h2>
                <table>
                  <thead><tr><th>Reference</th><th>Article</th><th style="text-align:right;">Qte</th><th style="text-align:right;">CA</th></tr></thead>
                  <tbody>${productRows || `<tr><td colspan="4">Aucun article</td></tr>`}</tbody>
                </table>
              </div>
            </div>

            <div class="section">
              <h2>Dernieres commandes</h2>
              <table>
                <thead><tr><th>Ticket</th><th>Client</th><th style="text-align:right;">Articles</th><th style="text-align:right;">CA</th><th style="text-align:right;">Encaisse</th><th>Date</th></tr></thead>
                <tbody>${ticketRows || `<tr><td colspan="6">Aucune commande</td></tr>`}</tbody>
              </table>
            </div>
          </div>
          <script>
            window.onload = function () {
              window.print();
              setTimeout(function () { window.close(); }, 200);
            };
          </script>
        </body>
      </html>
    `);
    popup.document.close();
  }

  async function loadCashReportRegisters() {
    const bootstrapData = await api<{ registers: CashRegister[] }>("/pos/bootstrap");
    setCashReportRegisters(bootstrapData.registers ?? []);
  }

  async function loadReportsCashReport(options?: {
    warehouseId?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    registerId?: string;
    type?: CashReportType;
    silent?: boolean;
  }) {
    const warehouseId = options?.warehouseId ?? cashReportWarehouseId ?? selectedWarehouseId;
    const date = (options?.date ?? cashReportDate) || toIsoLocal(new Date());
    const dateFrom = (options?.dateFrom ?? cashReportDateFrom) || date;
    const dateTo = (options?.dateTo ?? cashReportDateTo) || date;
    const registerId = options?.registerId ?? cashReportRegisterId;
    const reportType = options?.type ?? cashReportType;
    if (!warehouseId) {
      setCashReportMessage("Choisis d'abord une boutique.");
      return;
    }
    if (!options?.silent) setCashReportLoading(true);
    try {
      const params = new URLSearchParams({ warehouseId });
      if (cashAdminTab === "report-periodic" || options?.dateFrom || options?.dateTo) {
        params.set("dateFrom", dateFrom);
        params.set("dateTo", dateTo);
      } else {
        params.set("date", date);
      }
      if (registerId) params.set("registerId", registerId);
      const report = await api<PosCashReport>(`/pos/reports/cash?${params.toString()}`);
      setCashReportData(report);
      setCashReportWarehouseId(warehouseId);
      setCashReportDate(date);
      setCashReportDateFrom(dateFrom);
      setCashReportDateTo(dateTo);
      setCashReportRegisterId(registerId);
      setCashReportType(reportType);
      setCashReportMessage(null);
    } catch (error) {
      setCashReportData(null);
      setCashReportMessage(error instanceof Error ? error.message : "Chargement rapport caisse impossible.");
    } finally {
      if (!options?.silent) setCashReportLoading(false);
    }
  }

  async function loadReportsCashSessionsOverview(options?: {
    warehouseId?: string;
    date?: string;
    registerId?: string;
    silent?: boolean;
    allWarehouses?: boolean;
  }) {
    const warehouseId = options?.warehouseId ?? cashReportWarehouseId ?? selectedWarehouseId;
    const date = (options?.date ?? cashReportDate) || toIsoLocal(new Date());
    const registerId = options?.registerId ?? cashReportRegisterId;
    const loadAllWarehouses = Boolean(options?.allWarehouses && canSeeCashAdmin);
    if (!loadAllWarehouses && !warehouseId) {
      setCashReportMessage("Choisis d'abord une boutique.");
      return;
    }
    if (!options?.silent) setCashReportLoading(true);
    try {
      if (loadAllWarehouses) {
        const warehouseList = bootstrap?.warehouses ?? [];
        const overviews = await Promise.all(
          warehouseList.map(async (warehouse) => {
            const params = new URLSearchParams({ warehouseId: warehouse.id, date });
            if (registerId) params.set("registerId", registerId);
            const overview = await api<PosCashSessionsOverview>(`/pos/sessions/overview?${params.toString()}`);
            return overview;
          })
        );

        const flattenedRegisters = overviews
          .flatMap((overview) =>
            overview.registers.map((entry) => ({
              ...entry,
              warehouse: {
                id: overview.warehouse.id,
                name: overview.warehouse.name,
                code: overview.warehouse.code
              }
            }))
          )
          .sort((left, right) => {
            const warehouseCompare = (left.warehouse?.name ?? "").localeCompare(right.warehouse?.name ?? "", "fr");
            if (warehouseCompare !== 0) return warehouseCompare;
            return left.register.name.localeCompare(right.register.name, "fr");
          });

        setCashSessionsOverview({
          date,
          warehouse: { id: "all", name: "Toutes les boutiques", code: "ALL" },
          history: [],
          registers: flattenedRegisters
        });
      } else {
        const params = new URLSearchParams({ warehouseId, date });
        if (registerId) params.set("registerId", registerId);
        const overview = await api<PosCashSessionsOverview>(`/pos/sessions/overview?${params.toString()}`);
        setCashSessionsOverview(overview);
        setCashReportWarehouseId(warehouseId);
      }
      setCashReportDate(date);
      setCashReportRegisterId(registerId);
      setCashReportMessage(null);
    } catch (error) {
      setCashSessionsOverview(null);
      setCashReportMessage(error instanceof Error ? error.message : "Chargement des sessions caisse impossible.");
    } finally {
      if (!options?.silent) setCashReportLoading(false);
    }
  }

  async function openReportsCashModal() {
    const warehouseId = selectedWarehouseId || bootstrap?.warehouses?.[0]?.id || "";
    setCashReportModalOpen(true);
    setCashAdminTab("report-end-day");
    setCashReportType("Y");
    setCashReportWarehouseId(warehouseId);
    await loadCashReportRegisters();
    await loadReportsCashReport({ warehouseId, type: "Y" });
  }

  async function loadLiveCashRegisters() {
    if (!bootstrap?.warehouses?.length) {
      setLiveCashRegisters([]);
      setLiveCashMessage("Aucune boutique disponible.");
      return;
    }
    setLiveCashLoading(true);
    try {
      const targetWarehouses = bootstrap.warehouses;
      const overviews = await Promise.all(
        targetWarehouses.map(async (warehouse) => {
          const params = new URLSearchParams({ warehouseId: warehouse.id, date: toIsoLocal(new Date()) });
          const overview = await api<PosCashSessionsOverview>(`/pos/sessions/overview?${params.toString()}`);
          return overview;
        })
      );
      const activeRegisters = overviews
        .flatMap((overview) =>
          overview.registers
            .filter((entry) => String(entry.status).toUpperCase() === "OPEN")
            .map((entry) => ({
              ...entry,
              warehouse: {
                id: overview.warehouse.id,
                name: overview.warehouse.name,
                code: overview.warehouse.code
              }
            }))
        )
        .sort((left, right) => {
          const warehouseCompare = left.warehouse.name.localeCompare(right.warehouse.name, "fr");
          if (warehouseCompare !== 0) return warehouseCompare;
          return left.register.name.localeCompare(right.register.name, "fr");
        });

      setLiveCashRegisters(activeRegisters);
      setLiveCashMessage(activeRegisters.length ? null : "Aucune caisse active pour le moment.");
    } catch (error) {
      setLiveCashRegisters([]);
      setLiveCashMessage(error instanceof Error ? error.message : "Chargement des caisses en direct impossible.");
    } finally {
      setLiveCashLoading(false);
    }
  }

  async function openLiveCashModal() {
    setLiveCashModalOpen(true);
    await loadLiveCashRegisters();
  }

  if (summaryLoading || bootstrapLoading) {
    return <LoadingBlock label="Chargement des rapports..." />;
  }

  if (!summary || !bootstrap) {
    return <EmptyState title="Rapports indisponibles" description="Impossible de charger les indicateurs et les rapports vendeurs." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapports"
        title=""
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              className="!py-2 !text-sm"
              onClick={() => void openReportsCashModal()}
            >
              Rapports caisse
            </Button>
            <Button
              variant="secondary"
              className="!border-emerald-300/35 !bg-emerald-400/10 !py-2 !text-sm !text-emerald-100 shadow-[0_0_0_1px_rgba(52,211,153,0.12)] animate-pulse"
              onClick={() => void openLiveCashModal()}
            >
              Caisse en direct
            </Button>
          </div>
        )}
      />

      <div className="sticky top-0 z-20 -mt-2 rounded-[22px] border border-white/10 bg-[#120d0a]/95 px-3 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={view === "summary" ? "primary" : "secondary"} className="!py-2 !text-sm" onClick={() => setView("summary")}>
            Synthese generale
          </Button>
          <Button variant={view === "seller" ? "primary" : "secondary"} className="!py-2 !text-sm" onClick={() => setView("seller")}>
            Rapport boutiques
          </Button>
          <Button variant={view === "detail" ? "primary" : "secondary"} className="!py-2 !text-sm" onClick={() => setView("detail")}>
            Rapport Vendeurs
          </Button>
        </div>
      </div>

      {view !== "summary" ? (
        <>
          <SectionCard
            title={view === "seller" ? "Rapport de vente par boutique" : "Rapport de vente par vendeur"}
            actions={(
              <Button
                className="!py-2 !text-sm"
                onClick={() => {
                  void loadSellerReport();
                }}
              >
                Actualiser
              </Button>
            )}
          >
            <div className={`grid gap-3 md:grid-cols-2 ${view === "detail" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
              <Field label="Periode">
                <Select value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as PeriodPreset)}>
                  <option value="day">Journee</option>
                  <option value="week">Semaine</option>
                  <option value="month">Mois</option>
                  <option value="year">Annee</option>
                  <option value="custom">Date definie</option>
                </Select>
              </Field>
              <Field label="Boutique">
                <Select value={selectedWarehouseId} onChange={(event) => setSelectedWarehouseId(event.target.value)}>
                  {bootstrap.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </Select>
              </Field>
              {view === "detail" ? (
                <Field label="Vendeur">
                  <Select value={selectedSellerId} onChange={(event) => setSelectedSellerId(event.target.value)} disabled={!sellerOptions.length}>
                    {sellerOptions.map((seller) => (
                      <option key={seller.id} value={seller.id}>{seller.fullName}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label="Date debut">
                <Input
                  type="date"
                  value={activeRange.dateFrom}
                  disabled={periodPreset !== "custom"}
                  onChange={(event) => setCustomDateFrom(event.target.value)}
                />
              </Field>
              <Field label="Date fin">
                <Input
                  type="date"
                  value={activeRange.dateTo}
                  disabled={periodPreset !== "custom"}
                  onChange={(event) => setCustomDateTo(event.target.value)}
                />
              </Field>
            </div>
          </SectionCard>

          {sellerLoading || !sellerReport ? (
            <LoadingBlock label="Calcul du rapport vendeur..." />
          ) : (
            <>
              <div className="space-y-6">
                {view === "seller" ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <StatCard label="CA boutique" value={formatCurrency(sellerReport.scopeSummary.turnoverAmount)} hint={sellerReport.scopeSummary.warehouseName} accent="orange" />
                      <StatCard label="Encaisse" value={formatCurrency(sellerReport.scopeSummary.paidAmount)} hint={`Reste ${formatCurrency(sellerReport.scopeSummary.remainingAmount)}`} accent="green" />
                      <StatCard label="Commandes" value={formatNumber(sellerReport.scopeSummary.ticketsCount)} hint={`${formatNumber(sellerReport.scopeSummary.itemsSold)} article(s)`} accent="blue" />
                      <StatCard label="Panier moyen" value={formatCurrency(sellerReport.scopeSummary.averageBasket)} hint={`${formatNumber(sellerReport.scopeSummary.averageItemsPerTicket)} article(s) / ticket`} accent="red" />
                    </div>

                    <SectionCard
                      title="Classement vendeurs"
                      actions={(
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={printSellerRankingReport}>
                            Imprimer classement
                          </Button>
                          <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={exportSellerRankingCsv}>
                            Export classement CSV
                          </Button>
                        </div>
                      )}
                    >
                      <div className="overflow-hidden rounded-[20px] border border-white/10">
                        <table className="min-w-full text-[11px] text-[#eadfd4]">
                          <thead className="bg-[#1f1712] text-[8px] uppercase tracking-[0.1em] text-[#cdbfaf]">
                            <tr>
                              <th className="px-2.5 py-1.5 text-left">Vendeur</th>
                              <th className="px-2.5 py-1.5 text-right">Commandes</th>
                              <th className="px-2.5 py-1.5 text-right">CA</th>
                              <th className="px-2.5 py-1.5 text-right">Panier</th>
                              <th className="px-2.5 py-1.5 text-right">Articles</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerReport.sellerRanking.map((entry) => (
                              <tr key={entry.seller.id} className="border-t border-white/10 hover:bg-white/5">
                                <td className="px-2.5 py-1.5">
                                  <div className="font-medium text-white">{entry.seller.fullName}</div>
                                  <div className="mt-1 text-xs text-[#baa999]">{entry.topCategory?.name || "Sans categorie"}</div>
                                </td>
                                <td className="px-2.5 py-1.5 text-right">{formatNumber(entry.metrics.ticketsCount)}</td>
                                <td className="px-2.5 py-1.5 text-right font-semibold text-white">{formatCurrency(entry.metrics.turnoverAmount)}</td>
                                <td className="px-2.5 py-1.5 text-right">{formatCurrency(entry.metrics.averageBasket)}</td>
                                <td className="px-2.5 py-1.5 text-right">{formatNumber(entry.metrics.itemsSold)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!sellerReport.sellerRanking.length ? (
                          <div className="p-4 text-sm text-[#baa999]">Aucun vendeur rattache a cette boutique.</div>
                        ) : null}
                      </div>
                    </SectionCard>

                    <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
                      <SectionCard title="Indicateurs boutique">
                        <div className="space-y-1.5 rounded-[18px] border border-white/10 bg-white/5 p-3 text-[13px] text-[#eadfd4]">
                          <div className="flex items-center justify-between gap-3"><span>Total HT</span><strong className="text-white">{formatCurrency(sellerReport.scopeSummary.subtotalHt)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>TVA</span><strong className="text-white">{formatCurrency(sellerReport.scopeSummary.taxAmount)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Remises</span><strong className="text-white">{formatCurrency(sellerReport.scopeSummary.discountAmount)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Frais de port</span><strong className="text-white">{formatCurrency(sellerReport.scopeSummary.shippingFee)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Remboursements</span><strong className="text-white">{formatCurrency(sellerReport.scopeSummary.refundedAmount)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Annulations</span><strong className="text-white">{formatCurrency(sellerReport.scopeSummary.cancelledAmount)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Meilleure journee</span><strong className="text-white">{sellerReport.scopeSummary.bestDay ? `${formatDate(sellerReport.scopeSummary.bestDay.date)} - ${formatCurrency(sellerReport.scopeSummary.bestDay.revenue)}` : "-"}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Paiement dominant</span><strong className="text-white">{sellerReport.scopeSummary.dominantPayment?.label ?? "-"}</strong></div>
                        </div>
                      </SectionCard>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-[1.06fr_0.94fr]">
                      <SectionCard title="Evolution boutique">
                        <div className="h-[260px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={sellerReport.scopeSummary.salesByDay}>
                              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                              <XAxis dataKey="date" stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} tickFormatter={(value) => formatDate(value)} />
                              <YAxis stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} tickFormatter={(value) => formatNumber(Number(value))} />
                              <Tooltip formatter={(value: number) => formatCurrency(value)} labelFormatter={(value) => formatDate(String(value))} contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }} />
                              <Bar dataKey="revenue" fill="#ff8c36" radius={[10, 10, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </SectionCard>

                      <SectionCard title="Paiements boutique">
                        <div className="overflow-hidden rounded-[20px] border border-white/10">
                          <table className="min-w-full text-[13px] text-[#eadfd4]">
                            <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                              <tr>
                                <th className="px-3 py-2.5 text-left">Mode</th>
                                <th className="px-3 py-2.5 text-right">Montant</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sellerReport.scopeSummary.paymentBreakdown.map((entry) => (
                                <tr key={entry.method} className="border-t border-white/10">
                                  <td className="px-3 py-2.5">{entry.label}</td>
                                  <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(entry.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!sellerReport.scopeSummary.paymentBreakdown.length ? (
                            <div className="p-4 text-sm text-[#baa999]">Aucun paiement trouve pour cette boutique.</div>
                          ) : null}
                        </div>
                      </SectionCard>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                      <SectionCard title="CA par categorie">
                        <div className="overflow-hidden rounded-[20px] border border-white/10">
                          <table className="min-w-full text-[13px] text-[#eadfd4]">
                            <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                              <tr>
                                <th className="px-3 py-2.5 text-left">Categorie</th>
                                <th className="px-3 py-2.5 text-right">Qte</th>
                                <th className="px-3 py-2.5 text-right">CA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sellerReport.scopeSummary.categorySummary.map((entry) => (
                                <tr key={entry.id ?? entry.name} className="border-t border-white/10">
                                  <td className="px-3 py-2.5">{entry.name}</td>
                                  <td className="px-3 py-2.5 text-right">{formatNumber(entry.quantity)}</td>
                                  <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(entry.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!sellerReport.scopeSummary.categorySummary.length ? (
                            <div className="p-4 text-sm text-[#baa999]">Aucune categorie vendue pour cette boutique.</div>
                          ) : null}
                        </div>
                      </SectionCard>

                      <SectionCard title="Top articles boutique">
                        <div className="overflow-hidden rounded-[20px] border border-white/10">
                          <table className="min-w-full text-[13px] text-[#eadfd4]">
                            <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                              <tr>
                                <th className="px-3 py-2.5 text-left">Reference</th>
                                <th className="px-3 py-2.5 text-left">Article</th>
                                <th className="px-3 py-2.5 text-right">Qte</th>
                                <th className="px-3 py-2.5 text-right">CA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sellerReport.scopeSummary.topProducts.map((product) => (
                                <tr key={product.productId} className="border-t border-white/10">
                                  <td className="px-3 py-2.5 font-medium text-white">{product.reference}</td>
                                  <td className="px-3 py-2.5">{product.name}</td>
                                  <td className="px-3 py-2.5 text-right">{formatNumber(product.quantity)}</td>
                                  <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(product.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!sellerReport.scopeSummary.topProducts.length ? (
                            <div className="p-4 text-sm text-[#baa999]">Aucun article vendu pour cette boutique.</div>
                          ) : null}
                        </div>
                      </SectionCard>
                    </div>
                  </>
                ) : null}

                {view === "detail" && sellerReport.selectedSeller ? (
                  <>
                    <SectionCard
                      title={sellerReport.selectedSeller.seller.fullName}
                      description={`Boutique ${sellerReport.selectedSeller.seller.warehouseName || sellerReport.scopeSummary.warehouseName}`}
                      actions={(
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="warning">{sellerReport.selectedSeller.seller.commissionRate.toFixed(2)}% commission</Badge>
                          {sellerReport.selectedSeller.topCategory ? <Badge tone="neutral">{sellerReport.selectedSeller.topCategory.name}</Badge> : null}
                          {sellerReport.selectedSeller.dominantPayment ? <Badge tone="success">{sellerReport.selectedSeller.dominantPayment.label}</Badge> : null}
                          <Button variant="secondary" className="!py-2 !text-sm" onClick={printSelectedSellerReport}>
                            Imprimer
                          </Button>
                          <Button variant="secondary" className="!py-2 !text-sm" onClick={exportSelectedSellerCsv}>
                            Export CSV
                          </Button>
                        </div>
                      )}
                    >
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <StatCard label="CA vendeur" value={formatCurrency(sellerReport.selectedSeller.metrics.turnoverAmount)} hint="Total TTC sur la periode" accent="orange" />
                        <StatCard label="Nombre commande" value={formatNumber(sellerReport.selectedSeller.metrics.ticketsCount)} hint={`${formatNumber(sellerReport.selectedSeller.metrics.itemsSold)} article(s)`} accent="blue" />
                        <StatCard label="Panier moyen" value={formatCurrency(sellerReport.selectedSeller.metrics.averageBasket)} hint={`HT moyen ${formatCurrency(sellerReport.selectedSeller.metrics.averageBasketHt)}`} accent="green" />
                        <StatCard label="CA moyen panier" value={formatCurrency(sellerReport.selectedSeller.metrics.averageBasket)} hint={`Articles / panier ${formatNumber(sellerReport.selectedSeller.metrics.averageItemsPerTicket)}`} accent="red" />
                      </div>

                      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                        <div className="rounded-[20px] border border-white/10 bg-black/10 p-3.5">
                          <div className="mb-2.5">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Evolution</p>
                            <h3 className="mt-1 text-base font-semibold text-white">CA par jour</h3>
                          </div>
                          <div className="h-[240px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={sellerReport.selectedSeller.salesByDay}>
                                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                                <XAxis dataKey="date" stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} tickFormatter={(value) => formatDate(value)} />
                                <YAxis stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} tickFormatter={(value) => formatNumber(Number(value))} />
                                <Tooltip
                                  formatter={(value: number) => formatCurrency(value)}
                                  labelFormatter={(value) => formatDate(String(value))}
                                  contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }}
                                />
                                <Bar dataKey="revenue" fill="#ff8c36" radius={[10, 10, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="rounded-[20px] border border-white/10 bg-black/10 p-3.5">
                          <div className="mb-2.5">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Indicateurs utiles</p>
                            <h3 className="mt-1 text-base font-semibold text-white">Lecture rapide</h3>
                          </div>
                          <div className="space-y-1.5 rounded-[18px] border border-white/10 bg-white/5 p-3 text-[13px] text-[#eadfd4]">
                            <div className="flex items-center justify-between gap-3"><span>Clients uniques</span><strong className="text-white">{formatNumber(sellerReport.selectedSeller.metrics.customersCount)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>References vendues</span><strong className="text-white">{formatNumber(sellerReport.selectedSeller.metrics.productsCount)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Encaisse</span><strong className="text-white">{formatCurrency(sellerReport.selectedSeller.metrics.paidAmount)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Reste a encaisser</span><strong className="text-white">{formatCurrency(sellerReport.selectedSeller.metrics.remainingAmount)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Remises</span><strong className="text-white">{formatCurrency(sellerReport.selectedSeller.metrics.discountAmount)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Frais de port</span><strong className="text-white">{formatCurrency(sellerReport.selectedSeller.metrics.shippingFee)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Commission estimee</span><strong className="text-white">{formatCurrency(sellerReport.selectedSeller.metrics.estimatedCommission)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Tickets rembourses</span><strong className="text-white">{formatNumber(sellerReport.selectedSeller.metrics.refundedTicketsCount)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Tickets annules</span><strong className="text-white">{formatNumber(sellerReport.selectedSeller.metrics.cancelledTicketsCount)}</strong></div>
                            <div className="flex items-center justify-between gap-3"><span>Meilleure journee</span><strong className="text-white">{sellerReport.selectedSeller.bestDay ? `${formatDate(sellerReport.selectedSeller.bestDay.date)} - ${formatCurrency(sellerReport.selectedSeller.bestDay.revenue)}` : "-"}</strong></div>
                          </div>
                        </div>
                      </div>

                      {compareSeller ? (
                        <div className="mt-5 rounded-[20px] border border-white/10 bg-black/10 p-3.5">
                          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Comparaison</p>
                              <h3 className="mt-1 text-base font-semibold text-white">Comparer avec un autre vendeur</h3>
                            </div>
                            <div className="w-full md:max-w-[320px]">
                              <Field label="Comparer avec">
                                <Select value={compareSellerId} onChange={(event) => setCompareSellerId(event.target.value)}>
                                  {compareSellerOptions.map((entry) => (
                                    <option key={entry.seller.id} value={entry.seller.id}>{entry.seller.fullName}</option>
                                  ))}
                                </Select>
                              </Field>
                            </div>
                          </div>

                          <div className="grid gap-3 xl:grid-cols-2">
                            <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 p-3.5">
                              <div className="mb-2.5">
                                <div className="text-base font-semibold text-white">{sellerReport.selectedSeller.seller.fullName}</div>
                                <div className="mt-1 text-sm text-[#d8cabd]">{sellerReport.selectedSeller.seller.warehouseName || sellerReport.scopeSummary.warehouseName}</div>
                              </div>
                              <div className="space-y-1.5 text-[13px] text-[#f3e5d6]">
                                <div className="flex items-center justify-between gap-3"><span>CA</span><strong>{formatCurrency(sellerReport.selectedSeller.metrics.turnoverAmount)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Commandes</span><strong>{formatNumber(sellerReport.selectedSeller.metrics.ticketsCount)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Panier moyen</span><strong>{formatCurrency(sellerReport.selectedSeller.metrics.averageBasket)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Articles vendus</span><strong>{formatNumber(sellerReport.selectedSeller.metrics.itemsSold)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Encaisse</span><strong>{formatCurrency(sellerReport.selectedSeller.metrics.paidAmount)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Commission estimee</span><strong>{formatCurrency(sellerReport.selectedSeller.metrics.estimatedCommission)}</strong></div>
                              </div>
                            </div>

                            <div className="rounded-[18px] border border-white/10 bg-white/5 p-3.5">
                              <div className="mb-2.5">
                                <div className="text-base font-semibold text-white">{compareSeller.seller.fullName}</div>
                                <div className="mt-1 text-sm text-[#d8cabd]">{compareSeller.seller.warehouseName || sellerReport.scopeSummary.warehouseName}</div>
                              </div>
                              <div className="space-y-1.5 text-[13px] text-[#eadfd4]">
                                <div className="flex items-center justify-between gap-3"><span>CA</span><strong>{formatCurrency(compareSeller.metrics.turnoverAmount)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Commandes</span><strong>{formatNumber(compareSeller.metrics.ticketsCount)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Panier moyen</span><strong>{formatCurrency(compareSeller.metrics.averageBasket)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Articles vendus</span><strong>{formatNumber(compareSeller.metrics.itemsSold)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Encaisse</span><strong>{formatCurrency(compareSeller.metrics.paidAmount)}</strong></div>
                                <div className="flex items-center justify-between gap-3"><span>Commission estimee</span><strong>{formatCurrency(compareSeller.metrics.estimatedCommission)}</strong></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </SectionCard>

                    <div className="grid gap-6 xl:grid-cols-2">
                      <SectionCard title="Paiements">
                      <div className="overflow-hidden rounded-[20px] border border-white/10">
                        <table className="min-w-full text-[13px] text-[#eadfd4]">
                          <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                            <tr>
                              <th className="px-3 py-2.5 text-left">Mode</th>
                              <th className="px-3 py-2.5 text-right">Montant</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerReport.selectedSeller.paymentBreakdown.map((entry) => (
                              <tr key={entry.method} className="border-t border-white/10">
                                <td className="px-3 py-2.5">{entry.label}</td>
                                <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(entry.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          </table>
                          {!sellerReport.selectedSeller.paymentBreakdown.length ? (
                            <div className="p-4 text-sm text-[#baa999]">Aucun paiement trouve pour ce vendeur.</div>
                          ) : null}
                        </div>
                      </SectionCard>

                      <SectionCard title="CA par categorie">
                      <div className="overflow-hidden rounded-[20px] border border-white/10">
                        <table className="min-w-full text-[13px] text-[#eadfd4]">
                          <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                            <tr>
                              <th className="px-3 py-2.5 text-left">Categorie</th>
                              <th className="px-3 py-2.5 text-right">Qte</th>
                              <th className="px-3 py-2.5 text-right">CA</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerReport.selectedSeller.categorySummary.map((entry) => (
                              <tr key={entry.id ?? entry.name} className="border-t border-white/10">
                                <td className="px-3 py-2.5">{entry.name}</td>
                                <td className="px-3 py-2.5 text-right">{formatNumber(entry.quantity)}</td>
                                <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(entry.revenue)}</td>
                              </tr>
                            ))}
                          </tbody>
                          </table>
                          {!sellerReport.selectedSeller.categorySummary.length ? (
                            <div className="p-4 text-sm text-[#baa999]">Aucune categorie vendue sur la periode.</div>
                          ) : null}
                        </div>
                      </SectionCard>
                    </div>

                    <SectionCard title="Top articles du vendeur">
                      <div className="overflow-hidden rounded-[20px] border border-white/10">
                        <table className="min-w-full text-[13px] text-[#eadfd4]">
                          <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                            <tr>
                              <th className="px-3 py-2.5 text-left">Reference</th>
                              <th className="px-3 py-2.5 text-left">Article</th>
                              <th className="px-3 py-2.5 text-right">Qte</th>
                              <th className="px-3 py-2.5 text-right">CA</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerReport.selectedSeller.topProducts.map((product) => (
                              <tr key={product.productId} className="border-t border-white/10">
                                <td className="px-3 py-2.5 font-medium text-white">{product.reference}</td>
                                <td className="px-3 py-2.5">{product.name}</td>
                                <td className="px-3 py-2.5 text-right">{formatNumber(product.quantity)}</td>
                                <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(product.revenue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!sellerReport.selectedSeller.topProducts.length ? (
                          <div className="p-4 text-sm text-[#baa999]">Aucun article vendu pour ce vendeur.</div>
                        ) : null}
                      </div>
                    </SectionCard>

                    <SectionCard title="Dernieres commandes">
                      <div className="overflow-hidden rounded-[20px] border border-white/10">
                        <table className="min-w-full text-[13px] text-[#eadfd4]">
                          <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                            <tr>
                              <th className="px-3 py-2.5 text-left">Ticket</th>
                              <th className="px-3 py-2.5 text-left">Client</th>
                              <th className="px-3 py-2.5 text-right">Articles</th>
                              <th className="px-3 py-2.5 text-right">CA</th>
                              <th className="px-3 py-2.5 text-right">Encaisse</th>
                              <th className="px-3 py-2.5 text-left">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sellerReport.selectedSeller.tickets.map((ticket) => (
                              <tr key={ticket.id} className="border-t border-white/10">
                                <td className="px-3 py-2.5 font-medium text-white">{ticket.number}</td>
                                <td className="px-3 py-2.5">{ticket.customerName}</td>
                                <td className="px-3 py-2.5 text-right">{formatNumber(ticket.itemsCount)}</td>
                                <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(ticket.totalAmount)}</td>
                                <td className="px-3 py-2.5 text-right">{formatCurrency(ticket.paidAmount)}</td>
                                <td className="px-3 py-2.5">{formatDateTime(ticket.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!sellerReport.selectedSeller.tickets.length ? (
                          <div className="p-4 text-sm text-[#baa999]">Aucune commande pour ce vendeur sur cette periode.</div>
                        ) : null}
                      </div>
                    </SectionCard>
                  </>
                ) : view === "detail" ? (
                  <EmptyState title="Aucun vendeur selectionne" description="Choisis une boutique et un vendeur pour afficher le rapport detaille." compact />
                ) : null}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <SectionCard
            title="Synthese globale"
            actions={(
              <Button
                className="!py-2 !text-sm"
                onClick={() => {
                  void loadGlobalSellerReport();
                  void loadStoreComparison();
                }}
              >
                Actualiser
              </Button>
            )}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Periode">
                <Select value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as PeriodPreset)}>
                  <option value="day">Journee</option>
                  <option value="week">Semaine</option>
                  <option value="month">Mois</option>
                  <option value="year">Annee</option>
                  <option value="custom">Date definie</option>
                </Select>
              </Field>
              <Field label="Date debut">
                <Input
                  type="date"
                  value={activeRange.dateFrom}
                  disabled={periodPreset !== "custom"}
                  onChange={(event) => setCustomDateFrom(event.target.value)}
                />
              </Field>
              <Field label="Date fin">
                <Input
                  type="date"
                  value={activeRange.dateTo}
                  disabled={periodPreset !== "custom"}
                  onChange={(event) => setCustomDateTo(event.target.value)}
                />
              </Field>
              <div className="rounded-[18px] border border-white/10 bg-black/10 px-4 py-3 text-sm text-[#d8cabd]">
                <div className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Periode active</div>
                <div className="mt-2 font-semibold text-white">{formatDate(activeRange.dateFrom)}{activeRange.dateFrom !== activeRange.dateTo ? ` - ${formatDate(activeRange.dateTo)}` : ""}</div>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StatCard label="CA global" value={formatCurrency(globalSellerReport?.scopeSummary.turnoverAmount ?? summary.salesByStore.reduce((sum, item) => sum + item.revenue, 0))} hint="Toutes boutiques" accent="green" />
            <StatCard label="Commandes" value={formatNumber(globalSellerReport?.scopeSummary.ticketsCount ?? 0)} hint={`${formatNumber(globalSellerReport?.scopeSummary.itemsSold ?? 0)} article(s)`} accent="blue" />
            <StatCard label="Vendeurs actifs" value={formatNumber(globalSellerReport?.scopeSummary.sellersCount ?? 0)} hint={globalSellerReport?.scopeSummary.topCategory?.name ?? "Toutes boutiques"} accent="orange" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Valorisation stock" value={formatCurrency(summary.stockValuation)} hint="Au cout achat TTC" accent="blue" />
            <StatCard label="Achats" value={formatCurrency(summary.purchasesAmount)} hint="Volume fournisseur" accent="orange" />
            <StatCard label="Remises globales" value={formatCurrency(globalSellerReport?.scopeSummary.discountAmount ?? 0)} hint={`TVA ${formatCurrency(globalSellerReport?.scopeSummary.taxAmount ?? 0)}`} accent="green" />
            <StatCard label="Frais de port" value={formatCurrency(globalSellerReport?.scopeSummary.shippingFee ?? 0)} hint={`Rembourse ${formatCurrency(globalSellerReport?.scopeSummary.refundedAmount ?? 0)}`} accent="blue" />
          </div>

          <div className="space-y-6">
            <SectionCard title="Ventes par boutique" description="Comparatif du chiffre d'affaires par point de vente.">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={boutiqueChart}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="label" stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 12 }} />
                    <YAxis stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 12 }} tickFormatter={(value) => formatNumber(Number(value))} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }} />
                    <Bar dataKey="revenue" fill="#ff8c36" radius={[12, 12, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Repartition tickets" description="Poids de chaque boutique dans l'activite de caisse.">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={boutiqueChart} dataKey="tickets" nameKey="label" outerRadius={110} innerRadius={55} paddingAngle={3}>
                      {boutiqueChart.map((entry, index) => <Cell key={entry.label} fill={chartColors[index % chartColors.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatNumber(value)} contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Comparatif boutiques">
              {storeComparisonLoading ? (
                <LoadingBlock label="Calcul du comparatif boutiques..." />
              ) : storeComparison?.boutiques.length ? (
                <div className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
                    <div className="rounded-[20px] border border-white/10 bg-black/10 p-3.5">
                      <div className="mb-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Boutiques</p>
                        <h3 className="mt-1 text-base font-semibold text-white">CA sur la periode</h3>
                      </div>
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={boutiqueChart}>
                            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                            <XAxis dataKey="label" stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} />
                            <YAxis stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} tickFormatter={(value) => formatNumber(Number(value))} />
                            <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }} />
                            <Bar dataKey="ca" radius={[10, 10, 0, 0]}>
                              {boutiqueChart.map((entry, index) => <Cell key={entry.label} fill={chartColors[index % chartColors.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-[20px] border border-white/10">
                      <table className="min-w-full text-[13px] text-[#eadfd4]">
                        <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                          <tr>
                            <th className="px-3 py-2.5 text-left">Boutique</th>
                            <th className="px-3 py-2.5 text-right">CA</th>
                            <th className="px-3 py-2.5 text-right">Tickets</th>
                            <th className="px-3 py-2.5 text-right">Panier</th>
                            <th className="px-3 py-2.5 text-right">Vendeurs</th>
                            <th className="px-3 py-2.5 text-right">Encaisse</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storeComparison.boutiques.map((entry) => (
                            <tr key={entry.warehouse.id} className="border-t border-white/10 hover:bg-white/5">
                              <td className="px-3 py-2.5">
                                <div className="font-medium text-white">{entry.warehouse.name}</div>
                                <div className="mt-1 text-xs text-[#baa999]">{entry.topCategoryName}</div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(entry.turnoverAmount)}</td>
                              <td className="px-3 py-2.5 text-right">{formatNumber(entry.ticketsCount)}</td>
                              <td className="px-3 py-2.5 text-right">{formatCurrency(entry.averageBasket)}</td>
                              <td className="px-3 py-2.5 text-right">{formatNumber(entry.sellersCount)}</td>
                              <td className="px-3 py-2.5 text-right">{formatCurrency(entry.paidAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                      label="Meilleure boutique"
                      value={storeComparison.boutiques[0]?.warehouse.name ?? "-"}
                      hint={storeComparison.boutiques[0] ? formatCurrency(storeComparison.boutiques[0].turnoverAmount) : "Aucune vente"}
                      accent="orange"
                    />
                    <StatCard
                      label="Tickets periode"
                      value={formatNumber(storeComparison.boutiques.reduce((sum, entry) => sum + entry.ticketsCount, 0))}
                      hint={`${formatNumber(storeComparison.boutiques.reduce((sum, entry) => sum + entry.itemsSold, 0))} article(s)`}
                      accent="blue"
                    />
                    <StatCard
                      label="Encaisse boutiques"
                      value={formatCurrency(storeComparison.boutiques.reduce((sum, entry) => sum + entry.paidAmount, 0))}
                      hint={`${formatNumber(storeComparison.boutiques.reduce((sum, entry) => sum + entry.customersCount, 0))} client(s)`}
                      accent="green"
                    />
                    <StatCard
                      label="Remises + port"
                      value={formatCurrency(
                        storeComparison.boutiques.reduce((sum, entry) => sum + entry.discountAmount + entry.shippingFee, 0)
                      )}
                      hint="Vue toutes boutiques"
                      accent="red"
                    />
                  </div>
                </div>
              ) : (
                <EmptyState title="Aucune boutique a comparer" description="Aucune vente n'a ete trouvee sur cette periode." compact />
              )}
            </SectionCard>

            <SectionCard title="Top vendeurs">
              {globalSellerLoading ? (
                <LoadingBlock label="Chargement des vendeurs globaux..." />
              ) : globalSellerReport?.sellerRanking.length ? (
                <div className="space-y-4">
                  <div className="rounded-[20px] border border-white/10 bg-black/10 p-3.5">
                    <div className="mb-2.5">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Top vendeurs</p>
                      <h3 className="mt-1 text-base font-semibold text-white">CA global sur la periode</h3>
                    </div>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={globalTopSellerChart}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                          <XAxis dataKey="label" stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} />
                          <YAxis stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 11 }} tickFormatter={(value) => formatNumber(Number(value))} />
                          <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }} />
                          <Bar dataKey="ca" radius={[10, 10, 0, 0]}>
                            {globalTopSellerChart.map((entry, index) => <Cell key={entry.label} fill={chartColors[index % chartColors.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[20px] border border-white/10">
                    <table className="min-w-full text-[13px] text-[#eadfd4]">
                      <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.14em] text-[#cdbfaf]">
                        <tr>
                          <th className="px-3 py-2.5 text-left">Vendeur</th>
                          <th className="px-3 py-2.5 text-left">Boutique</th>
                          <th className="px-3 py-2.5 text-right">Commandes</th>
                          <th className="px-3 py-2.5 text-right">CA</th>
                          <th className="px-3 py-2.5 text-right">Panier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {globalSellerReport.sellerRanking.slice(0, 12).map((entry) => (
                          <tr key={entry.seller.id} className="border-t border-white/10">
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-white">{entry.seller.fullName}</div>
                              <div className="mt-1 text-xs text-[#baa999]">{entry.topCategory?.name || "Sans categorie"}</div>
                            </td>
                            <td className="px-3 py-2.5">{entry.seller.warehouseName || "-"}</td>
                            <td className="px-3 py-2.5 text-right">{formatNumber(entry.metrics.ticketsCount)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-white">{formatCurrency(entry.metrics.turnoverAmount)}</td>
                            <td className="px-3 py-2.5 text-right">{formatCurrency(entry.metrics.averageBasket)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <EmptyState title="Aucun vendeur global" description="Aucune vente vendeur n'a ete trouvee sur cette periode." compact />
              )}
            </SectionCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.95fr]">
            <SectionCard
              title="Top articles"
              description="Articles les plus contributeurs en quantite et revenu."
              actions={summaryTopProducts.length > topProductsPageSize ? (
                <div className="flex items-center gap-2 text-xs text-[#baa999]">
                  <Button
                    variant="secondary"
                    className="!min-w-[34px] !px-0 !py-2 !text-xs"
                    onClick={() => setTopProductsPage((page) => Math.max(1, page - 1))}
                    disabled={topProductsPage <= 1}
                  >
                    {"<"}
                  </Button>
                  <span>{topProductsPage} / {topProductsTotalPages}</span>
                  <Button
                    variant="secondary"
                    className="!min-w-[34px] !px-0 !py-2 !text-xs"
                    onClick={() => setTopProductsPage((page) => Math.min(topProductsTotalPages, page + 1))}
                    disabled={topProductsPage >= topProductsTotalPages}
                  >
                    {">"}
                  </Button>
                </div>
              ) : undefined}
            >
              <div className="overflow-hidden rounded-[22px] border border-white/10">
                <table className="min-w-full text-sm text-[#eadfd4]">
                  <thead className="bg-[#1f1712] text-[11px] uppercase tracking-[0.16em] text-[#cdbfaf]">
                    <tr>
                      <th className="px-3 py-3 text-left">Article</th>
                      <th className="px-3 py-3 text-right">Qte</th>
                      <th className="px-3 py-3 text-right">Revenu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProductsItems.map((product) => (
                      <tr key={product.id} className="border-t border-white/10">
                        <td className="px-3 py-3">{product.label}</td>
                        <td className="px-3 py-3 text-right">{formatNumber(product.quantity)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-white">{formatCurrency(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard
              title="Articles a surveiller"
              actions={summary.lowStock.length > lowStockPageSize ? (
                <div className="flex items-center gap-2 text-xs text-[#baa999]">
                  <Button
                    variant="secondary"
                    className="!px-3 !py-2 !text-xs"
                    onClick={() => setLowStockPage((page) => Math.max(1, page - 1))}
                    disabled={lowStockPage <= 1}
                  >
                    {"<"}
                  </Button>
                  <span>{lowStockPage} / {lowStockTotalPages}</span>
                  <Button
                    variant="secondary"
                    className="!px-3 !py-2 !text-xs"
                    onClick={() => setLowStockPage((page) => Math.min(lowStockTotalPages, page + 1))}
                    disabled={lowStockPage >= lowStockTotalPages}
                  >
                    {">"}
                  </Button>
                </div>
              ) : undefined}
            >
              {summary.lowStock.length === 0 ? (
                <EmptyState title="Stock sain" description="Aucune reference n'est en dessous du seuil d'alerte." compact />
              ) : (
                <div className="space-y-3">
                  {lowStockItems.map((product) => (
                    <div key={product.id} className="rounded-[22px] border border-orange-300/20 bg-orange-300/10 p-4">
                      <div className="font-semibold text-white">{product.name}</div>
                      <div className="mt-1 text-sm text-orange-100">Stock {product.stockOnHand} / minimum {product.minStock}</div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}

      {cashReportModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-[1120px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-[calc(100vh-1.5rem)] sm:max-h-[820px] sm:rounded-[30px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">POS / Rapports caisse</p>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setCashReportModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {([
                { key: "report-end-day" as const, label: "Rapport fin de journee" },
                { key: "report-periodic" as const, label: "Rapport periodique" },
                ...(canSeeCashAdmin
                  ? [
                      { key: "history" as const, label: "Historique caisse" },
                      { key: "registers" as const, label: "Caisses du jour" }
                    ]
                  : [])
              ]).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${cashAdminTab === tab.key ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-white/5 text-white"}`}
                  onClick={() => {
                    setCashAdminTab(tab.key);
                    if (tab.key === "report-end-day") {
                      setCashReportType("Y");
                      void loadReportsCashReport({ type: "Y", silent: true });
                      return;
                    }
                    if (tab.key === "report-periodic") {
                      void loadReportsCashReport({ dateFrom: cashReportDateFrom, dateTo: cashReportDateTo, silent: true });
                      return;
                    }
                    void loadReportsCashSessionsOverview({ silent: true, allWarehouses: tab.key === "registers" });
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className={`grid gap-3 ${cashAdminTab === "report-periodic" ? "xl:grid-cols-[170px_170px_180px_210px_auto]" : "xl:grid-cols-[170px_180px_210px_auto]"}`}>
              {cashAdminTab === "report-periodic" ? (
                <>
                  <Field label="Date debut">
                    <Input type="date" value={cashReportDateFrom} onChange={(event) => setCashReportDateFrom(event.target.value)} />
                  </Field>
                  <Field label="Date fin">
                    <Input type="date" value={cashReportDateTo} onChange={(event) => setCashReportDateTo(event.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label="Date">
                  <Input type="date" value={cashReportDate} onChange={(event) => setCashReportDate(event.target.value)} />
                </Field>
              )}
              <Field label="Boutique">
                <Select value={cashReportWarehouseId} onChange={(event) => setCashReportWarehouseId(event.target.value)}>
                  {bootstrap.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Caisse">
                <Select value={cashReportRegisterId} onChange={(event) => setCashReportRegisterId(event.target.value)}>
                  <option value="">Toutes les caisses</option>
                  {reportRegisters.map((register) => (
                    <option key={register.id} value={register.id}>{register.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap items-end justify-end gap-2 xl:self-stretch">
                <Button
                  className="!py-3 text-sm"
                  type="button"
                  variant="secondary"
                  onClick={() => void (
                    cashAdminTab === "history" || cashAdminTab === "registers"
                      ? loadReportsCashSessionsOverview({ allWarehouses: cashAdminTab === "registers" })
                      : loadReportsCashReport()
                  )}
                >
                  {cashReportLoading ? "Chargement..." : "Actualiser"}
                </Button>
              </div>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {cashReportMessage ? <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#f1e6da]">{cashReportMessage}</div> : null}
              {cashReportLoading ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-white/10 bg-black/20">
                  <LoadingBlock label="Chargement du rapport caisse..." />
                </div>
              ) : (cashAdminTab === "report-end-day" || cashAdminTab === "report-periodic") && cashReportData ? (
                <div className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                    <div className="space-y-4">
                      {cashAdminTab === "report-end-day" ? (
                        <div className="rounded-[18px] border border-orange-300/20 bg-black/20 p-3.5">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Total journee</p>
                            <p className="mt-1.5 text-xl font-bold text-white">{formatCurrency(cashReportData.reportBreakdown.totalDayNet)}</p>
                            <p className="mt-1 text-xs text-[#baa999]">{cashReportData.totals.ticketsCount} ticket(s)</p>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">
                              {cashAdminTab === "report-periodic" ? "Rapport periodique" : "Rapport fin de journee"}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-white">
                              {cashReportData.period?.isRange
                                ? `${formatDate(cashReportData.period.dateFrom)} - ${formatDate(cashReportData.period.dateTo)}`
                                : formatDate(cashReportData.date)}
                            </h3>
                          </div>
                          <div className="text-right text-xs text-[#baa999]">
                            <div>{cashReportData.warehouse.name}</div>
                            <div>{cashReportData.register?.name || "Toutes les caisses"}</div>
                          </div>
                        </div>
                        <div className="space-y-2 rounded-[18px] border border-white/10 bg-white/5 p-3 text-sm text-[#eadfd4]">
                          {cashAdminTab === "report-end-day" ? (
                            <div className="flex items-center justify-between gap-3">
                              <span>Total journee</span>
                              <span className="font-semibold text-white">{formatCurrency(cashReportData.reportBreakdown.totalDayNet)}</span>
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between gap-3"><span>Total HT</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.subtotalHt)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>TVA</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.taxAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Remises</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.discountAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Frais de port</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.shippingFee)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total Carte de Credit</span><span className="font-semibold text-white">{formatCurrency(cashReportData.reportBreakdown.cardAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total Espece</span><span className="font-semibold text-white">{formatCurrency(cashReportData.reportBreakdown.cashAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total Euro</span><span className="font-semibold text-white">{formatForeignCurrency(cashReportData.reportBreakdown.euroAmount, "EUR")}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total USD</span><span className="font-semibold text-white">{formatForeignCurrency(cashReportData.reportBreakdown.usdAmount, "USD")}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Avoir</span><span className="font-semibold text-white">{formatCurrency(cashReportData.reportBreakdown.voucherAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Compte Clients</span><span className="font-semibold text-white">{formatCurrency(cashReportData.reportBreakdown.creditAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Virement</span><span className="font-semibold text-white">{formatCurrency(cashReportData.reportBreakdown.transferAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Cheque</span><span className="font-semibold text-white">{formatCurrency(cashReportData.reportBreakdown.chequeAmount)}</span></div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                        <div className="mb-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Articles vendus</p>
                          <h3 className="mt-1 text-lg font-semibold text-white">Par categorie</h3>
                        </div>
                        <div className="space-y-3">
                          {cashReportData.categorySummary.map((category) => (
                            <div key={category.categoryId ?? category.categoryName} className="overflow-hidden rounded-[20px] border border-white/10 bg-black/25">
                              <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">Categorie</p>
                                  <h4 className="mt-1 text-base font-semibold text-white">{category.categoryName}</h4>
                                </div>
                                <div className="text-left sm:text-right">
                                  <p className="text-xs text-[#baa999]">{category.quantity} article(s)</p>
                                  <p className="mt-1 text-sm font-semibold text-orange-100">{formatCurrency(category.totalAmount)}</p>
                                </div>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-sm text-[#eadfd4]">
                                  <thead className="bg-[#1f1712] text-[11px] uppercase tracking-[0.16em] text-[#cdbfaf]">
                                    <tr>
                                      <th className="px-3 py-3 text-left">Reference</th>
                                      <th className="px-3 py-3 text-left">Article</th>
                                      <th className="px-3 py-3 text-center">Qte</th>
                                      <th className="px-3 py-3 text-right">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {category.articles.map((article) => (
                                      <tr key={article.productId} className="border-t border-white/10">
                                        <td className="px-3 py-3 font-medium text-white">{article.reference}</td>
                                        <td className="px-3 py-3">{article.name}</td>
                                        <td className="px-3 py-3 text-center">{article.quantity}</td>
                                        <td className="px-3 py-3 text-right font-semibold text-white">{formatCurrency(article.totalAmount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                          {!cashReportData.categorySummary.length ? (
                            <EmptyState title="Aucun article vendu" description="Les ventes apparaitront ici, avec les totaux par categorie." compact />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : cashAdminTab === "history" && cashSessionsOverview ? (
                <div className="overflow-x-auto rounded-[22px] border border-white/10 bg-black/20">
                  <table className="min-w-full text-sm text-[#eadfd4]">
                    <thead className="bg-[#1f1712] text-[11px] uppercase tracking-[0.16em] text-[#cdbfaf]">
                      <tr>
                        <th className="px-3 py-3 text-left">Caisse</th>
                        <th className="px-3 py-3 text-left">Ouverture</th>
                        <th className="px-3 py-3 text-left">Cloture</th>
                        <th className="px-3 py-3 text-right">CA</th>
                        <th className="px-3 py-3 text-right">Tickets</th>
                        <th className="px-3 py-3 text-left">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashSessionsOverview.history.map((entry) => (
                        <tr key={entry.id} className="border-t border-white/10">
                          <td className="px-3 py-3 font-medium text-white">{entry.register.name}</td>
                          <td className="px-3 py-3">{formatDateTime(entry.openedAt)}</td>
                          <td className="px-3 py-3">{entry.closedAt ? formatDateTime(entry.closedAt) : "-"}</td>
                          <td className="px-3 py-3 text-right font-semibold text-white">{formatCurrency(entry.turnoverAmount)}</td>
                          <td className="px-3 py-3 text-right">{formatNumber(entry.ticketsCount)}</td>
                          <td className="px-3 py-3">{entry.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : cashAdminTab === "registers" && cashSessionsOverview ? (
                <div className="overflow-x-auto rounded-[22px] border border-white/10 bg-black/20">
                  <table className="min-w-full text-sm text-[#eadfd4]">
                    <thead className="bg-[#1f1712] text-[11px] uppercase tracking-[0.16em] text-[#cdbfaf]">
                      <tr>
                        <th className="px-3 py-3 text-left">Boutique</th>
                        <th className="px-3 py-3 text-left">Caisse</th>
                        <th className="px-3 py-3 text-left">Statut</th>
                        <th className="px-3 py-3 text-right">CA</th>
                        <th className="px-3 py-3 text-right">Encaisse</th>
                        <th className="px-3 py-3 text-right">Tickets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashSessionsOverview.registers.map((entry) => (
                        <tr key={entry.register.id} className="border-t border-white/10">
                          <td className="px-3 py-3">{entry.warehouse?.name ?? cashSessionsOverview.warehouse.name}</td>
                          <td className="px-3 py-3 font-medium text-white">{entry.register.name}</td>
                          <td className="px-3 py-3">{entry.status}</td>
                          <td className="px-3 py-3 text-right font-semibold text-white">{formatCurrency(entry.turnoverAmount)}</td>
                          <td className="px-3 py-3 text-right">{formatCurrency(entry.paidAmount)}</td>
                          <td className="px-3 py-3 text-right">{formatNumber(entry.ticketsCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="Rapport caisse indisponible" description="Aucune donnee caisse n'est disponible pour ce filtre." compact />
              )}
            </div>
          </div>
        </div>
      ) : null}
      {liveCashModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-[1180px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-[calc(100vh-1.5rem)] sm:max-h-[820px] sm:rounded-[30px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Rapports / Caisse en direct</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Caisses actives</h2>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" className="!py-2 !text-sm" onClick={() => void loadLiveCashRegisters()}>
                  {liveCashLoading ? "Chargement..." : "Actualiser"}
                </Button>
                <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setLiveCashModalOpen(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {liveCashMessage ? (
                <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#f1e6da]">
                  {liveCashMessage}
                </div>
              ) : null}

              {liveCashLoading ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-white/10 bg-black/20">
                  <LoadingBlock label="Chargement des caisses actives..." />
                </div>
              ) : liveCashRegisters.length ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {liveCashRegisters.map((entry) => (
                    <div key={`${entry.warehouse.id}-${entry.register.id}`} className="rounded-[24px] border border-white/10 bg-black/20 p-4 shadow-[0_16px_34px_rgba(0,0,0,0.16)]">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">{entry.warehouse.name}</p>
                          <h3 className="mt-1 truncate text-lg font-semibold text-white">{entry.register.name}</h3>
                        </div>
                        <Badge tone="success">Active</Badge>
                      </div>
                      <div className="space-y-2 rounded-[18px] border border-white/10 bg-white/5 p-3 text-sm text-[#eadfd4]">
                        <div className="flex items-center justify-between gap-3">
                          <span>CA direct</span>
                          <span className="font-semibold text-white">{formatCurrency(entry.turnoverAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Encaisse</span>
                          <span className="font-semibold text-white">{formatCurrency(entry.paidAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Tickets</span>
                          <span className="font-semibold text-white">{formatNumber(entry.ticketsCount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Ouverte a</span>
                          <span className="font-semibold text-white">{entry.openedAt ? formatDateTime(entry.openedAt) : "-"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Ouverte par</span>
                          <span className="truncate text-right font-semibold text-white">{entry.openedBy?.fullName ?? "-"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                          <span>Fond ouverture</span>
                          <span className="font-semibold text-white">{formatCurrency(entry.openingAmount)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Aucune caisse active" description="Les caisses ouvertes des boutiques apparaitront ici." compact />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
