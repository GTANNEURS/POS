import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Info, PauseCircle, Printer, ReceiptText, RotateCcw, Search, Trash2, UserPlus, WalletCards, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { formatCurrency, formatDate, formatNumber } from "../../lib/format";
import { hasCachedOpenCashSession, isNetworkError, queueOfflineCheckout, readPosSnapshot, rememberOpenCashSession, rememberPosSnapshot } from "../../lib/offline";
import { Button, EmptyState, Field, Input, LoadingBlock, SectionCard, Select } from "../../components/ui/primitives";
import { useAuth } from "../../providers/AuthProvider";

type Product = { id: string; productId: string; variantId?: string | null; name: string; reference: string; barcode?: string | null; salePriceTtc: number; stockOnHand: number; color?: string | null; size?: string | null; imageUrl?: string | null };
type Customer = { id: string; fullName: string; phone?: string | null; email?: string | null };
type Warehouse = { id: string; name: string; type?: string; address?: string | null; phone?: string | null };
type CashRegister = { id: string; name: string; warehouseId: string };
type Transporter = { id: string; name: string };
type Currency = { id: string; code: string; name: string; symbol: string | null; rateFromMad: number; rateMode: string; isBase: boolean; isActive: boolean };
type TicketPrintProfile = {
  fontFamily?: string;
  baseFontSize?: number;
  titleFontSize?: number;
  itemFontSize?: number;
  logoHeight?: number;
  barcodeHeight?: number;
  headerText?: string;
  cgvText?: string;
  footerText?: string;
  fixedBottomText?: string;
  showLogo?: boolean;
  showCompanyName?: boolean;
  showBoutique?: boolean;
  showDate?: boolean;
  showTicketNumber?: boolean;
  showClient?: boolean;
  showSeller?: boolean;
  showArticles?: boolean;
  showTotals?: boolean;
  showPayments?: boolean;
  showCgv?: boolean;
  showFooter?: boolean;
  showBarcode?: boolean;
  showCompanyInfo?: boolean;
};
type TicketPrintProfiles = Partial<Record<"cash" | "reprint" | "detax" | "gift" | "credit", TicketPrintProfile>>;
type PosBootstrapPayload = {
  customers: Customer[];
  warehouses: Warehouse[];
  sellers: Array<{ id: string; fullName: string }>;
  registers: CashRegister[];
  transporters: Transporter[];
  currencies: Currency[];
  paymentMethods: Array<{ id: string; code: string; label: string; isActive: boolean }>;
  company?: {
    name: string;
    logoUrl?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    ticketFooter?: string;
    cgvTerms?: string;
    ticketPrintProfiles?: TicketPrintProfiles | null;
  };
};
type CartLine = { lineId: string; productId: string; variantId?: string | null; reference?: string; barcode?: string | null; name: string; color?: string | null; size?: string | null; imageUrl?: string | null; quantity: number; price: number; discountAmount: number; kind?: "PRODUCT" | "ORDER_DEPOSIT"; orderSource?: "POS" | "LEGACY"; orderType?: string; orderNumber?: string; orderTotal?: number; depositAmount?: number };
type TicketTab = "payment" | "hold";
type HeldTicket = {
  id: string;
  lines: CartLine[];
  customerId: string;
  customerName: string;
  warehouseId: string;
  registerId: string;
  transporterId: string;
  sellerName: string;
  paymentMethod: string;
  shippingFee: string;
  note: string;
  total: number;
  createdAt: string;
};
type PaymentEntry = {
  id: string;
  methodCode: string;
  methodLabel: string;
  amountMad: number;
  reference?: string;
  tenderedAmount?: number;
  currencyCode?: string;
  currencySymbol?: string | null;
  changeMad?: number;
  changeCurrency?: number;
  changeMode?: "MAD" | "CURRENCY" | null;
  voucherBalanceBefore?: number;
  voucherBalanceAfter?: number;
  detail?: string;
};
type VoucherLookup = {
  id: string;
  number: string;
  initialAmount: number;
  balanceAmount: number;
  customerName?: string;
  customerPhone?: string;
  warehouseId?: string | null;
  warehouseName?: string;
  origin?: string;
  sourceDocumentNumber?: string | null;
  usableInCurrentWarehouse?: boolean;
  isActive: boolean;
  expiresAt?: string | null;
};
type CustomerCreditRepayment = {
  id: string;
  saleId: string;
  saleNumber: string;
  customerName: string;
  warehouseName: string;
  amount: number;
  method: string;
  reference?: string | null;
  note?: string | null;
  createdAt: string;
  createdByName?: string | null;
};
type CustomerCreditRow = {
  id: string;
  saleId: string;
  saleNumber: string;
  createdAt: string;
  customer: { id: string | null; fullName: string; phone?: string | null; email?: string | null };
  warehouse: { id: string; name: string };
  sellerName: string;
  creditAmount: number;
  repaidAmount: number;
  balanceAmount: number;
  status: "open" | "partial" | "paid";
  repayments: CustomerCreditRepayment[];
};
type CustomerCreditsPayload = {
  rows: CustomerCreditRow[];
  summary: {
    creditAmount: number;
    repaidAmount: number;
    balanceAmount: number;
    openCount: number;
    partialCount: number;
    paidCount: number;
  };
};
type CreditTicketPreview = {
  id: string;
  number: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  warehouse: { id: string; name: string };
  items: Array<{
    saleItemId: string;
    productId: string;
    reference: string;
    barcode?: string | null;
    productName: string;
    soldQty: number;
    creditedQty: number;
    remainingQty: number;
    unitPriceTtc: number;
    lineTotal: number;
    alreadyFullyCredited: boolean;
  }>;
};
type CreditVoucherCreated = {
  credit: {
    id: string;
    number: string;
    createdAt: string;
    sourceNumber: string;
    customerName: string;
    customerPhone: string;
    warehouseName: string;
    reason: string;
    amount: number;
    items: Array<{
      id: string;
      productName: string;
      reference: string;
      quantity: number;
      unitPriceTtc: number;
      lineTotal: number;
    }>;
  };
  voucher: {
    id: string;
    number: string;
    initialAmount: number;
    balanceAmount: number;
    customerName: string;
    customerPhone: string;
    warehouseId?: string | null;
    warehouseName: string;
    origin: string;
  };
};
type DeliveryOrderLookup = {
  orderNumber: string;
  orderType: string;
  orderTotal: number;
  depositAmount: number;
  paidAmount: number;
  remainingAmount: number;
  firstSale: {
    saleId: string;
    ticketNumber: string;
    sellerName?: string | null;
    details: string;
    createdAt: string;
    payments: Array<{
      id: string;
      method: string;
      amount: number;
      reference?: string | null;
      createdAt: string;
    }>;
  };
};
type PosCheckoutResult = {
  id: string;
  number: string;
  createdAt: string;
  sellerName?: string | null;
  totalAmount: number;
  paidAmount: number;
  shippingFee?: number | null;
  note?: string | null;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    reference?: string | null;
  }>;
};
type ManagerAuthorizationResult = {
  id: string;
  fullName: string;
  warehouseId: string | null;
  warehouseName: string | null;
};
type CashReportType = "X" | "Y";
type CashAdminTab = "report-x" | "report-y" | "report-end-day" | "report-periodic" | "history" | "registers";
type PosCashReport = {
  date: string;
  period: {
    dateFrom: string;
    dateTo: string;
    isRange: boolean;
  };
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
    openingBreakdown: Array<{
      currencyCode: string;
      amount: number;
      amountMad: number;
      rateFromMad: number;
    }>;
    closingBreakdown: Array<{
      currencyCode: string;
      amount: number;
      amountMad: number;
      rateFromMad: number;
    }>;
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
  paymentSummary: Array<{ method: string; label: string; amount: number }>;
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
  ticketSummary: Array<{
    id: string;
    number: string;
    createdAt: string;
    customerName: string;
    sellerName: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    itemsCount: number;
    payments: Array<{
      method: string;
      label: string;
      amount: number;
      reference: string | null;
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
    openingBreakdown: Array<{ currencyCode: string; amount: number; amountMad: number; rateFromMad: number }>;
    closingBreakdown: Array<{ currencyCode: string; amount: number; amountMad: number; rateFromMad: number }>;
    turnoverAmount: number;
    paidAmount: number;
    ticketsCount: number;
  }>;
  registers: Array<{
    register: { id: string; name: string };
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
const defaultPaymentMethods = ["CASH", "CARD", "TRANSFER", "CHEQUE", "CREDIT", "VOUCHER", "FOREIGN_CURRENCY", "MIXED"];

function formatForeignCurrency(amount: number, code: string) {
  return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
}


function escapeReceiptHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderReceiptTextLines(value?: string | null, className = "muted") {
  const lines = String(value ?? "").split(/\r?\n/);
  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return `<div style="height:4px;"></div>`;
    return `<div class="${className}" style="margin-bottom:2px;line-height:1.25;">${escapeReceiptHtml(trimmed)}</div>`;
  }).join("");
}

function buildCode39Svg(value: string, height = 54) {
  const patterns: Record<string, string> = {
    "0": "nnnwwnwnn",
    "1": "wnnwnnnnw",
    "2": "nnwwnnnnw",
    "3": "wnwwnnnnn",
    "4": "nnnwwnnnw",
    "5": "wnnwwnnnn",
    "6": "nnwwwnnnn",
    "7": "nnnwnnwnw",
    "8": "wnnwnnwnn",
    "9": "nnwwnnwnn",
    A: "wnnnnwnnw",
    B: "nnwnnwnnw",
    C: "wnwnnwnnn",
    D: "nnnnwwnnw",
    E: "wnnnwwnnn",
    F: "nnwnwwnnn",
    G: "nnnnnwwnw",
    H: "wnnnnwwnn",
    I: "nnwnnwwnn",
    J: "nnnnwwwnn",
    K: "wnnnnnnww",
    L: "nnwnnnnww",
    M: "wnwnnnnwn",
    N: "nnnnwnnww",
    O: "wnnnwnnwn",
    P: "nnwnwnnwn",
    Q: "nnnnnnwww",
    R: "wnnnnnwwn",
    S: "nnwnnnwwn",
    T: "nnnnwnwwn",
    U: "wwnnnnnnw",
    V: "nwwnnnnnw",
    W: "wwwnnnnnn",
    X: "nwnnwnnnw",
    Y: "wwnnwnnnn",
    Z: "nwwnwnnnn",
    "-": "nwnnnnwnw",
    ".": "wwnnnnwnn",
    " ": "nwwnnnwnn",
    "*": "nwnnwnwnn"
  };
  const source = `*${String(value || "").toUpperCase()}*`;
  const encoded = source.split("").every((char) => patterns[char]) ? source : `*TICKET*`;
  const narrow = 2;
  const wide = 5;
  const gap = 2;
  let x = 0;
  const bars: string[] = [];
  for (const char of encoded) {
    const pattern = patterns[char];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = pattern[index] === "w" ? wide : narrow;
      if (index % 2 === 0) {
        bars.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#111" />`);
      }
      x += width;
    }
    x += gap;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" width="100%" height="${height}" preserveAspectRatio="none">${bars.join("")}</svg>`;
}

export function PosPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [sellers, setSellers] = useState<Array<{ id: string; fullName: string }>>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<Array<{ id: string; code: string; label: string; isActive: boolean }>>([]);
  const [company, setCompany] = useState<PosBootstrapPayload["company"] | null>(null);
  const [currencyId, setCurrencyId] = useState("");
  const [search, setSearch] = useState("");
  const [articleModalOpen, setArticleModalOpen] = useState(false);
  const [articleSearch, setArticleSearch] = useState("");
  const [articleKeyboardOpen, setArticleKeyboardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ticketTab, setTicketTab] = useState<TicketTab>("payment");
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [newClient, setNewClient] = useState({ fullName: "", phone: "" });
  const [clientInputTarget, setClientInputTarget] = useState<"search" | "name" | "phone">("search");
  const [creatingClient, setCreatingClient] = useState(false);
  const [sellerModalOpen, setSellerModalOpen] = useState(false);
  const [sellerSearch, setSellerSearch] = useState("");
  const [shippingModalOpen, setShippingModalOpen] = useState(false);
  const [shippingFeeDraft, setShippingFeeDraft] = useState("0");
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({ type: "Sac", number: "", totalAmount: "0", depositAmount: "0" });
  const [orderInputTarget, setOrderInputTarget] = useState<"number" | "totalAmount" | "depositAmount">("number");
  const [creditNoteModalOpen, setCreditNoteModalOpen] = useState(false);
  const [creditTicketCode, setCreditTicketCode] = useState("");
  const [creditPreviewLoading, setCreditPreviewLoading] = useState(false);
  const [creditSubmitting, setCreditSubmitting] = useState(false);
  const [creditTicketPreview, setCreditTicketPreview] = useState<CreditTicketPreview | null>(null);
  const [creditSelectedItems, setCreditSelectedItems] = useState<Record<string, string>>({});
  const [creditCustomerName, setCreditCustomerName] = useState("");
  const [creditCustomerPhone, setCreditCustomerPhone] = useState("");
  const [creditReason, setCreditReason] = useState("Retour client");
  const [deliveryOrderModalOpen, setDeliveryOrderModalOpen] = useState(false);
  const [deliveryOrderNumber, setDeliveryOrderNumber] = useState("");
  const [deliveryOrderLoading, setDeliveryOrderLoading] = useState(false);
  const [deliveryOrderCompleting, setDeliveryOrderCompleting] = useState(false);
  const [deliveryOrderResult, setDeliveryOrderResult] = useState<DeliveryOrderLookup | null>(null);
  const [quantityModalOpen, setQuantityModalOpen] = useState(false);
  const [activeQuantityLineId, setActiveQuantityLineId] = useState<string>("");
  const [quantityDraft, setQuantityDraft] = useState("1");
  const [lineDiscountModalOpen, setLineDiscountModalOpen] = useState(false);
  const [activeDiscountLineId, setActiveDiscountLineId] = useState<string>("");
  const [lineDiscountDraft, setLineDiscountDraft] = useState("0");
  const [lineDiscountMode, setLineDiscountMode] = useState<"amount" | "percent">("amount");
  const [ticketLineActionModalOpen, setTicketLineActionModalOpen] = useState(false);
  const [ticketLineActionLineId, setTicketLineActionLineId] = useState<string>("");
  const [managerApprovalModalOpen, setManagerApprovalModalOpen] = useState(false);
  const [managerApprovalLineId, setManagerApprovalLineId] = useState<string>("");
  const [managerApprovalAction, setManagerApprovalAction] = useState<"offered" | "discount" | "ticket-discount" | null>(null);
  const [managerApprovalCode, setManagerApprovalCode] = useState("");
  const [managerApprovalLoading, setManagerApprovalLoading] = useState(false);
  const [ticketDiscountModalOpen, setTicketDiscountModalOpen] = useState(false);
  const [ticketDiscountMode, setTicketDiscountMode] = useState<"percent" | "amount">("percent");
  const [ticketDiscountDraft, setTicketDiscountDraft] = useState("0");
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [mobileTicketDetailOpen, setMobileTicketDetailOpen] = useState(true);
  const [paymentEntries, setPaymentEntries] = useState<PaymentEntry[]>([]);
  const [paymentDraft, setPaymentDraft] = useState("0");
  const [paymentDraftPrimed, setPaymentDraftPrimed] = useState(false);
  const [selectedPaymentMethodCode, setSelectedPaymentMethodCode] = useState("CASH");
  const [currencyPaymentModalOpen, setCurrencyPaymentModalOpen] = useState(false);
  const [currencyTenderDraft, setCurrencyTenderDraft] = useState("0");
  const [currencyTenderPrimed, setCurrencyTenderPrimed] = useState(false);
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);
  const [voucherNumberDraft, setVoucherNumberDraft] = useState("");
  const [voucherLookupLoading, setVoucherLookupLoading] = useState(false);
  const [voucherLookup, setVoucherLookup] = useState<VoucherLookup | null>(null);
  const [paymentReferenceModalOpen, setPaymentReferenceModalOpen] = useState(false);
  const [paymentReferenceDraft, setPaymentReferenceDraft] = useState("");
  const [paymentReferenceMethod, setPaymentReferenceMethod] = useState<{ code: string; label: string; fieldLabel: string; title: string } | null>(null);
  const [customerCreditsModalOpen, setCustomerCreditsModalOpen] = useState(false);
  const [customerCreditsLoading, setCustomerCreditsLoading] = useState(false);
  const [customerCreditsData, setCustomerCreditsData] = useState<CustomerCreditsPayload | null>(null);
  const [customerCreditFilters, setCustomerCreditFilters] = useState({ query: "", status: "open", dateFrom: "", dateTo: "" });
  const [selectedCustomerCreditId, setSelectedCustomerCreditId] = useState("");
  const [customerCreditRepaymentForm, setCustomerCreditRepaymentForm] = useState({ repaymentId: "", amount: "", method: "CASH", reference: "", note: "" });
  const [customerCreditSaving, setCustomerCreditSaving] = useState(false);
  const [cashReportModalOpen, setCashReportModalOpen] = useState(false);
  const [cashReportLoading, setCashReportLoading] = useState(false);
  const [cashReportType, setCashReportType] = useState<CashReportType>("X");
  const [cashAdminTab, setCashAdminTab] = useState<CashAdminTab>("report-x");
  const [cashReportDate, setCashReportDate] = useState("");
  const [cashReportDateFrom, setCashReportDateFrom] = useState("");
  const [cashReportDateTo, setCashReportDateTo] = useState("");
  const [cashReportRegisterId, setCashReportRegisterId] = useState("");
  const [cashReportData, setCashReportData] = useState<PosCashReport | null>(null);
  const [cashSessionsOverview, setCashSessionsOverview] = useState<PosCashSessionsOverview | null>(null);
  const [cashSessionModalOpen, setCashSessionModalOpen] = useState(false);
  const [openingCashMad, setOpeningCashMad] = useState("0");
  const [openingCashEur, setOpeningCashEur] = useState("0");
  const [openingCashUsd, setOpeningCashUsd] = useState("0");
  const [openingCurrencyTarget, setOpeningCurrencyTarget] = useState<"MAD" | "EUR" | "USD">("MAD");
  const [openingSessionLoading, setOpeningSessionLoading] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [heldTickets, setHeldTickets] = useState<HeldTicket[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ warehouseId: "", registerId: "", customerId: "", transporterId: "", sellerName: "", note: "", paymentMethod: "CASH", paymentAmount: "0", shippingFee: "0" });
  const articleTapRef = useRef(0);
  const globalScannerBufferRef = useRef("");
  const globalScannerLastKeyAtRef = useRef(0);
  const globalScannerResetTimerRef = useRef<number | null>(null);
  const posBootstrapRef = useRef<PosBootstrapPayload | null>(null);

  function hydratePosState(productList: Product[], bootstrap: PosBootstrapPayload) {
    posBootstrapRef.current = bootstrap;
    setCatalog(productList);
    setCustomers(bootstrap.customers);
    setWarehouses(bootstrap.warehouses);
    setRegisters(bootstrap.registers);
    setSellers(bootstrap.sellers);
    setTransporters(bootstrap.transporters);
    setCurrencies(bootstrap.currencies ?? []);
    setPaymentMethods(bootstrap.paymentMethods?.length ? bootstrap.paymentMethods : defaultPaymentMethods.map((code) => ({ id: code.toLowerCase(), code, label: code, isActive: true })));
    setCompany(bootstrap.company ?? null);
    setCurrencyId((current) => current || bootstrap.currencies?.find((currency) => currency.code !== "MAD")?.id || bootstrap.currencies?.[0]?.id || "");
    setForm((current) => {
      const nextWarehouseId = current.warehouseId || user?.defaultWarehouse?.id || bootstrap.warehouses[0]?.id || "";
      const nextRegisterId = current.registerId || bootstrap.registers.find((register) => register.warehouseId === nextWarehouseId)?.id || bootstrap.registers[0]?.id || "";
      return { ...current, warehouseId: nextWarehouseId, registerId: nextRegisterId };
    });
  }

  async function load(query = "", options: { showLoading?: boolean } = { showLoading: true }) {
    const shouldShowLoading = options.showLoading !== false;
    if (shouldShowLoading) setLoading(true);
    const catalogParams = new URLSearchParams();
    if (query) catalogParams.set("query", query);
    const catalogWarehouseId = form.warehouseId || user?.defaultWarehouse?.id || "";
    if (catalogWarehouseId) catalogParams.set("warehouseId", catalogWarehouseId);
    const catalogUrl = `/pos/catalog${catalogParams.toString() ? `?${catalogParams.toString()}` : ""}`;
    try {
      const shouldRefreshBootstrap = shouldShowLoading || !posBootstrapRef.current;
      const [productList, bootstrap] = await Promise.all([
        api<Product[]>(catalogUrl),
        shouldRefreshBootstrap ? api<PosBootstrapPayload>("/pos/bootstrap") : Promise.resolve(posBootstrapRef.current as PosBootstrapPayload)
      ]);
      hydratePosState(productList, bootstrap);
      rememberPosSnapshot({ productList, bootstrap });
      return productList;
    } catch (error) {
      const cached = readPosSnapshot<{ productList: Product[]; bootstrap: PosBootstrapPayload }>();
      if (cached && isNetworkError(error)) {
        hydratePosState(cached.productList, cached.bootstrap);
        setMessage("Mode hors ligne: catalogue caisse charge depuis cet ordinateur.");
        return cached.productList;
      }
      setMessage(error instanceof Error ? error.message : "Chargement caisse impossible.");
      setCatalog([]);
      return [];
    } finally {
      if (shouldShowLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!articleModalOpen) return;
    window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-pos-article-search]")?.focus(), 40);
  }, [articleModalOpen]);

  useEffect(() => {
    if (!clientModalOpen) return;
    window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-pos-client-search]")?.focus(), 40);
  }, [clientModalOpen]);

  useEffect(() => {
    if (!sellerModalOpen) return;
    window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-pos-seller-search]")?.focus(), 40);
  }, [sellerModalOpen]);

  useEffect(() => {
    if (!voucherModalOpen && !creditNoteModalOpen && !deliveryOrderModalOpen) return;
    window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-pos-modal-search]")?.focus(), 40);
  }, [voucherModalOpen, creditNoteModalOpen, deliveryOrderModalOpen]);

  const scannerCaptureEnabled = !articleModalOpen
    && !clientModalOpen
    && !sellerModalOpen
    && !shippingModalOpen
    && !orderModalOpen
    && !creditNoteModalOpen
    && !deliveryOrderModalOpen
    && !quantityModalOpen
    && !lineDiscountModalOpen
    && !ticketLineActionModalOpen
    && !managerApprovalModalOpen
    && !ticketDiscountModalOpen
    && !checkoutModalOpen
    && !currencyPaymentModalOpen
    && !voucherModalOpen
    && !paymentReferenceModalOpen
    && !cashReportModalOpen
    && !cashSessionModalOpen;

  useEffect(() => {
    if (!scannerCaptureEnabled) return;

    function clearScannerBuffer() {
      globalScannerBufferRef.current = "";
      globalScannerLastKeyAtRef.current = 0;
      if (globalScannerResetTimerRef.current) {
        window.clearTimeout(globalScannerResetTimerRef.current);
        globalScannerResetTimerRef.current = null;
      }
    }

    function scheduleReset() {
      if (globalScannerResetTimerRef.current) {
        window.clearTimeout(globalScannerResetTimerRef.current);
      }
      globalScannerResetTimerRef.current = window.setTimeout(() => {
        clearScannerBuffer();
      }, 120);
    }

    function handleGlobalScannerKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName?.toLowerCase();
        const isEditable = target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
        if (isEditable) return;
      }

      if (event.key === "Enter") {
        const scannedCode = globalScannerBufferRef.current.trim();
        if (!scannedCode) return;
        event.preventDefault();
        setSearch(scannedCode);
        void scanCode(scannedCode);
        clearScannerBuffer();
        return;
      }

      if (event.key.length !== 1) return;

      const now = Date.now();
      if (now - globalScannerLastKeyAtRef.current > 80) {
        globalScannerBufferRef.current = "";
      }

      globalScannerLastKeyAtRef.current = now;
      globalScannerBufferRef.current = `${globalScannerBufferRef.current}${event.key}`;
      scheduleReset();
    }

    window.addEventListener("keydown", handleGlobalScannerKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalScannerKeyDown);
      clearScannerBuffer();
    };
  }, [scannerCaptureEnabled, scanCode]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const todayIso = useMemo(() => new Date().toLocaleDateString("en-CA"), []);

  const cartBaseSubtotal = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.price, 0), [cart]);
  const lineDiscountTotal = useMemo(() => cart.reduce((sum, line) => sum + Math.min(line.quantity * line.price, line.discountAmount), 0), [cart]);
  const ticketDiscountBase = useMemo(() => Math.max(0, cartBaseSubtotal - lineDiscountTotal), [cartBaseSubtotal, lineDiscountTotal]);
  const ticketDiscountValue = useMemo(() => {
    const draftValue = Number(ticketDiscountDraft || 0);
    if (draftValue <= 0) return 0;
    if (ticketDiscountMode === "percent") return Math.min(ticketDiscountBase, (ticketDiscountBase * draftValue) / 100);
    return Math.min(ticketDiscountBase, draftValue);
  }, [ticketDiscountBase, ticketDiscountDraft, ticketDiscountMode]);
  const cartSubtotal = useMemo(() => Math.max(0, ticketDiscountBase - ticketDiscountValue), [ticketDiscountBase, ticketDiscountValue]);
  const shippingFeeValue = useMemo(() => Number(form.shippingFee || 0), [form.shippingFee]);
  const grandTotal = useMemo(() => cartSubtotal + shippingFeeValue, [cartSubtotal, shippingFeeValue]);
  const selectedCurrency = useMemo(() => currencies.find((currency) => currency.id === currencyId) ?? null, [currencies, currencyId]);
  const convertedGrandTotal = useMemo(() => grandTotal * Number(selectedCurrency?.rateFromMad ?? 1), [grandTotal, selectedCurrency]);
  const selectedCustomer = useMemo(() => customers.find((customer) => customer.id === form.customerId) ?? null, [customers, form.customerId]);
  const selectedWarehouse = useMemo(() => warehouses.find((warehouse) => warehouse.id === form.warehouseId) ?? null, [form.warehouseId, warehouses]);
  const selectedRegister = useMemo(() => registers.find((register) => register.id === form.registerId) ?? null, [form.registerId, registers]);
  const customerName = useMemo(() => selectedCustomer?.fullName ?? "Client comptoir", [selectedCustomer]);
  const orderRemaining = useMemo(() => Math.max(0, Number(orderForm.totalAmount || 0) - Number(orderForm.depositAmount || 0)), [orderForm.depositAmount, orderForm.totalAmount]);
  const activePaymentMethods = useMemo(() => paymentMethods.filter((method) => method.isActive !== false), [paymentMethods]);
  const paymentMethodLabelMap = useMemo(
    () => new Map(activePaymentMethods.map((method) => [normalizePaymentMethodToken(method.code), method.label])),
    [activePaymentMethods]
  );
  const availableRegisters = useMemo(
    () => registers.filter((register) => !form.warehouseId || register.warehouseId === form.warehouseId),
    [form.warehouseId, registers]
  );
  const canManageCash = Boolean(user?.permissions.includes("cash_manage"));
  const canSeeCashAdmin = Boolean(user?.roles.includes("admin"));
  const canManageCustomerCredits = Boolean(user?.roles.includes("admin") || user?.permissions.includes("sales_manage"));
  const isCashierSession = Boolean(user?.roles.includes("caissier")) && !canSeeCashAdmin;
  const customerCreditRows = customerCreditsData?.rows ?? [];
  const selectedCustomerCredit = useMemo(
    () => customerCreditRows.find((row) => row.id === selectedCustomerCreditId) ?? customerCreditRows[0] ?? null,
    [customerCreditRows, selectedCustomerCreditId]
  );
  const customerCreditPaymentMethods = useMemo(
    () => activePaymentMethods.filter((method) => !isCreditPaymentMethod(method.code, method.label)),
    [activePaymentMethods]
  );
  const eurCurrency = useMemo(() => currencies.find((currency) => currency.code.toUpperCase() === "EUR") ?? null, [currencies]);
  const usdCurrency = useMemo(() => currencies.find((currency) => currency.code.toUpperCase() === "USD") ?? null, [currencies]);
  const paidAmount = useMemo(() => paymentEntries.reduce((sum, entry) => sum + entry.amountMad, 0), [paymentEntries]);
  const formatPosPaymentMethodLabel = (method: string) => {
    const normalized = normalizePaymentMethodToken(method).replace(/\s+/g, "_");
    return paymentMethodLabelMap.get(normalized)
      || (
        normalized === "CASH" ? "Espece"
          : normalized === "CARD" ? "Carte bancaire"
            : normalized === "TRANSFER" ? "Virement"
              : normalized === "CHEQUE" ? "Cheque"
                : normalized === "CREDIT" ? "Credit"
                  : normalized === "VOUCHER" ? "Bon achat"
                    : normalized === "FOREIGN_CURRENCY" ? "Devise"
                      : normalized === "MIXED" ? "Mixte"
                        : normalized.replace(/_/g, " ")
      );
  };
  const remainingToPay = useMemo(() => Math.max(0, grandTotal - paidAmount), [grandTotal, paidAmount]);
  const changeDue = useMemo(() => Math.max(0, paidAmount - grandTotal), [grandTotal, paidAmount]);
  const reportRegisters = useMemo(() => {
    if (!isCashierSession) return availableRegisters;
    return availableRegisters.filter((register) => register.id === form.registerId);
  }, [availableRegisters, form.registerId, isCashierSession]);
  const filteredCashSessionHistory = useMemo(
    () => (cashSessionsOverview?.history ?? []).filter((entry) => !cashReportRegisterId || entry.register.id === cashReportRegisterId),
    [cashSessionsOverview, cashReportRegisterId]
  );
  const filteredCashRegisterSummaries = useMemo(
    () => (cashSessionsOverview?.registers ?? []).filter((entry) => !cashReportRegisterId || entry.register.id === cashReportRegisterId),
    [cashSessionsOverview, cashReportRegisterId]
  );
  const messageTone = useMemo<"success" | "error" | "info">(() => {
    const normalized = String(message ?? "").toLowerCase();
    if (!normalized) return "info";
    if (
      normalized.includes("impossible")
      || normalized.includes("introuvable")
      || normalized.includes("invalide")
      || normalized.includes("obligatoire")
      || normalized.includes("choisis d'abord")
      || normalized.includes("ouvre d'abord")
      || normalized.includes("aucune devise")
      || normalized.includes("verifie d'abord")
      || normalized.includes("bloquee")
      || normalized.includes("insuffisant")
    ) {
      return "error";
    }
    if (
      normalized.includes("avec succes")
      || normalized.includes("autorisee")
      || normalized.includes("ajoute")
      || normalized.includes("selectionne")
      || normalized.includes("repris")
      || normalized.includes("annule")
      || normalized.includes("ouverte")
      || normalized.includes("enregistree")
      || normalized.includes("lancee")
      || normalized.includes("genere")
      || normalized.includes("mis en attente")
    ) {
      return "success";
    }
    return "info";
  }, [message]);
  const cashReportPaymentTotals = useMemo(() => ({
    totalDayNet: cashReportData?.reportBreakdown.totalDayNet ?? 0,
    card: cashReportData?.reportBreakdown.cardAmount ?? 0,
    cash: cashReportData?.reportBreakdown.cashAmount ?? 0,
    currency: cashReportData?.reportBreakdown.foreignAmount ?? 0,
    euro: cashReportData?.reportBreakdown.euroAmount ?? 0,
    usd: cashReportData?.reportBreakdown.usdAmount ?? 0,
    voucher: cashReportData?.reportBreakdown.voucherAmount ?? 0,
    credit: cashReportData?.reportBreakdown.creditAmount ?? 0,
    transfer: cashReportData?.reportBreakdown.transferAmount ?? 0,
    cheque: cashReportData?.reportBreakdown.chequeAmount ?? 0
  }), [cashReportData]);
  const cashReportOpeningMad = useMemo(
    () => cashReportData?.session?.openingBreakdown.find((entry) => entry.currencyCode === "MAD") ?? null,
    [cashReportData]
  );
  const cashReportOpeningEur = useMemo(
    () => cashReportData?.session?.openingBreakdown.find((entry) => entry.currencyCode === "EUR") ?? null,
    [cashReportData]
  );
  const cashReportClosingMad = useMemo(
    () => cashReportData?.session?.closingBreakdown.find((entry) => entry.currencyCode === "MAD") ?? null,
    [cashReportData]
  );
  const cashReportClosingEur = useMemo(
    () => cashReportData?.session?.closingBreakdown.find((entry) => entry.currencyCode === "EUR") ?? null,
    [cashReportData]
  );
  const paymentCurrency = useMemo(() => currencies.find((currency) => currency.id === currencyId) ?? currencies.find((currency) => currency.code !== "MAD") ?? currencies[0] ?? null, [currencies, currencyId]);
  const currencyAmountToPayMad = useMemo(() => {
    const draftAmount = Number(paymentDraft || 0);
    return Number(Math.max(0, draftAmount > 0 ? draftAmount : remainingToPay).toFixed(2));
  }, [paymentDraft, remainingToPay]);
  const currencyDueAmount = useMemo(() => paymentCurrency ? currencyAmountToPayMad * Number(paymentCurrency.rateFromMad || 1) : 0, [currencyAmountToPayMad, paymentCurrency]);
  const currencyTenderAmount = useMemo(() => Number(currencyTenderDraft || 0), [currencyTenderDraft]);
  const currencyTenderMad = useMemo(() => paymentCurrency && Number(paymentCurrency.rateFromMad) > 0 ? currencyTenderAmount / Number(paymentCurrency.rateFromMad) : 0, [paymentCurrency, currencyTenderAmount]);
  const currencyChangeMad = useMemo(() => Math.max(0, currencyTenderMad - currencyAmountToPayMad), [currencyTenderMad, currencyAmountToPayMad]);
  const currencyChangeAmount = useMemo(() => paymentCurrency ? currencyChangeMad * Number(paymentCurrency.rateFromMad || 1) : 0, [paymentCurrency, currencyChangeMad]);
  const voucherRequestedAmount = useMemo(() => {
    const draft = Number(paymentDraft || 0);
    return draft > 0 ? draft : remainingToPay;
  }, [paymentDraft, remainingToPay]);
  const voucherAmountToUse = useMemo(() => voucherLookup ? Number(Math.max(0, Math.min(Number(voucherLookup.balanceAmount), remainingToPay, voucherRequestedAmount)).toFixed(2)) : 0, [voucherLookup, remainingToPay, voucherRequestedAmount]);
  const voucherBalanceAfter = useMemo(() => voucherLookup ? Number(Math.max(0, Number(voucherLookup.balanceAmount) - voucherAmountToUse).toFixed(2)) : 0, [voucherLookup, voucherAmountToUse]);
  const filteredCustomers = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return customers.slice(0, 12);
    return customers.filter((customer) =>
      customer.fullName.toLowerCase().includes(query) ||
      customer.phone?.toLowerCase().includes(query) ||
      customer.email?.toLowerCase().includes(query)
    ).slice(0, 12);
  }, [clientSearch, customers]);
  const selectedSellerNames = useMemo(() => form.sellerName ? form.sellerName.split(" + ").filter(Boolean) : [], [form.sellerName]);
  const filteredSellers = useMemo(() => {
    const query = sellerSearch.trim().toLowerCase();
    if (!query) return sellers;
    return sellers.filter((seller) => seller.fullName.toLowerCase().includes(query));
  }, [sellerSearch, sellers]);
  const filteredCatalog = useMemo(() => {
    const query = articleSearch.trim().toLowerCase();
    if (!query) return catalog.slice(0, 120);
    const compactQuery = query.replace(/[^a-z0-9]+/g, "");
    return catalog.filter((product) => {
      const priceLabel = product.salePriceTtc.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s+/g, "");
      const searchText = [product.name, product.reference, product.barcode, product.color, product.size].filter(Boolean).join(" ").toLowerCase();
      const compactText = searchText.replace(/[^a-z0-9]+/g, "");
      return searchText.includes(query) || compactText.includes(compactQuery) || compactText.endsWith(compactQuery) || priceLabel.includes(compactQuery) || String(product.salePriceTtc).includes(compactQuery);
    }).slice(0, 120);
  }, [articleSearch, catalog]);

  useEffect(() => {
    if (!cashReportDate) {
      setCashReportDate(todayIso);
    }
  }, [cashReportDate, todayIso]);

  useEffect(() => {
    if (!cashReportDateFrom) {
      setCashReportDateFrom(todayIso);
    }
    if (!cashReportDateTo) {
      setCashReportDateTo(todayIso);
    }
  }, [cashReportDateFrom, cashReportDateTo, todayIso]);

  useEffect(() => {
    if (!availableRegisters.length) {
      if (cashReportRegisterId) setCashReportRegisterId("");
      return;
    }
    if (!availableRegisters.some((register) => register.id === cashReportRegisterId)) {
      setCashReportRegisterId(availableRegisters[0]?.id ?? "");
    }
  }, [availableRegisters, cashReportRegisterId]);

  useEffect(() => {
    if (!availableRegisters.length) {
      if (form.registerId) {
        setForm((current) => ({ ...current, registerId: "" }));
      }
      return;
    }
    if (!availableRegisters.some((register) => register.id === form.registerId)) {
      setForm((current) => ({ ...current, registerId: availableRegisters[0]?.id || "" }));
    }
  }, [availableRegisters, form.registerId]);

  function formatReportDateLabel(value: string) {
    if (!value) return "-";
    return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  }

  function convertForeignToMad(amount: number, rateFromMad?: number | null) {
    if (!rateFromMad || rateFromMad <= 0) return 0;
    return amount / rateFromMad;
  }

  function resolveRateFromMad(currencyCode: "MAD" | "EUR" | "USD", rateFromMad?: number | null) {
    const configuredRate = Number(rateFromMad ?? 0);
    if (configuredRate > 0) return configuredRate;
    if (currencyCode === "EUR") return 0.09206;
    if (currencyCode === "USD") return 0.1;
    return 1;
  }

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.lineId === product.id);
      if (existing) {
        return current.map((line) => line.lineId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, {
        lineId: product.id,
        productId: product.productId,
        variantId: product.variantId ?? null,
        reference: product.reference,
        barcode: product.barcode ?? null,
        name: product.name,
        color: product.color ?? null,
        size: product.size ?? null,
        imageUrl: product.imageUrl ?? null,
        quantity: 1,
        price: Number(product.salePriceTtc),
        discountAmount: 0
      }];
    });
    setMessage(null);
  }

  function openQuantityModal(line: CartLine) {
    setActiveQuantityLineId(line.lineId);
    setQuantityDraft(String(line.quantity));
    setQuantityModalOpen(true);
  }

  function appendQuantityKey(value: string) {
    setQuantityDraft((current) => current === "0" ? value : `${current}${value}`);
  }

  function deleteQuantityKey() {
    setQuantityDraft((current) => current.slice(0, -1) || "0");
  }

  function clearQuantityDraft() {
    setQuantityDraft("0");
  }

  function applyQuantityDraft() {
    const nextQuantity = Math.max(1, Number(quantityDraft || 0));
    setCart((current) => current.map((item) => item.lineId === activeQuantityLineId ? { ...item, quantity: nextQuantity } : item));
    setQuantityModalOpen(false);
    setActiveQuantityLineId("");
    setQuantityDraft("1");
  }

  function openLineDiscountModal(line: CartLine) {
    setActiveDiscountLineId(line.lineId);
    setLineDiscountMode("amount");
    setLineDiscountDraft(String(line.discountAmount || 0));
    setLineDiscountModalOpen(true);
  }

  function openTicketLineActionModal(line: CartLine) {
    if (line.kind === "ORDER_DEPOSIT") return;
    setTicketLineActionLineId(line.lineId);
    setTicketLineActionModalOpen(true);
  }

  function closeTicketLineActionModal() {
    setTicketLineActionModalOpen(false);
    setTicketLineActionLineId("");
  }

  function requestManagerApproval(action: "offered" | "discount") {
    if (!ticketLineActionLineId) return;
    setManagerApprovalLineId(ticketLineActionLineId);
    setManagerApprovalAction(action);
    setManagerApprovalCode("");
    setManagerApprovalLoading(false);
    setManagerApprovalModalOpen(true);
    closeTicketLineActionModal();
  }

  function requestTicketDiscountApproval() {
    setManagerApprovalLineId("");
    setManagerApprovalAction("ticket-discount");
    setManagerApprovalCode("");
    setManagerApprovalLoading(false);
    setManagerApprovalModalOpen(true);
  }

  function closeManagerApprovalModal() {
    setManagerApprovalModalOpen(false);
    setManagerApprovalLineId("");
    setManagerApprovalAction(null);
    setManagerApprovalCode("");
    setManagerApprovalLoading(false);
  }

  function getCatalogLinePrice(line: CartLine) {
    const catalogLine = catalog.find((item) => {
      if (line.variantId) return item.variantId === line.variantId;
      return item.productId === line.productId && !item.variantId;
    });
    return catalogLine?.salePriceTtc ?? line.price;
  }

  function cancelOfferedLine(lineId: string) {
    setCart((current) => current.map((item) => item.lineId === lineId ? { ...item, price: getCatalogLinePrice(item) } : item));
    setMessage("Offert annule.");
  }

  function cancelLineDiscount(lineId: string) {
    setCart((current) => current.map((item) => item.lineId === lineId ? { ...item, discountAmount: 0 } : item));
    setMessage("Remise annulee.");
  }

  async function confirmManagerApproval() {
    if (!managerApprovalAction) return;
    const line = managerApprovalLineId ? cart.find((item) => item.lineId === managerApprovalLineId) : null;
    if ((managerApprovalAction === "offered" || managerApprovalAction === "discount") && !line) {
      closeManagerApprovalModal();
      return;
    }

    setManagerApprovalLoading(true);
    try {
      const manager = await api<ManagerAuthorizationResult>("/pos/manager-authorization", {
        method: "POST",
        body: JSON.stringify({
          code: managerApprovalCode,
          warehouseId: form.warehouseId || user?.defaultWarehouse?.id || null
        })
      });

      if (managerApprovalAction === "offered") {
        setCart((current) => current.map((item) => item.lineId === managerApprovalLineId ? { ...item, price: 0, discountAmount: 0 } : item));
        setMessage(`Article offert valide par ${manager.fullName}.`);
      } else if (managerApprovalAction === "discount" && line) {
        openLineDiscountModal(line);
        setMessage(`Remise article autorisee par ${manager.fullName}.`);
      } else {
        openTicketDiscountModal();
        setMessage(`Remise ticket autorisee par ${manager.fullName}.`);
      }

      closeManagerApprovalModal();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Autorisation manager impossible.");
      setManagerApprovalLoading(false);
    }
  }

  useEffect(() => {
    if (!managerApprovalModalOpen || managerApprovalLoading) return;
    const normalizedCode = managerApprovalCode.trim();
    if (!/^mgr[-:]/i.test(normalizedCode)) return;

    const timeout = window.setTimeout(() => {
      void confirmManagerApproval();
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [managerApprovalCode, managerApprovalLoading, managerApprovalModalOpen]);

  function appendLineDiscountKey(value: string) {
    setLineDiscountDraft((current) => {
      if (value === ".") return current.includes(".") ? current : `${current}.`;
      if (current === "0") return value;
      return `${current}${value}`;
    });
  }

  function deleteLineDiscountKey() {
    setLineDiscountDraft((current) => current.slice(0, -1) || "0");
  }

  function clearLineDiscountDraft() {
    setLineDiscountDraft("0");
  }

  function selectLineDiscountPercent(value: number) {
    setLineDiscountMode("percent");
    setLineDiscountDraft(String(value));
  }

  function applyLineDiscountDraft() {
    const line = cart.find((item) => item.lineId === activeDiscountLineId);
    const maxDiscount = line ? line.quantity * line.price : 0;
    const rawValue = Number(lineDiscountDraft || 0);
    const nextDiscount = lineDiscountMode === "percent" ? Math.min(maxDiscount, (maxDiscount * rawValue) / 100) : Math.min(maxDiscount, rawValue);
    setCart((current) => current.map((item) => item.lineId === activeDiscountLineId ? { ...item, discountAmount: Number(nextDiscount.toFixed(2)) } : item));
    setLineDiscountModalOpen(false);
    setActiveDiscountLineId("");
    setLineDiscountDraft("0");
    setLineDiscountMode("amount");
  }

  function openTicketDiscountModal() {
    setTicketDiscountMode("percent");
    setTicketDiscountDraft("0");
    setTicketDiscountModalOpen(true);
  }

  function appendTicketDiscountKey(value: string) {
    setTicketDiscountDraft((current) => {
      if (value === ".") return current.includes(".") ? current : `${current}.`;
      if (current === "0") return value;
      return `${current}${value}`;
    });
  }

  function deleteTicketDiscountKey() {
    setTicketDiscountDraft((current) => current.slice(0, -1) || "0");
  }

  function clearTicketDiscountDraft() {
    setTicketDiscountDraft("0");
  }

  function selectTicketDiscountPercent(value: number) {
    setTicketDiscountMode("percent");
    setTicketDiscountDraft(String(value));
  }

  function applyTicketDiscountDraft() {
    setTicketDiscountModalOpen(false);
  }

  function openShippingModal() {
    setShippingFeeDraft(form.shippingFee || "0");
    setShippingModalOpen(true);
  }

  function appendShippingFeeKey(value: string) {
    setShippingFeeDraft((current) => {
      if (value === ".") {
        return current.includes(".") ? current : `${current}.`;
      }
      if (current === "0") return value;
      return `${current}${value}`;
    });
  }

  function deleteShippingFeeKey() {
    setShippingFeeDraft((current) => {
      const nextValue = current.slice(0, -1);
      if (!nextValue || nextValue === "-") return "0";
      return nextValue;
    });
  }

  function clearShippingFeeDraft() {
    setShippingFeeDraft("0");
  }

  function applyShippingFeeDraft() {
    const normalizedValue = Math.max(0, Number(shippingFeeDraft || 0));
    setForm((current) => ({ ...current, shippingFee: String(normalizedValue) }));
    setShippingModalOpen(false);
  }

  function findExactScannedProduct(products: Product[], code: string) {
    const normalizedCode = code.trim().toLowerCase();
    if (!normalizedCode) return undefined;
    const compactCode = normalizedCode.replace(/[^a-z0-9]+/g, "");
    return products.find((product) => {
      const reference = product.reference.trim().toLowerCase();
      const barcode = product.barcode?.trim().toLowerCase() ?? "";
      const referenceCompact = reference.replace(/[^a-z0-9]+/g, "");
      const barcodeCompact = barcode.replace(/[^a-z0-9]+/g, "");
      return barcode === normalizedCode
        || reference === normalizedCode
        || (Boolean(compactCode) && barcodeCompact === compactCode)
        || (Boolean(compactCode) && referenceCompact === compactCode)
        || (Boolean(compactCode) && referenceCompact.endsWith(compactCode));
    });
  }

  function completeScan(product: Product) {
    addToCart(product);
    setSearch("");
  }

  async function scanCode(code: string, showMissingMessage = true) {
    const normalizedCode = code.trim().toLowerCase();
    if (!normalizedCode) return;

    const localMatch = findExactScannedProduct(catalog, normalizedCode);
    if (localMatch) {
      completeScan(localMatch);
      return;
    }

    try {
      const results = await load(normalizedCode, { showLoading: false });
      const remoteMatch = findExactScannedProduct(results, normalizedCode);
      if (remoteMatch) {
        completeScan(remoteMatch);
        return;
      }
      if (showMissingMessage) setMessage("Article introuvable pour ce code-barres.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Recherche scanner impossible.");
    }
  }

  async function handleScannerChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setSearch(value);
    const results = await load(value, { showLoading: false });
    if (value.trim().length >= 4) {
      const exactMatch = findExactScannedProduct(results, value);
      if (exactMatch) completeScan(exactMatch);
    }
  }

  function handleScannerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void scanCode(search);
  }

  function openArticleModal() {
    setArticleSearch("");
    setArticleKeyboardOpen(false);
    setArticleModalOpen(true);
    void load("", { showLoading: false });
  }

  function handleArticleSearchTap() {
    const now = Date.now();
    if (now - articleTapRef.current < 450) {
      setArticleKeyboardOpen(true);
    }
    articleTapRef.current = now;
  }

  async function handleArticleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setArticleSearch(value);
    await load(value, { showLoading: false });
  }

  function appendArticleSearchKey(value: string) {
    const nextValue = `${articleSearch}${value}`;
    setArticleSearch(nextValue);
    void load(nextValue, { showLoading: false });
  }

  function deleteArticleSearchKey() {
    const nextValue = articleSearch.slice(0, -1);
    setArticleSearch(nextValue);
    void load(nextValue, { showLoading: false });
  }

  function clearArticleSearch() {
    setArticleSearch("");
    void load("", { showLoading: false });
  }

  function addArticleFromModal(product: Product) {
    addToCart(product);
    setArticleModalOpen(false);
    setArticleKeyboardOpen(false);
    setArticleSearch("");
  }

  function openClientModal() {
    setClientSearch("");
    setNewClient({ fullName: "", phone: "" });
    setClientInputTarget("search");
    setClientModalOpen(true);
  }

  function selectCustomer(customer: Customer | null) {
    setForm((current) => ({ ...current, customerId: customer?.id ?? "" }));
    setClientModalOpen(false);
    setMessage(customer ? `Client selectionne: ${customer.fullName}` : "Client comptoir selectionne.");
  }

  function appendVirtualKey(value: string) {
    if (clientInputTarget === "search") {
      setClientSearch((current) => `${current}${value}`);
      return;
    }
    const key = clientInputTarget === "name" ? "fullName" : "phone";
    setNewClient((current) => ({ ...current, [key]: `${current[key]}${value}` }));
  }

  function deleteVirtualKey() {
    if (clientInputTarget === "search") {
      setClientSearch((current) => current.slice(0, -1));
      return;
    }
    const key = clientInputTarget === "name" ? "fullName" : "phone";
    setNewClient((current) => ({ ...current, [key]: current[key].slice(0, -1) }));
  }

  async function createCustomerFromPos() {
    const fullName = newClient.fullName.trim();
    if (fullName.length < 2) {
      setMessage("Nom client obligatoire.");
      return;
    }

    setCreatingClient(true);
    try {
      const customer = await api<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify({ fullName, phone: newClient.phone.trim() || null })
      });
      setCustomers((current) => [customer, ...current.filter((item) => item.id !== customer.id)]);
      selectCustomer(customer);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation client impossible.");
    } finally {
      setCreatingClient(false);
    }
  }

  function openSellerModal() {
    setSellerSearch("");
    setSellerModalOpen(true);
  }

  function toggleSeller(sellerName: string) {
    setForm((current) => {
      const currentNames = current.sellerName ? current.sellerName.split(" + ").filter(Boolean) : [];
      const nextNames = currentNames.includes(sellerName)
        ? currentNames.filter((name) => name !== sellerName)
        : [...currentNames, sellerName];
      return { ...current, sellerName: nextNames.join(" + ") };
    });
  }

  function clearSellers() {
    setForm((current) => ({ ...current, sellerName: "" }));
  }

  function appendOrderKey(value: string) {
    setOrderForm((current) => {
      const currentValue = current[orderInputTarget];
      if (orderInputTarget === "number") {
        if (!/^\d+$/.test(value)) return current;
        return { ...current, number: `${currentValue}${value}` };
      }
      if (value === "." && currentValue.includes(".")) return current;
      const normalizedValue = `${currentValue === "0" ? "" : currentValue}${value}`;
      return { ...current, [orderInputTarget]: normalizedValue };
    });
  }

  function clearOrderField() {
    setOrderForm((current) => ({
      ...current,
      [orderInputTarget]: orderInputTarget === "number" ? "" : "0"
    }));
  }

  function deleteOrderKey() {
    setOrderForm((current) => {
      const currentValue = current[orderInputTarget];
      const nextValue = currentValue.slice(0, -1);
      return {
        ...current,
        [orderInputTarget]: orderInputTarget === "number" ? nextValue : nextValue || "0"
      };
    });
  }

  function addOrderDepositLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const orderNumber = orderForm.number.trim();
    const orderTotal = Number(orderForm.totalAmount || 0);
    const depositAmount = Number(orderForm.depositAmount || 0);
    if (!orderNumber || depositAmount <= 0) {
      setMessage("Numero de commande et montant d'acompte obligatoires.");
      return;
    }
    const lineId = `ORDER-${Date.now()}`;
    setCart((current) => [...current, { lineId, productId: lineId, kind: "ORDER_DEPOSIT", orderSource: "POS", name: `Commande : ${orderNumber} - ${orderForm.type}`, quantity: 1, price: depositAmount, discountAmount: 0, orderType: orderForm.type, orderNumber, orderTotal, depositAmount }]);
    setOrderForm({ type: "Sac", number: "", totalAmount: "0", depositAmount: "0" });
    setOrderModalOpen(false);
    setMessage("Acompte commande ajoute au panier.");
  }

  function openCreditNoteModal() {
    setCreditNoteModalOpen(true);
    setCreditTicketCode("");
    setCreditTicketPreview(null);
    setCreditSelectedItems({});
    setCreditCustomerName(selectedCustomer?.fullName ?? "");
    setCreditCustomerPhone(selectedCustomer?.phone ?? "");
    setCreditReason("Retour client");
    setCreditPreviewLoading(false);
    setCreditSubmitting(false);
  }

  function closeCreditNoteModal() {
    if (creditSubmitting) return;
    setCreditNoteModalOpen(false);
    setCreditTicketCode("");
    setCreditTicketPreview(null);
    setCreditSelectedItems({});
    setCreditCustomerName("");
    setCreditCustomerPhone("");
    setCreditReason("Retour client");
  }

  async function lookupCreditTicket() {
    const ticketCode = creditTicketCode.trim();
    if (!ticketCode) {
      setMessage("Numero de ticket obligatoire.");
      return;
    }
    setCreditPreviewLoading(true);
    try {
      const preview = await api<CreditTicketPreview>("/pos/credits/preview", {
        method: "POST",
        body: JSON.stringify({ ticketCode })
      });
      setCreditTicketPreview(preview);
      setCreditCustomerName(preview.customerName || selectedCustomer?.fullName || "");
      setCreditCustomerPhone(preview.customerPhone || selectedCustomer?.phone || "");
      setCreditSelectedItems(Object.fromEntries(
        preview.items
          .filter((item) => item.remainingQty > 0)
          .map((item) => [item.saleItemId, item.remainingQty > 0 ? "0" : ""])
      ));
      setMessage(`Ticket ${preview.number} charge pour bon d'avoir.`);
    } catch (error) {
      setCreditTicketPreview(null);
      setCreditSelectedItems({});
      setMessage(error instanceof Error ? error.message : "Chargement ticket impossible.");
    } finally {
      setCreditPreviewLoading(false);
    }
  }

  function patchCreditItemQuantity(saleItemId: string, value: string) {
    setCreditSelectedItems((current) => ({ ...current, [saleItemId]: value.replace(/[^\d]/g, "") }));
  }

  function printCreditVoucherTicket(result: CreditVoucherCreated) {
    const companyName = company?.name || "Galerie des Tanneurs";
    const headerLogo = company?.logoUrl
      ? `<img src="${escapeReceiptHtml(company.logoUrl)}" alt="logo" style="height:44px;max-width:120px;object-fit:contain;margin:0 auto 6px;display:block;" />`
      : "";
    const itemsHtml = result.credit.items.map((item) => `
      <div class="line">
        <div class="name">${escapeReceiptHtml(item.productName)}</div>
        <div class="meta">${escapeReceiptHtml(item.reference || "-")} • ${item.quantity} x ${formatCurrency(item.unitPriceTtc)}</div>
        <div class="amount">${formatCurrency(item.lineTotal)}</div>
      </div>
    `).join("");
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Bon d'avoir ${escapeReceiptHtml(result.voucher.number)}</title>
          <style>
            @page { size: 80mm auto; margin: 6mm; }
            body { margin: 0; font-family: Arial, sans-serif; color: #111; }
            .ticket { width: 100%; max-width: 72mm; margin: 0 auto; }
            .center { text-align: center; }
            .brand { font-size: 11px; font-weight: 800; line-height: 1.2; }
            .title { margin: 8px 0 2px; font-size: 18px; font-weight: 800; text-transform: uppercase; }
            .sub { font-size: 11px; color: #444; line-height: 1.35; }
            .rule { border-top: 1px dashed #777; margin: 10px 0; }
            .row { display:flex; justify-content:space-between; gap:12px; margin:4px 0; font-size:12px; }
            .line { margin: 7px 0; }
            .name { font-size: 13px; font-weight: 700; }
            .meta { font-size: 11px; color:#444; margin-top:2px; }
            .amount { font-size: 12px; font-weight: 700; margin-top: 2px; }
            .total { font-size: 16px; font-weight: 800; }
            .barcode { margin: 12px 0 8px; }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="center">
              ${headerLogo}
              <div class="brand">${escapeReceiptHtml(companyName)}</div>
              <div class="sub">${escapeReceiptHtml(result.voucher.warehouseName)}</div>
              <div class="title">Bon d'avoir</div>
              <div class="sub">${escapeReceiptHtml(result.voucher.number)}</div>
            </div>
            <div class="rule"></div>
            <div class="row"><span>Ticket source</span><strong>${escapeReceiptHtml(result.credit.sourceNumber)}</strong></div>
            <div class="row"><span>Client</span><strong>${escapeReceiptHtml(result.credit.customerName)}</strong></div>
            <div class="row"><span>Telephone</span><strong>${escapeReceiptHtml(result.credit.customerPhone)}</strong></div>
            <div class="row"><span>Date</span><strong>${escapeReceiptHtml(formatDate(result.credit.createdAt))}</strong></div>
            <div class="rule"></div>
            ${itemsHtml}
            <div class="rule"></div>
            <div class="row total"><span>Montant</span><span>${formatCurrency(result.voucher.initialAmount)}</span></div>
            <div class="row"><span>Solde</span><strong>${formatCurrency(result.voucher.balanceAmount)}</strong></div>
            <div class="rule"></div>
            <div class="center">${renderReceiptTextLines(company?.ticketFooter || "Bon valable uniquement dans la boutique d'origine.", "sub")}</div>
            <div class="barcode">${buildCode39Svg(result.voucher.number)}</div>
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `;
    const printWindow = window.open("", "_blank", "width=420,height=900");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  async function createCreditVoucher() {
    if (!creditTicketPreview) {
      setMessage("Charge d'abord un ticket de caisse.");
      return;
    }
    if (!creditCustomerName.trim() || !creditCustomerPhone.trim()) {
      setMessage("Nom client et numero de telephone obligatoires.");
      return;
    }
    const items = creditTicketPreview.items
      .map((item) => ({
        saleItemId: item.saleItemId,
        quantity: Number(creditSelectedItems[item.saleItemId] || 0)
      }))
      .filter((item) => item.quantity > 0);
    if (!items.length) {
      setMessage("Choisis au moins un article pour le bon d'avoir.");
      return;
    }
    setCreditSubmitting(true);
    try {
      const result = await api<CreditVoucherCreated>("/pos/credits", {
        method: "POST",
        body: JSON.stringify({
          sourceTicketId: creditTicketPreview.id,
          customerName: creditCustomerName.trim(),
          customerPhone: creditCustomerPhone.trim(),
          reason: creditReason.trim(),
          items
        })
      });
      printCreditVoucherTicket(result);
      setMessage(`Bon d'avoir ${result.voucher.number} cree.`);
      setCreditNoteModalOpen(false);
      setCreditTicketCode("");
      setCreditTicketPreview(null);
      setCreditSelectedItems({});
      setCreditCustomerName("");
      setCreditCustomerPhone("");
      setCreditReason("Retour client");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Creation bon d'avoir impossible.");
    } finally {
      setCreditSubmitting(false);
    }
  }

  function openDeliveryOrderModal() {
    setDeliveryOrderNumber("");
    setDeliveryOrderResult(null);
    setDeliveryOrderLoading(false);
    setDeliveryOrderModalOpen(true);
  }

  function appendDeliveryOrderKey(value: string) {
    if (!/^\d+$/.test(value)) return;
    setDeliveryOrderNumber((current) => `${current}${value}`);
  }

  function deleteDeliveryOrderKey() {
    setDeliveryOrderNumber((current) => current.slice(0, -1));
  }

  function clearDeliveryOrderKey() {
    setDeliveryOrderNumber("");
  }

  async function searchDeliveryOrder() {
    const orderNumber = deliveryOrderNumber.trim();
    if (!orderNumber) {
      setMessage("Numero de commande obligatoire.");
      return;
    }

    setDeliveryOrderLoading(true);
    try {
      const result = await api<DeliveryOrderLookup>(`/pos/orders/delivery/${encodeURIComponent(orderNumber)}`);
      setDeliveryOrderResult(result);
      setMessage(null);
    } catch (error) {
      setDeliveryOrderResult(null);
      setMessage(error instanceof Error ? error.message : "Recherche commande impossible.");
    } finally {
      setDeliveryOrderLoading(false);
    }
  }

  function applyDeliveryOrderToCart() {
    if (!deliveryOrderResult) {
      setMessage("Recherche d'abord la commande.");
      return;
    }

    if (deliveryOrderResult.remainingAmount <= 0) {
      setDeliveryOrderModalOpen(false);
      setDeliveryOrderNumber("");
      setDeliveryOrderResult(null);
      setMessage("Cette commande est deja reglee.");
      return;
    }

    const lineId = `ORDER-DELIVERY-${Date.now()}`;
    setCart((current) => [...current, {
      lineId,
      productId: lineId,
      kind: "ORDER_DEPOSIT",
      name: `Livraison commande : ${deliveryOrderResult.orderNumber} - ${deliveryOrderResult.orderType}`,
      quantity: 1,
      price: deliveryOrderResult.remainingAmount,
      discountAmount: 0,
      orderSource: "LEGACY",
      orderType: deliveryOrderResult.orderType,
      orderNumber: deliveryOrderResult.orderNumber,
      orderTotal: deliveryOrderResult.orderTotal,
      depositAmount: deliveryOrderResult.remainingAmount
    }]);
    setDeliveryOrderModalOpen(false);
    setDeliveryOrderNumber("");
    setDeliveryOrderResult(null);
    setMessage("Reste de commande ajoute au panier.");
  }

  async function markDeliveryOrderAsDelivered() {
    if (!deliveryOrderResult) {
      setMessage("Recherche d'abord la commande.");
      return;
    }

    setDeliveryOrderCompleting(true);
    try {
      await api(`/pos/orders/delivery/${encodeURIComponent(deliveryOrderResult.orderNumber)}/mark-delivered`, {
        method: "POST"
      });
      setDeliveryOrderModalOpen(false);
      setDeliveryOrderNumber("");
      setDeliveryOrderResult(null);
      setMessage(`Commande ${deliveryOrderResult.orderNumber} marquee comme livree.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible de marquer la commande comme livree.");
    } finally {
      setDeliveryOrderCompleting(false);
    }
  }

  function isCurrencyPaymentMethod(code: string, label?: string | null) {
    const normalizedCode = (code || "").trim().toUpperCase();
    const normalizedLabel = (label || "").trim().toUpperCase();
    return normalizedCode === "FOREIGN_CURRENCY"
      || normalizedCode === "DEVISE"
      || normalizedLabel.includes("DEVISE")
      || normalizedLabel.includes("DEVISE")
      || normalizedLabel.includes("EURO")
      || normalizedLabel.includes("EUR");
  }

  function isVoucherPaymentMethod(code: string, label?: string | null) {
    const normalizedCode = (code || "").trim().toUpperCase();
    const normalizedLabel = (label || "").trim().toUpperCase();
    return normalizedCode === "VOUCHER" || normalizedLabel.includes("BON ACHAT") || normalizedLabel.includes("VOUCHER");
  }

  function isTransferPaymentMethod(code: string, label?: string | null) {
    const normalizedCode = (code || "").trim().toUpperCase();
    const normalizedLabel = (label || "").trim().toUpperCase();
    return normalizedCode === "TRANSFER" || normalizedLabel.includes("VIREMENT") || normalizedLabel.includes("TRANSFER");
  }

  function isChequePaymentMethod(code: string, label?: string | null) {
    const normalizedCode = (code || "").trim().toUpperCase();
    const normalizedLabel = (label || "").trim().toUpperCase();
    return normalizedCode === "CHEQUE" || normalizedLabel.includes("CHEQUE") || normalizedLabel.includes("CHÃƒË†QUE");
  }

  function isCreditPaymentMethod(code: string, label?: string | null) {
    const normalizedCode = normalizePaymentMethodToken(code);
    const normalizedLabel = normalizePaymentMethodToken(label);
    return normalizedCode === "CREDIT" || normalizedLabel.includes("CREDIT");
  }

  function normalizePaymentMethodToken(value?: string | null) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  }

  function normalizePaymentMethodForCheckout(code: string, label?: string | null) {
    const normalizedCode = normalizePaymentMethodToken(code);
    const normalizedLabel = normalizePaymentMethodToken(label);
    if (isVoucherPaymentMethod(code, label)) return "VOUCHER";
    if (isCurrencyPaymentMethod(code, label)) return "FOREIGN_CURRENCY";
    if (
      normalizedCode === "CASH" ||
      normalizedCode === "ESPECE" ||
      normalizedCode === "LIQUIDE" ||
      normalizedLabel.includes("ESPECE") ||
      normalizedLabel.includes("LIQUIDE") ||
      normalizedLabel.includes("CASH")
    ) return "CASH";
    if (
      normalizedCode === "CARD" ||
      normalizedCode === "CB" ||
      normalizedCode === "CARTE" ||
      normalizedLabel.includes("CARTE") ||
      normalizedLabel.includes("BANCAIRE") ||
      normalizedLabel.includes("CB")
    ) return "CARD";
    if (isTransferPaymentMethod(code, label)) return "TRANSFER";
    if (isChequePaymentMethod(code, label)) return "CHEQUE";
    if (isCreditPaymentMethod(code, label)) return "CREDIT";
    return defaultPaymentMethods.includes(normalizedCode) ? normalizedCode : "MIXED";
  }

  function resetPaymentDraft(nextAmount: number) {
    setPaymentDraft(String(Number(Math.max(0, nextAmount).toFixed(2))));
    setPaymentDraftPrimed(true);
  }

  async function hasOpenCashSession(registerId: string) {
    if (!form.warehouseId || !registerId) return false;
    try {
      const params = new URLSearchParams({
        warehouseId: form.warehouseId,
        registerId,
        date: todayIso
      });
      const report = await api<PosCashReport>(`/pos/reports/cash?${params.toString()}`);
      const isOpen = report.session?.status === "OPEN";
      if (isOpen) {
        rememberOpenCashSession({
          registerId,
          warehouseId: form.warehouseId,
          openedAt: report.session?.openedAt
        });
      }
      return isOpen;
    } catch {
      return hasCachedOpenCashSession({ registerId, warehouseId: form.warehouseId, date: todayIso });
    }
  }

  async function openCheckoutModal() {
    if (!form.registerId) {
      setMessage("Choisis d'abord une caisse.");
      return;
    }
    const [sessionOpen, hasSeller] = await Promise.all([
      hasOpenCashSession(form.registerId),
      Promise.resolve(Boolean(form.sellerName.trim()))
    ]);
    if (!sessionOpen || !hasSeller) {
      if (!sessionOpen && !hasSeller) {
        setMessage("Ouvre d'abord une session caisse et choisis un vendeur.");
        return;
      }
      if (!sessionOpen) {
        setMessage("Ouvre d'abord une session caisse.");
        return;
      }
      setMessage("Choisis d'abord un vendeur.");
      return;
    }
    const firstMethod = activePaymentMethods[0]?.code || "CASH";
    setSelectedPaymentMethodCode(firstMethod);
    setPaymentEntries([]);
    resetPaymentDraft(grandTotal);
    setCurrencyTenderDraft(String(Number(currencyDueAmount > 0 ? currencyDueAmount.toFixed(2) : grandTotal.toFixed(2))));
    setVoucherModalOpen(false);
    setVoucherLookup(null);
    setVoucherNumberDraft("");
    setVoucherLookupLoading(false);
    setPaymentReferenceModalOpen(false);
    setPaymentReferenceDraft("");
    setPaymentReferenceMethod(null);
    setMessage(null);
    setCheckoutModalOpen(true);
  }

  async function loadCashReport(options?: { date?: string; dateFrom?: string; dateTo?: string; registerId?: string; type?: CashReportType; silent?: boolean }) {
    const date = options?.date ?? cashReportDate ?? todayIso;
    const dateFrom = options?.dateFrom ?? cashReportDateFrom ?? todayIso;
    const dateTo = options?.dateTo ?? cashReportDateTo ?? todayIso;
    const registerId = options?.registerId ?? cashReportRegisterId;
    const reportType = options?.type ?? cashReportType;
    if (!form.warehouseId) {
      setMessage("Choisis d'abord la boutique de caisse.");
      return;
    }
    if (!options?.silent) setCashReportLoading(true);
    try {
      const params = new URLSearchParams({
        warehouseId: form.warehouseId
      });
      if (cashAdminTab === "report-periodic" || options?.dateFrom || options?.dateTo) {
        params.set("dateFrom", dateFrom);
        params.set("dateTo", dateTo);
      } else {
        params.set("date", date);
      }
      if (registerId) params.set("registerId", registerId);
      const report = await api<PosCashReport>(`/pos/reports/cash?${params.toString()}`);
      setCashReportData(report);
      setCashReportDate(date);
      setCashReportDateFrom(dateFrom);
      setCashReportDateTo(dateTo);
      setCashReportRegisterId(registerId);
      setCashReportType(reportType);
      setMessage(null);
    } catch (error) {
      setCashReportData(null);
      setMessage(error instanceof Error ? error.message : "Chargement rapport caisse impossible.");
    } finally {
      if (!options?.silent) setCashReportLoading(false);
    }
  }

  async function loadCashSessionsOverview(options?: { date?: string; registerId?: string; silent?: boolean }) {
    const date = options?.date ?? cashReportDate ?? todayIso;
    const registerId = options?.registerId ?? cashReportRegisterId;
    if (!form.warehouseId) {
      setMessage("Choisis d'abord la boutique de caisse.");
      return;
    }
    if (!options?.silent) setCashReportLoading(true);
    try {
      const params = new URLSearchParams({
        warehouseId: form.warehouseId,
        date
      });
      if (registerId) params.set("registerId", registerId);
      const overview = await api<PosCashSessionsOverview>(`/pos/sessions/overview?${params.toString()}`);
      setCashSessionsOverview(overview);
      setCashReportDate(date);
      setCashReportRegisterId(registerId);
      setMessage(null);
    } catch (error) {
      setCashSessionsOverview(null);
      setMessage(error instanceof Error ? error.message : "Chargement des sessions caisse impossible.");
    } finally {
      if (!options?.silent) setCashReportLoading(false);
    }
  }

  function openCashReportModal() {
    const nextDate = cashReportDate || todayIso;
    const nextDateFrom = cashReportDateFrom || todayIso;
    const nextDateTo = cashReportDateTo || todayIso;
    const nextRegisterId = form.registerId || cashReportRegisterId || availableRegisters[0]?.id || "";
    setCashReportDate(nextDate);
    setCashReportDateFrom(nextDateFrom);
    setCashReportDateTo(nextDateTo);
    setCashReportRegisterId(nextRegisterId);
    setCashReportType("X");
    setCashAdminTab("report-x");
    setCashReportModalOpen(true);
    void loadCashReport({ date: nextDate, registerId: nextRegisterId, type: "X" });
  }

  useEffect(() => {
    if (loading) return;
    if (searchParams.get("open") !== "cash-reports") return;
    if (!availableRegisters.length) return;
    openCashReportModal();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("open");
    setSearchParams(nextParams, { replace: true });
  }, [loading, availableRegisters, searchParams, setSearchParams]);

  function openCashSessionModal() {
    setOpeningCashMad("0");
    setOpeningCashEur("0");
    setOpeningCashUsd("0");
    setOpeningCurrencyTarget("MAD");
    setCashReportRegisterId((current) => current || form.registerId || availableRegisters[0]?.id || "");
    setCashSessionModalOpen(true);
  }

  function appendOpeningCurrencyKey(value: string) {
    const setter = openingCurrencyTarget === "MAD"
      ? setOpeningCashMad
      : openingCurrencyTarget === "EUR"
        ? setOpeningCashEur
        : setOpeningCashUsd;
    setter((current) => {
      if (value === ".") return current.includes(".") ? current : `${current}.`;
      if (current === "0") return value;
      return `${current}${value}`;
    });
  }

  function deleteOpeningCurrencyKey() {
    const setter = openingCurrencyTarget === "MAD"
      ? setOpeningCashMad
      : openingCurrencyTarget === "EUR"
        ? setOpeningCashEur
        : setOpeningCashUsd;
    setter((current) => current.slice(0, -1) || "0");
  }

  function clearOpeningCurrencyKey() {
    const setter = openingCurrencyTarget === "MAD"
      ? setOpeningCashMad
      : openingCurrencyTarget === "EUR"
        ? setOpeningCashEur
        : setOpeningCashUsd;
    setter("0");
  }

  async function submitCashOpening() {
    const registerId = cashReportRegisterId || availableRegisters[0]?.id || "";
    if (!registerId) {
      setMessage("Choisis d'abord une caisse pour l'ouverture.");
      return;
    }

    const madAmount = Number(openingCashMad || 0);
    const eurAmount = Number(openingCashEur || 0);
    const usdAmount = Number(openingCashUsd || 0);
    const eurRate = resolveRateFromMad("EUR", eurCurrency?.rateFromMad);
    const usdRate = resolveRateFromMad("USD", usdCurrency?.rateFromMad);
    const totalMad = madAmount
      + convertForeignToMad(eurAmount, eurRate)
      + convertForeignToMad(usdAmount, usdRate);

    if (totalMad <= 0) {
      setMessage("Le fond d'ouverture doit etre superieur a 0.");
      return;
    }

    setOpeningSessionLoading(true);
    try {
      await api("/pos/sessions/open", {
        method: "POST",
        body: JSON.stringify({
          registerId,
          openingAmount: Number(totalMad.toFixed(2)),
          openingBreakdown: [
            { currencyCode: "MAD", amount: madAmount, amountMad: madAmount, rateFromMad: 1 },
            { currencyCode: "EUR", amount: eurAmount, amountMad: Number(convertForeignToMad(eurAmount, eurRate).toFixed(2)), rateFromMad: eurRate },
            { currencyCode: "USD", amount: usdAmount, amountMad: Number(convertForeignToMad(usdAmount, usdRate).toFixed(2)), rateFromMad: usdRate }
          ].filter((entry) => entry.amount > 0)
        })
      });
      rememberOpenCashSession({ registerId, warehouseId: form.warehouseId });
      setCashSessionModalOpen(false);
      setMessage("Ouverture de caisse enregistree.");
      if (cashReportModalOpen) {
        await loadCashReport({ silent: true });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ouverture de caisse impossible.");
    } finally {
      setOpeningSessionLoading(false);
    }
  }

  function printCashReport() {
    if (!cashReportData) return;
    const popup = window.open("", "_blank", "width=980,height=900");
    if (!popup) {
      setMessage("Impossible d'ouvrir la fenetre d'impression du rapport caisse.");
      return;
    }

    const reportTitle = cashAdminTab === "report-end-day"
      ? "Rapport fin de journee"
      : cashReportType === "X"
        ? "Rapport X"
        : "Rapport Y";
    const paymentBreakdownRows = [
      { label: "Total Carte de Credit", value: formatCurrency(cashReportPaymentTotals.card) },
      { label: "Total Espece", value: formatCurrency(cashReportPaymentTotals.cash) },
      { label: "Total Euro", value: formatForeignCurrency(cashReportPaymentTotals.euro, "EUR") },
      { label: "Total USD", value: formatForeignCurrency(cashReportPaymentTotals.usd, "USD") },
      { label: "Avoir", value: formatCurrency(cashReportPaymentTotals.voucher) },
      { label: "Compte Clients", value: formatCurrency(cashReportPaymentTotals.credit) },
      { label: "Virement", value: formatCurrency(cashReportPaymentTotals.transfer) },
      { label: "Cheque", value: formatCurrency(cashReportPaymentTotals.cheque) }
    ].map((entry) => `<tr><td>${entry.label}</td><td style="text-align:right;"><strong>${entry.value}</strong></td></tr>`).join("");
    const openingBreakdownHtml = cashReportData.session?.openingBreakdown?.length
      ? cashReportData.session.openingBreakdown.map((entry) => `
          <tr>
            <td>${entry.currencyCode}</td>
            <td style="text-align:right;">${entry.currencyCode === "MAD" ? formatCurrency(entry.amount) : `${entry.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entry.currencyCode}`}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="2" style="text-align:center;color:#7a6859;">Aucun detail devise</td></tr>`;
    const printOpeningMad = cashReportData.session?.openingBreakdown.find((entry) => entry.currencyCode === "MAD") ?? null;
    const printOpeningEur = cashReportData.session?.openingBreakdown.find((entry) => entry.currencyCode === "EUR") ?? null;
    const printClosingMad = cashReportData.session?.closingBreakdown.find((entry) => entry.currencyCode === "MAD") ?? null;
    const printClosingEur = cashReportData.session?.closingBreakdown.find((entry) => entry.currencyCode === "EUR") ?? null;

    const ticketRows = cashReportData.ticketSummary.length
      ? cashReportData.ticketSummary.map((ticket) => `
          <tr>
            <td>${ticket.number}<br /><span style="font-size:10px;color:#7a6859;">${new Date(ticket.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></td>
            <td>${ticket.customerName}<br /><span style="font-size:10px;color:#7a6859;">${ticket.sellerName}</span></td>
            <td style="text-align:center;">${ticket.itemsCount}</td>
            <td>${ticket.payments.map((payment) => payment.label).join(", ") || "-"}</td>
            <td style="text-align:right;">${formatCurrency(ticket.totalAmount)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="5" style="text-align:center;color:#7a6859;">Aucun ticket sur cette date</td></tr>`;

    const categoryBlocks = cashReportData.categorySummary.length
      ? cashReportData.categorySummary.map((category) => `
          <section class="category-block">
            <div class="category-head">
              <div>
                <p class="overline">Categorie</p>
                <h3>${category.categoryName}</h3>
              </div>
              <div class="category-total">
                <span>${category.quantity} article(s)</span>
                <strong>${formatCurrency(category.totalAmount)}</strong>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Article</th>
                  <th style="text-align:center;">Qte</th>
                  <th style="text-align:right;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${category.articles.map((article) => `
                  <tr>
                    <td>${article.reference}</td>
                    <td>${article.name}</td>
                    <td style="text-align:center;">${article.quantity}</td>
                    <td style="text-align:right;">${formatCurrency(article.totalAmount)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </section>
        `).join("")
      : `<div class="empty">Aucun article vendu sur cette date.</div>`;

    popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>${reportTitle} - ${cashReportData.warehouse.name}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            body { font-family: Arial, sans-serif; color: #1f1712; margin: 0; }
            .page { padding: 0; }
            .top { display:flex; justify-content:space-between; gap:20px; border-bottom:2px solid #d8c4b0; padding-bottom:14px; }
            .brand h1 { margin:0; font-size:24px; }
            .brand p { margin:6px 0 0; font-size:12px; color:#6f5f53; }
            .doc { text-align:right; }
            .doc .tag { font-size:11px; letter-spacing:.28em; text-transform:uppercase; color:#a06a2e; font-weight:700; }
            .doc h2 { margin:6px 0 0; font-size:30px; }
            .meta { margin-top:16px; display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; }
            .card { border:1px solid #d9c5b1; border-radius:14px; padding:10px 12px; }
            .card .label { font-size:10px; text-transform:uppercase; letter-spacing:.18em; color:#9c6b35; font-weight:700; }
            .card .value { margin-top:6px; font-size:15px; font-weight:700; }
            .card .hint { margin-top:4px; font-size:11px; color:#6f5f53; }
            .section { margin-top:18px; }
            .section-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; margin-bottom:10px; }
            .section-head h3 { margin:0; font-size:18px; }
            .section-head p { margin:2px 0 0; font-size:12px; color:#6f5f53; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #e1d4c7; padding:8px 10px; font-size:12px; vertical-align:top; }
            th { background:#f6eee7; text-transform:uppercase; letter-spacing:.16em; font-size:10px; color:#7a5d45; text-align:left; }
            .totals { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; }
            .totals table td:first-child { color:#6f5f53; }
            .category-block { margin-top:14px; border:1px solid #e1d4c7; border-radius:16px; padding:12px; }
            .category-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; margin-bottom:10px; }
            .category-head h3 { margin:4px 0 0; font-size:16px; }
            .category-total { text-align:right; }
            .category-total span { display:block; font-size:11px; color:#6f5f53; }
            .category-total strong { display:block; margin-top:4px; font-size:16px; }
            .overline { margin:0; font-size:10px; text-transform:uppercase; letter-spacing:.18em; color:#9c6b35; font-weight:700; }
            .empty { border:1px dashed #cfb8a1; border-radius:14px; padding:18px; text-align:center; color:#7a6859; font-size:12px; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="top">
              <div class="brand">
                <p class="tag">POS / Caisse</p>
                <h1>Galerie des Tanneurs</h1>
                <p>${cashReportData.warehouse.name}${cashReportData.register ? ` - ${cashReportData.register.name}` : ""}</p>
              </div>
              <div class="doc">
                <div class="tag">${reportTitle}</div>
                <h2>${formatReportDateLabel(cashReportData.date)}</h2>
              </div>
            </div>

            <div class="meta">
              <div class="card">
                <div class="label">Total journee</div>
                <div class="value">${formatCurrency(cashReportData.totals.totalAmount)}</div>
                <div class="hint">${cashReportData.totals.ticketsCount} ticket(s)</div>
              </div>
              <div class="card">
                <div class="label">Articles vendus</div>
                <div class="value">${cashReportData.totals.articlesSold}</div>
                <div class="hint">Toutes categories</div>
              </div>
              <div class="card">
                <div class="label">Ouverture MAD</div>
                <div class="value">${printOpeningMad ? formatCurrency(printOpeningMad.amount) : "-"}</div>
                <div class="hint">${cashReportData.session ? `Ouverte par ${cashReportData.session.openedBy.fullName}` : "Aucune ouverture retrouvee"}</div>
              </div>
              <div class="card">
                <div class="label">Ouverture EUR</div>
                <div class="value">${printOpeningEur ? formatForeignCurrency(printOpeningEur.amount, "EUR") : "-"}</div>
                <div class="hint">${cashAdminTab === "report-end-day" ? "Fin de journee" : reportTitle}</div>
              </div>
            </div>

            <div class="section totals">
              <div class="card">
                <div class="label">Synthese TVA</div>
                <table>
                  <tbody>
                    ${cashAdminTab === "report-end-day" ? `<tr><td>Total journee</td><td style="text-align:right;"><strong>${formatCurrency(cashReportPaymentTotals.totalDayNet)}</strong></td></tr>` : ""}
                    <tr><td>Total HT</td><td style="text-align:right;"><strong>${formatCurrency(cashReportData.totals.subtotalHt)}</strong></td></tr>
                    <tr><td>TVA</td><td style="text-align:right;"><strong>${formatCurrency(cashReportData.totals.taxAmount)}</strong></td></tr>
                    <tr><td>Remises</td><td style="text-align:right;"><strong>${formatCurrency(cashReportData.totals.discountAmount)}</strong></td></tr>
                    <tr><td>Frais de port</td><td style="text-align:right;"><strong>${formatCurrency(cashReportData.totals.shippingFee)}</strong></td></tr>
                    ${paymentBreakdownRows}
                  </tbody>
                </table>
              </div>
              <div class="card">
                <div class="label">${cashAdminTab === "report-end-day" ? "Cloture" : "Reglement"}</div>
                <table>
                  <tbody>
                    ${cashAdminTab === "report-end-day"
                      ? `
                    <tr><td>Cloture MAD</td><td style="text-align:right;"><strong>${printClosingMad ? formatCurrency(printClosingMad.amount) : cashReportData.session?.closingAmount != null ? formatCurrency(cashReportData.session.closingAmount) : "-"}</strong></td></tr>
                    <tr><td>Cloture EUR</td><td style="text-align:right;"><strong>${printClosingEur ? formatForeignCurrency(printClosingEur.amount, "EUR") : "-"}</strong></td></tr>
                    `
                      : `
                    <tr><td>Total TTC</td><td style="text-align:right;"><strong>${formatCurrency(cashReportData.totals.totalAmount)}</strong></td></tr>
                    <tr><td>Total encaisse</td><td style="text-align:right;"><strong>${formatCurrency(cashReportData.totals.paidAmount)}</strong></td></tr>
                    `}
                    <tr><td>Etat rapport</td><td style="text-align:right;"><strong>${reportTitle}</strong></td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="section">
              <div class="section-head">
                <div>
                  <h3>Fond d'ouverture</h3>
                  <p>Detail du fond d'ouverture de caisse</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Devise</th>
                    <th style="text-align:right;">Montant</th>
                  </tr>
                </thead>
                <tbody>${openingBreakdownHtml}</tbody>
              </table>
            </div>

            <div class="section">
              <div class="section-head">
                <div>
                  <h3>Articles vendus par categorie</h3>
                  <p>Detail des articles et total de chaque categorie</p>
                </div>
              </div>
              ${categoryBlocks}
            </div>

            <div class="section">
              <div class="section-head">
                <div>
                  <h3>Tickets du jour</h3>
                  <p>Resume compact des tickets encaisses</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Client / Vendeur</th>
                    <th style="text-align:center;">Qte</th>
                    <th>Paiement</th>
                    <th style="text-align:right;">Total</th>
                  </tr>
                </thead>
                <tbody>${ticketRows}</tbody>
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

  function printEndDayTicket() {
    if (!cashReportData || cashAdminTab !== "report-end-day") return;
    const popup = window.open("", "_blank", "width=420,height=900");
    if (!popup) {
      setMessage("Impossible d'ouvrir l'impression fin de journee.");
      return;
    }

    const openingMad = cashReportOpeningMad ? formatCurrency(cashReportOpeningMad.amount) : "-";
    const openingEur = cashReportOpeningEur ? formatForeignCurrency(cashReportOpeningEur.amount, "EUR") : "-";
    const closingMad = cashReportClosingMad
      ? formatCurrency(cashReportClosingMad.amount)
      : cashReportData.session?.closingAmount != null
        ? formatCurrency(cashReportData.session.closingAmount)
        : "-";
    const closingEur = cashReportClosingEur ? formatForeignCurrency(cashReportClosingEur.amount, "EUR") : "-";
    const varianceMad = formatCurrency(Number(cashReportClosingMad?.amount ?? 0) - Number(cashReportOpeningMad?.amount ?? 0));
    const varianceEur = formatForeignCurrency(
      Number(cashReportClosingEur?.amount ?? 0) - Number(cashReportOpeningEur?.amount ?? 0),
      "EUR"
    );

    popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Rapport fin de journee</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111; }
            .ticket { width: 72mm; margin: 0 auto; font-size: 12px; }
            .center { text-align: center; }
            .title { margin: 0; font-size: 16px; font-weight: 700; }
            .subtitle { margin: 4px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; }
            .meta, .section { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #555; }
            .row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
            .row:last-child { margin-bottom: 0; }
            .section-title { margin: 0 0 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; }
            .footer { margin-top: 12px; border-top: 1px dashed #555; padding-top: 8px; text-align: center; font-size: 11px; }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="center">
              <p class="title">Rapport fin de journee</p>
              <p class="subtitle">Cloture de caisse</p>
            </div>

            <div class="meta">
              <div class="row"><span>Date</span><strong>${formatReportDateLabel(cashReportData.date)}</strong></div>
              <div class="row"><span>Boutique</span><strong>${cashReportData.warehouse.name}</strong></div>
              <div class="row"><span>Caisse</span><strong>${cashReportData.register?.name || "-"}</strong></div>
            </div>

            <div class="section">
              <p class="section-title">Total journee</p>
              <div class="row"><span>Total journee</span><strong>${formatCurrency(cashReportPaymentTotals.totalDayNet)}</strong></div>
              <div class="row"><span>Total HT</span><strong>${formatCurrency(cashReportData.totals.subtotalHt)}</strong></div>
              <div class="row"><span>TVA</span><strong>${formatCurrency(cashReportData.totals.taxAmount)}</strong></div>
              <div class="row"><span>Remises</span><strong>${formatCurrency(cashReportData.totals.discountAmount)}</strong></div>
              <div class="row"><span>Frais de port</span><strong>${formatCurrency(cashReportData.totals.shippingFee)}</strong></div>
              <div class="row"><span>Total Carte de Credit</span><strong>${formatCurrency(cashReportPaymentTotals.card)}</strong></div>
              <div class="row"><span>Total Espece</span><strong>${formatCurrency(cashReportPaymentTotals.cash)}</strong></div>
              <div class="row"><span>Total Euro</span><strong>${formatForeignCurrency(cashReportPaymentTotals.euro, "EUR")}</strong></div>
              <div class="row"><span>Total USD</span><strong>${formatForeignCurrency(cashReportPaymentTotals.usd, "USD")}</strong></div>
              <div class="row"><span>Avoir</span><strong>${formatCurrency(cashReportPaymentTotals.voucher)}</strong></div>
              <div class="row"><span>Compte Clients</span><strong>${formatCurrency(cashReportPaymentTotals.credit)}</strong></div>
              <div class="row"><span>Virement</span><strong>${formatCurrency(cashReportPaymentTotals.transfer)}</strong></div>
              <div class="row"><span>Cheque</span><strong>${formatCurrency(cashReportPaymentTotals.cheque)}</strong></div>
            </div>

            <div class="section">
              <p class="section-title">Cloture de caisse</p>
              <div class="row"><span>Ouverture MAD</span><strong>${openingMad}</strong></div>
              <div class="row"><span>Ouverture EUR</span><strong>${openingEur}</strong></div>
              <div class="row"><span>Cloture MAD</span><strong>${closingMad}</strong></div>
              <div class="row"><span>Cloture EUR</span><strong>${closingEur}</strong></div>
              <div class="row"><span>Ecart MAD</span><strong>${varianceMad}</strong></div>
              <div class="row"><span>Ecart EUR</span><strong>${varianceEur}</strong></div>
            </div>

            <div class="footer">Merci pour votre visite</div>
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

  function printPosReceipt(
    sale: PosCheckoutResult,
    lines: Array<{
      name: string;
      reference?: string;
      color?: string | null;
      size?: string | null;
      quantity: number;
      unitPriceTtc: number;
      lineTotal: number;
      discountAmount: number;
      kind?: "PRODUCT" | "ORDER_DEPOSIT";
      orderType?: string;
      orderNumber?: string;
      orderTotal?: number;
      depositAmount?: number;
    }>,
    paymentsSnapshot: PaymentEntry[],
    context: {
      customerName: string;
      sellerName: string;
      warehouseName: string;
      warehouseAddress?: string | null;
      warehousePhone?: string | null;
      registerName: string;
      companyName: string;
      companyLogoUrl?: string;
      companyAddress?: string;
      companyPhone?: string;
      companyEmail?: string;
      companyWebsite?: string;
      ticketFooter?: string;
      cgvTerms?: string;
      ticketPrintProfile?: TicketPrintProfile | null;
      subtotal: number;
      shippingFee: number;
      total: number;
      paidAmount: number;
      changeDue: number;
      ticketDiscountValue: number;
      note?: string | null;
    }
  ) {
    const popup = window.open("", "_blank", "width=420,height=820");
    if (!popup) {
      setMessage("Impression bloquee. Autorise les fenetres popup pour le ticket.");
      return;
    }

    const printProfile = context.ticketPrintProfile ?? {};
    const showBlock = (key: keyof TicketPrintProfile, fallback = true) => printProfile[key] !== false && fallback;
    const receiptFontFamily = printProfile.fontFamily || "Arial";
    const receiptBaseFontSize = Number(printProfile.baseFontSize || 11);
    const receiptTitleFontSize = Number(printProfile.titleFontSize || 16);
    const receiptItemFontSize = Number(printProfile.itemFontSize || 10);
    const receiptLogoHeight = Number(printProfile.logoHeight || 18);
    const receiptBarcodeHeight = Number(printProfile.barcodeHeight || 46);
    const receiptHeaderText = String(printProfile.headerText || "").trim();
    const receiptCgvText = String(printProfile.cgvText || context.cgvTerms || "").trim();
    const receiptFooterText = String(printProfile.footerText || context.ticketFooter || "Pied de page").trim();
    const receiptBottomText = String(printProfile.fixedBottomText || "Merci pour votre visite").trim();
    const barcodeSvg = buildCode39Svg(sale.number, receiptBarcodeHeight);
    const paymentSummary = paymentsSnapshot.length
      ? paymentsSnapshot
        .map((entry) => (isCurrencyPaymentMethod(entry.methodCode, entry.methodLabel) || normalizePaymentMethodForCheckout(entry.methodCode, entry.methodLabel) === "CASH"
          ? "ESPECE"
          : String(entry.methodLabel || entry.methodCode).trim().toUpperCase()))
        .join(" - ")
      : "AUCUN REGLEMENT";

    const cgvHtml = renderReceiptTextLines(receiptCgvText);
    const footerHtml = renderReceiptTextLines(receiptFooterText);
    const getOrderReceiptParts = (line: typeof lines[number]) => {
      const rawName = String(line.name || "").trim();
      let orderType = String(line.orderType || "").trim();
      let orderNumber = String(line.orderNumber || "").trim();
      const commandMatch = rawName.match(/Commande\s*:\s*([^-]+)\s*-\s*(.+)$/i);
      if (commandMatch) {
        orderNumber ||= commandMatch[1].trim();
        orderType ||= commandMatch[2].trim();
      }
      const depositMatch = rawName.match(/Acompte commande\s*N[Ã¯Â¿Â½Ã¯Â¿Â½Ã¯Â¿Â½]*\s*([^-]+)\s*-\s*(.+)$/i);
      if (depositMatch) {
        orderNumber ||= depositMatch[1].trim();
        orderType ||= depositMatch[2].trim();
      }
      return {
        orderType: orderType || rawName,
        orderNumber
      };
    };

    const lineRows = lines.map((line) => {
      const isOrderDeposit = line.kind === "ORDER_DEPOSIT";
      const variantLabel = [line.color, line.size].filter(Boolean).join(" - ");
      const meta = [line.reference, variantLabel].filter(Boolean).join(" | ");
      const orderParts = getOrderReceiptParts(line);
      const orderTotal = Number(line.orderTotal || 0);
      const depositAmount = Number(line.depositAmount || line.lineTotal || 0);
      const remainingAmount = Math.max(0, orderTotal - depositAmount);
      const isFullyPaidOrder = isOrderDeposit && orderTotal > 0 && remainingAmount <= 0.009;
      return `
        <tr>
          <td style="padding-right:8px;">
            ${isOrderDeposit
              ? `
                ${isFullyPaidOrder
                  ? `<div style="font-size:10px;font-weight:600;line-height:1.15;">${orderParts.orderType} Cmd NÃ¯Â¿Â½ : ${orderParts.orderNumber || "-"}</div>`
                  : `
                    <div style="font-size:10px;font-weight:600;line-height:1.15;">Acompte commande NÃ¯Â¿Â½ ${orderParts.orderNumber || "-"}</div>
                    <div style="font-size:8.5px;color:#222;margin-top:2px;line-height:1.1;">( Reste a payer : ${formatCurrency(remainingAmount)} )</div>
                  `}
              `
              : `
                 <div style="font-size:${receiptItemFontSize}px;font-weight:700;line-height:1.15;">${line.name}</div>
                ${meta ? `<div style="font-size:8.5px;color:#222;margin-top:2px;line-height:1.1;">${meta}</div>` : ""}
              `}
            ${line.discountAmount > 0 ? `<div style="font-size:9px;color:#111;margin-top:2px;line-height:1.15;">Remise ${formatCurrency(line.discountAmount)}</div>` : ""}
          </td>
          <td style="text-align:center;white-space:nowrap;font-size:${receiptItemFontSize}px;">${formatNumber(line.quantity)}</td>
          <td style="text-align:right;white-space:nowrap;font-size:${receiptItemFontSize}px;">${formatCurrency(line.lineTotal)}</td>
        </tr>
      `;
    }).join("");

    popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>${sale.number}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: ${receiptFontFamily}, Arial, Helvetica, sans-serif;
              background: #fff;
              color: #111;
              width: 72mm;
              font-size: ${receiptBaseFontSize}px;
              line-height: 1.28;
              font-weight: 500;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              text-rendering: geometricPrecision;
            }
            .ticket { width: 100%; }
            .center { text-align: center; }
            .title { font-size: ${receiptTitleFontSize}px; font-weight: 800; margin: 2px 0; }
            .muted { color: #111; font-size: 10.5px; }
            .section { margin-top: 8px; padding-top: 8px; border-top: 1.4px dashed #111; }
            table { width: 100%; border-collapse: collapse; }
            th { text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.06em; color: #111; padding-bottom: 4px; font-weight: 800; }
            td { vertical-align: top; padding: 4px 0; }
            .totals td { padding: 2px 0; }
            .strong { font-weight: 800; }
            .grand-total { font-size: 15px; font-weight: 800; }
            svg { shape-rendering: crispEdges; }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="center">
              ${showBlock("showLogo") && context.companyLogoUrl ? `<div style="margin-bottom:6px;"><img src="${context.companyLogoUrl}" alt="Logo" style="max-width:52mm;max-height:${receiptLogoHeight}mm;object-fit:contain;" /></div>` : ""}
              ${showBlock("showCompanyName") ? `<div class="title">${context.companyName}</div>` : ""}
              ${showBlock("showBoutique") ? `<div class="strong">${context.warehouseName}</div>` : ""}
              ${showBlock("showBoutique") && context.warehouseAddress ? `<div class="muted">${context.warehouseAddress}</div>` : ""}
              ${showBlock("showBoutique") && context.warehousePhone ? `<div class="muted">${context.warehousePhone}</div>` : ""}
              <div class="muted">${context.registerName}</div>
              ${showBlock("showDate") ? `<div class="muted">${new Date(sale.createdAt).toLocaleString("fr-FR")}</div>` : ""}
              ${receiptHeaderText ? `<div style="display:inline-block;margin-top:6px;padding:3px 9px;border:1px solid #111;border-radius:999px;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">${escapeReceiptHtml(receiptHeaderText)}</div>` : ""}
            </div>

            <div class="section">
              <div class="center strong" style="font-size:16px;margin-bottom:8px;">Ticket NÃ‚Â° : ${sale.number}</div>
              <div><span class="strong">Client :</span> ${context.customerName}</div>
              <div><span class="strong">Vendeur :</span> ${context.sellerName}</div>
            </div>

            <div class="section">
              <table>
                <thead>
                  <tr>
                    <th style="text-align:left;">Article</th>
                    <th style="text-align:center;">Qte</th>
                    <th style="text-align:right;">Total</th>
                  </tr>
                </thead>
                <tbody>${lineRows}</tbody>
              </table>
            </div>

            <div class="section">
              <table class="totals">
                <tbody>
                  ${context.ticketDiscountValue > 0 ? `<tr><td>Remise ticket</td><td style="text-align:right;">- ${formatCurrency(context.ticketDiscountValue)}</td></tr>` : ""}
                  ${context.shippingFee > 0 ? `<tr><td>Frais de port</td><td style="text-align:right;">${formatCurrency(context.shippingFee)}</td></tr>` : ""}
                  <tr><td class="grand-total">Total</td><td class="grand-total" style="text-align:right;">${formatCurrency(context.total)}</td></tr>
                </tbody>
              </table>
            </div>

            <div class="section">
              <div class="strong" style="margin-bottom:4px;">Paiements</div>
              <div style="font-size:9px;letter-spacing:0.03em;text-transform:uppercase;line-height:1.2;">${paymentSummary}</div>
            </div>

            <div class="section center">
              ${showBlock("showCgv") ? `<div style="text-align:left;font-size:9px;margin-bottom:8px;">${cgvHtml || renderReceiptTextLines("Aucune condition generale de vente configuree.")}</div>` : ""}
              ${(showBlock("showCgv") || showBlock("showFooter")) ? `<div style="border-top:1.4px dashed #111;margin:8px 0 6px;"></div>` : ""}
              ${showBlock("showFooter") ? `<div style="margin-bottom:8px;">${footerHtml}</div>` : ""}
              ${showBlock("showBarcode") ? `<div style="margin-bottom:4px;">${barcodeSvg}</div>` : ""}
            </div>

            <div class="section center">
              ${receiptBottomText ? `<div class="muted" style="margin-bottom:4px;">${escapeReceiptHtml(receiptBottomText)}</div>` : ""}
              ${context.companyAddress ? `<div class="muted">${context.companyAddress}</div>` : ""}
              ${context.companyPhone ? `<div class="muted">${context.companyPhone}</div>` : ""}
              ${context.companyEmail ? `<div class="muted">${context.companyEmail}</div>` : ""}
              ${context.companyWebsite ? `<div class="muted">${context.companyWebsite}</div>` : ""}
            </div>
          </div>
          <script>
            window.onload = function () {
              document.body.innerHTML = document.body.innerHTML
                .replace(/N[^0-9A-Za-z<]{1,18} :/g, "N&deg; :")
                .replace(/N[^0-9A-Za-z<]{1,18} ([0-9])/g, "N&deg; $1");
              var receiptTitle = document.querySelector(".ticket > .section .center.strong");
              if (receiptTitle) receiptTitle.innerHTML = "Ticket N&deg; : ${sale.number}";
              window.print();
              setTimeout(function () { window.close(); }, 250);
            };
          </script>
        </body>
      </html>
    `);
    popup.document.close();
  }

  function appendPaymentKey(value: string) {
    setPaymentDraft((current) => {
      if (paymentDraftPrimed) {
        setPaymentDraftPrimed(false);
        return value === "." ? "0." : value;
      }
      if (value === ".") return current.includes(".") ? current : `${current}.`;
      if (current === "0") return value;
      return `${current}${value}`;
    });
  }

  function deletePaymentKey() {
    setPaymentDraftPrimed(false);
    setPaymentDraft((current) => current.slice(0, -1) || "0");
  }

  function clearPaymentDraft() {
    setPaymentDraftPrimed(false);
    setPaymentDraft("0");
  }

  function removePaymentEntry(id: string) {
    const nextEntries = paymentEntries.filter((entry) => entry.id !== id);
    setPaymentEntries(nextEntries);
    resetPaymentDraft(grandTotal - nextEntries.reduce((sum, entry) => sum + entry.amountMad, 0));
  }

  function addLocalPayment(methodCode: string) {
    const amount = Number(paymentDraft || 0);
    const method = activePaymentMethods.find((item) => item.code === methodCode);
    if (isCreditPaymentMethod(methodCode, method?.label) && !selectedCustomer) {
      setMessage("Client obligatoire pour un paiement en credit.");
      return;
    }
    if (amount <= 0) {
      setMessage("Montant de paiement obligatoire.");
      return;
    }
    const dueBefore = Math.max(0, grandTotal - paymentEntries.reduce((sum, entry) => sum + entry.amountMad, 0));
    const changeMad = normalizePaymentMethodForCheckout(methodCode, method?.label) === "CASH"
      ? Number(Math.max(0, amount - dueBefore).toFixed(2))
      : 0;
    const entry: PaymentEntry = {
      id: `PAY-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      methodCode,
      methodLabel: method?.label || methodCode,
      amountMad: Number(amount.toFixed(2)),
      changeMad
    };
    const nextEntries = [...paymentEntries, entry];
    setPaymentEntries(nextEntries);
    resetPaymentDraft(grandTotal - nextEntries.reduce((sum, item) => sum + item.amountMad, 0));
  }

  function openVoucherModal() {
    setVoucherNumberDraft("");
    setVoucherLookup(null);
    setVoucherLookupLoading(false);
    setVoucherModalOpen(true);
  }

  async function lookupVoucher() {
    const number = voucherNumberDraft.trim();
    if (!number) {
      setMessage("Numero de bon achat obligatoire.");
      return;
    }
    setVoucherLookupLoading(true);
    try {
      const voucher = await api<VoucherLookup>(`/pos/vouchers/${encodeURIComponent(number)}?warehouseId=${encodeURIComponent(form.warehouseId || "")}`);
      setVoucherLookup(voucher);
      setMessage(voucher.usableInCurrentWarehouse === false ? "Bon detecte, mais non utilisable dans cette boutique." : null);
    } catch (error) {
      setVoucherLookup(null);
      setMessage(error instanceof Error ? error.message : "Bon achat introuvable.");
    } finally {
      setVoucherLookupLoading(false);
    }
  }

  function applyVoucherPayment() {
    if (!voucherLookup) {
      setMessage("Verifie d'abord le bon achat.");
      return;
    }
    if (voucherLookup.usableInCurrentWarehouse === false) {
      setMessage("Ce bon d'avoir appartient a une autre boutique.");
      return;
    }
    if (voucherAmountToUse <= 0) {
      setMessage("Montant bon achat invalide.");
      return;
    }
    const method = activePaymentMethods.find((item) => isVoucherPaymentMethod(item.code, item.label));
    const entry: PaymentEntry = {
      id: `PAY-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      methodCode: method?.code || "VOUCHER",
      methodLabel: method?.label || "Bon achat",
      amountMad: voucherAmountToUse,
      reference: voucherLookup.number,
      voucherBalanceBefore: Number(voucherLookup.balanceAmount),
      voucherBalanceAfter,
      detail: `Bon ${voucherLookup.number} - Solde ${formatCurrency(voucherBalanceAfter)}`
    };
    const nextEntries = [...paymentEntries, entry];
    setPaymentEntries(nextEntries);
    setVoucherModalOpen(false);
    setVoucherLookup(null);
    setVoucherNumberDraft("");
    resetPaymentDraft(grandTotal - nextEntries.reduce((sum, item) => sum + item.amountMad, 0));
    setMessage(null);
  }

  function openPaymentReferenceModal(methodCode: string, label?: string | null) {
    const methodLabel = label || methodCode;
    const isCheque = isChequePaymentMethod(methodCode, label);
    setPaymentReferenceMethod({
      code: methodCode,
      label: methodLabel,
      fieldLabel: isCheque ? "Numero de cheque" : "Reference virement",
      title: isCheque ? "Cheque" : "Virement"
    });
    setPaymentReferenceDraft("");
    setPaymentReferenceModalOpen(true);
  }

  function applyPaymentReference() {
    const amount = Number(paymentDraft || 0);
    const reference = paymentReferenceDraft.trim();
    if (!paymentReferenceMethod) {
      setMessage("Mode de paiement introuvable.");
      return;
    }
    if (amount <= 0) {
      setMessage("Montant de paiement obligatoire.");
      return;
    }
    if (!reference) {
      setMessage(`${paymentReferenceMethod.fieldLabel} obligatoire.`);
      return;
    }
    const entry: PaymentEntry = {
      id: `PAY-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      methodCode: paymentReferenceMethod.code,
      methodLabel: paymentReferenceMethod.label,
      amountMad: Number(amount.toFixed(2)),
      reference,
      detail: `${paymentReferenceMethod.fieldLabel}: ${reference}`
    };
    const nextEntries = [...paymentEntries, entry];
    setPaymentEntries(nextEntries);
    setPaymentReferenceModalOpen(false);
    setPaymentReferenceDraft("");
    setPaymentReferenceMethod(null);
    resetPaymentDraft(grandTotal - nextEntries.reduce((sum, item) => sum + item.amountMad, 0));
    setMessage(null);
  }

  async function loadCustomerCredits(options: { keepSelection?: boolean } = {}) {
    setCustomerCreditsLoading(true);
    try {
      const params = new URLSearchParams();
      if (customerCreditFilters.query.trim()) params.set("query", customerCreditFilters.query.trim());
      if (customerCreditFilters.status) params.set("status", customerCreditFilters.status);
      if (customerCreditFilters.dateFrom) params.set("dateFrom", customerCreditFilters.dateFrom);
      if (customerCreditFilters.dateTo) params.set("dateTo", customerCreditFilters.dateTo);
      if (form.warehouseId) params.set("warehouseId", form.warehouseId);
      const payload = await api<CustomerCreditsPayload>(`/pos/customer-credits?${params.toString()}`);
      setCustomerCreditsData(payload);
      if (!options.keepSelection || !payload.rows.some((row) => row.id === selectedCustomerCreditId)) {
        const first = payload.rows[0] ?? null;
        setSelectedCustomerCreditId(first?.id ?? "");
        setCustomerCreditRepaymentForm((current) => ({
          ...current,
          repaymentId: "",
          amount: first ? String(first.balanceAmount) : "",
          method: customerCreditPaymentMethods[0]?.code || "CASH",
          reference: "",
          note: ""
        }));
      }
      setMessage(null);
    } catch (error) {
      setCustomerCreditsData(null);
      setMessage(error instanceof Error ? error.message : "Chargement des credits clients impossible.");
    } finally {
      setCustomerCreditsLoading(false);
    }
  }

  function openCustomerCreditsModal() {
    setCustomerCreditFilters((current) => ({
      ...current,
      status: current.status || "open",
      dateFrom: current.dateFrom,
      dateTo: current.dateTo
    }));
    setCustomerCreditsModalOpen(true);
    void loadCustomerCredits();
  }

  async function saveCustomerCreditRepayment() {
    if (!selectedCustomerCredit) {
      setMessage("Selectionne d'abord un credit client.");
      return;
    }
    const amount = Number(customerCreditRepaymentForm.amount || 0);
    if (amount <= 0) {
      setMessage("Montant de remboursement obligatoire.");
      return;
    }
    if (amount > selectedCustomerCredit.balanceAmount && !customerCreditRepaymentForm.repaymentId) {
      setMessage("Le remboursement ne peut pas depasser le solde du credit.");
      return;
    }
    setCustomerCreditSaving(true);
    try {
      const selectedMethod = activePaymentMethods.find((method) => method.code === customerCreditRepaymentForm.method);
      const body = JSON.stringify({
        amount,
        method: normalizePaymentMethodForCheckout(customerCreditRepaymentForm.method, selectedMethod?.label),
        reference: customerCreditRepaymentForm.reference || null,
        note: customerCreditRepaymentForm.note || null
      });
      if (customerCreditRepaymentForm.repaymentId) {
        await api<CustomerCreditRepayment>(`/pos/customer-credits/repayments/${encodeURIComponent(customerCreditRepaymentForm.repaymentId)}`, { method: "PUT", body });
      } else {
        await api<CustomerCreditRepayment>(`/pos/customer-credits/${encodeURIComponent(selectedCustomerCredit.saleId)}/repayments`, { method: "POST", body });
      }
      setCustomerCreditRepaymentForm({
        repaymentId: "",
        amount: "",
        method: customerCreditPaymentMethods[0]?.code || "CASH",
        reference: "",
        note: ""
      });
      await loadCustomerCredits({ keepSelection: true });
      if (cashReportModalOpen) void loadCashReport();
      setMessage("Remboursement credit enregistre.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Remboursement credit impossible.");
    } finally {
      setCustomerCreditSaving(false);
    }
  }

  function editCustomerCreditRepayment(repayment: CustomerCreditRepayment) {
    setCustomerCreditRepaymentForm({
      repaymentId: repayment.id,
      amount: String(repayment.amount),
      method: repayment.method,
      reference: repayment.reference ?? "",
      note: repayment.note ?? ""
    });
  }

  async function deleteCustomerCreditRepayment(repayment: CustomerCreditRepayment) {
    if (!window.confirm("Annuler ce remboursement credit ?")) return;
    setCustomerCreditSaving(true);
    try {
      await api(`/pos/customer-credits/repayments/${encodeURIComponent(repayment.id)}`, { method: "DELETE" });
      await loadCustomerCredits({ keepSelection: true });
      if (cashReportModalOpen) void loadCashReport();
      setMessage("Remboursement credit annule.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Annulation du remboursement impossible.");
    } finally {
      setCustomerCreditSaving(false);
    }
  }

  function printCustomerCreditsList() {
    const rows = customerCreditRows;
    const popup = window.open("", "_blank", "width=980,height=900");
    if (!popup) {
      setMessage("Impossible d'ouvrir l'impression des credits clients.");
      return;
    }
    const title = customerCreditFilters.query.trim()
      ? `Credits clients - ${customerCreditFilters.query.trim()}`
      : "Credits clients";
    const period = customerCreditFilters.dateFrom || customerCreditFilters.dateTo
      ? `${customerCreditFilters.dateFrom || "..."} au ${customerCreditFilters.dateTo || "..."}`
      : "Toute la periode";
    popup.document.open();
    popup.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #1f1712; padding: 24px; }
            h1 { margin: 0; font-size: 24px; }
            .meta { margin: 6px 0 18px; color: #756457; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #2b1d14; color: #fff; text-align: left; padding: 9px; }
            td { border-bottom: 1px solid #e6d6c8; padding: 9px; vertical-align: top; }
            .right { text-align: right; }
            .summary { display: flex; gap: 10px; margin: 18px 0; }
            .card { flex: 1; border: 1px solid #e6d6c8; border-radius: 14px; padding: 12px; }
            .card span { display: block; color: #756457; font-size: 10px; text-transform: uppercase; letter-spacing: .16em; }
            .card strong { font-size: 17px; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="meta">Periode: ${period} - Impression: ${new Date().toLocaleString("fr-FR")}</div>
          <div class="summary">
            <div class="card"><span>Total credits</span><strong>${formatCurrency(customerCreditsData?.summary.creditAmount ?? 0)}</strong></div>
            <div class="card"><span>Rembourse</span><strong>${formatCurrency(customerCreditsData?.summary.repaidAmount ?? 0)}</strong></div>
            <div class="card"><span>Solde</span><strong>${formatCurrency(customerCreditsData?.summary.balanceAmount ?? 0)}</strong></div>
          </div>
          <table>
            <thead><tr><th>Ticket</th><th>Date</th><th>Client</th><th>Boutique</th><th>Statut</th><th class="right">Credit</th><th class="right">Rembourse</th><th class="right">Solde</th></tr></thead>
            <tbody>
              ${rows.map((row) => `<tr>
                <td><strong>${row.saleNumber}</strong></td>
                <td>${formatDate(row.createdAt)}</td>
                <td>${row.customer.fullName}<br>${row.customer.phone ?? ""}</td>
                <td>${row.warehouse.name}</td>
                <td>${row.status === "paid" ? "Solde" : row.status === "partial" ? "Partiel" : "Ouvert"}</td>
                <td class="right">${formatCurrency(row.creditAmount)}</td>
                <td class="right">${formatCurrency(row.repaidAmount)}</td>
                <td class="right">${formatCurrency(row.balanceAmount)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
          <script>window.onload=function(){window.print();setTimeout(function(){window.close();},250);};</script>
        </body>
      </html>
    `);
    popup.document.close();
  }
  function openCurrencyPaymentModal() {
    setCurrencyTenderDraft(String(Number((currencyDueAmount > 0 ? currencyDueAmount : grandTotal).toFixed(2))));
    setCurrencyTenderPrimed(true);
    setCurrencyPaymentModalOpen(true);
  }
  function handlePaymentMethodCard(methodCode: string) {
    const method = activePaymentMethods.find((item) => item.code === methodCode);
    setSelectedPaymentMethodCode(methodCode);
    if (isCurrencyPaymentMethod(methodCode, method?.label)) {
      openCurrencyPaymentModal();
      return;
    }
    if (isVoucherPaymentMethod(methodCode, method?.label)) {
      openVoucherModal();
      return;
    }
    if (isTransferPaymentMethod(methodCode, method?.label) || isChequePaymentMethod(methodCode, method?.label)) {
      openPaymentReferenceModal(methodCode, method?.label);
      return;
    }
    addLocalPayment(methodCode);
  }

  function appendCurrencyPaymentKey(value: string) {
    setCurrencyTenderDraft((current) => {
      if (currencyTenderPrimed) {
        setCurrencyTenderPrimed(false);
        return value === "." ? "0." : value;
      }
      if (value === ".") return current.includes(".") ? current : `${current}.`;
      if (current === "0") return value;
      return `${current}${value}`;
    });
  }

  function deleteCurrencyPaymentKey() {
    setCurrencyTenderPrimed(false);
    setCurrencyTenderDraft((current) => current.slice(0, -1) || "0");
  }

  function clearCurrencyPaymentDraft() {
    setCurrencyTenderPrimed(false);
    setCurrencyTenderDraft("0");
  }

  function applyCurrencyPayment(changeMode: "MAD" | "CURRENCY" | null = null) {
    if (!paymentCurrency) {
      setMessage("Aucune devise disponible.");
      return;
    }
    const tendered = Number(currencyTenderDraft || 0);
    if (tendered <= 0) {
      setMessage("Montant devise obligatoire.");
      return;
    }
    const method = activePaymentMethods.find((item) => isCurrencyPaymentMethod(item.code, item.label));
    const entry: PaymentEntry = {
      id: `PAY-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      methodCode: method?.code || "FOREIGN_CURRENCY",
      methodLabel: method?.label || "Devise",
      amountMad: Number(currencyTenderMad.toFixed(2)),
      tenderedAmount: Number(tendered.toFixed(2)),
      currencyCode: paymentCurrency.code,
      currencySymbol: paymentCurrency.symbol,
      changeMad: Number(currencyChangeMad.toFixed(2)),
      changeCurrency: Number(currencyChangeAmount.toFixed(2)),
      changeMode,
      detail: `${Number(tendered.toFixed(2)).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${paymentCurrency.symbol || paymentCurrency.code}`
    };
    const nextEntries = [...paymentEntries, entry];
    setPaymentEntries(nextEntries);
    setCurrencyPaymentModalOpen(false);
    resetPaymentDraft(grandTotal - nextEntries.reduce((sum, item) => sum + item.amountMad, 0));
  }

  function formatPaymentEntryDetails(entry: PaymentEntry) {
    if (entry.currencyCode) {
      const currencyLabel = entry.currencySymbol || entry.currencyCode;
      const parts = [entry.detail || `${entry.tenderedAmount?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyLabel}`];
      if ((entry.changeMad ?? 0) > 0) {
        parts.push(`Rendu ${entry.changeMode === "CURRENCY" ? `${Number(entry.changeCurrency ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyLabel}` : formatCurrency(entry.changeMad ?? 0)}`);
      }
      return parts.join(" - ");
    }
    if (entry.reference && isVoucherPaymentMethod(entry.methodCode, entry.methodLabel)) {
      return entry.detail || `Bon ${entry.reference}`;
    }
    if (entry.reference) {
      return entry.detail || entry.reference;
    }
    return "";
  }

  function buildCheckoutNote() {
    const paymentNotes = paymentEntries
      .map((entry) => {
        const detail = formatPaymentEntryDetails(entry);
        return detail ? `${entry.methodLabel}: ${detail}` : "";
      })
      .filter(Boolean);
    return [form.note?.trim() || "", ...paymentNotes].filter(Boolean).join("\n") || null;
  }

  function holdCurrentTicket() {
    if (!cart.length) return;
    const ticket: HeldTicket = {
      id: `WAIT-${Date.now()}`,
      lines: cart,
      customerId: form.customerId,
      customerName,
      warehouseId: form.warehouseId,
      registerId: form.registerId,
      transporterId: form.transporterId,
      sellerName: form.sellerName,
      paymentMethod: form.paymentMethod,
      shippingFee: form.shippingFee,
      note: form.note,
      total: grandTotal,
      createdAt: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    };
    setHeldTickets((current) => [ticket, ...current]);
    setCart([]);
    setForm((current) => ({ ...current, customerId: "", transporterId: "", sellerName: "", note: "", paymentAmount: "0", shippingFee: "0" }));
    setMessage("Ticket mis en attente.");
    setTicketTab("hold");
  }

  function restoreHeldTicket(ticket: HeldTicket) {
    setCart(ticket.lines);
    setForm((current) => ({
      ...current,
      customerId: ticket.customerId,
      warehouseId: ticket.warehouseId || current.warehouseId,
      registerId: ticket.registerId || current.registerId,
      transporterId: ticket.transporterId,
      sellerName: ticket.sellerName,
      paymentMethod: ticket.paymentMethod,
      shippingFee: ticket.shippingFee,
      note: ticket.note,
      paymentAmount: "0"
    }));
    setHeldTickets((current) => current.filter((item) => item.id !== ticket.id));
    setTicketTab("payment");
    setMessage("Ticket repris.");
  }

  function cancelCurrentTicket() {
    setCart([]);
    setPaymentEntries([]);
    setPaymentDraft("0");
    setSelectedPaymentMethodCode("CASH");
    setCheckoutModalOpen(false);
    setCurrencyPaymentModalOpen(false);
    setCurrencyTenderDraft("0");
    setCurrencyTenderPrimed(false);
    setVoucherModalOpen(false);
    setVoucherNumberDraft("");
    setVoucherLookup(null);
    setVoucherLookupLoading(false);
    setPaymentReferenceModalOpen(false);
    setPaymentReferenceDraft("");
    setPaymentReferenceMethod(null);
    setOrderModalOpen(false);
    setOrderForm({ type: "Sac", number: "", totalAmount: "0", depositAmount: "0" });
    setDeliveryOrderModalOpen(false);
    setDeliveryOrderNumber("");
    setDeliveryOrderResult(null);
    setDeliveryOrderLoading(false);
    setQuantityModalOpen(false);
    setActiveQuantityLineId("");
    setQuantityDraft("1");
    setTicketLineActionModalOpen(false);
    setTicketLineActionLineId("");
    setManagerApprovalModalOpen(false);
    setManagerApprovalLineId("");
    setManagerApprovalAction(null);
    setManagerApprovalCode("");
    setManagerApprovalLoading(false);
    setLineDiscountModalOpen(false);
    setActiveDiscountLineId("");
    setLineDiscountDraft("0");
    setLineDiscountMode("amount");
    setTicketDiscountModalOpen(false);
    setTicketDiscountDraft("0");
    setTicketDiscountMode("percent");
    setShippingModalOpen(false);
    setShippingFeeDraft("0");
    setForm((current) => ({
      ...current,
      customerId: "",
      transporterId: "",
      sellerName: "",
      note: "",
      paymentMethod: "CASH",
      paymentAmount: "0",
      shippingFee: "0"
    }));
    setTicketTab("payment");
    setMessage("Ticket annule.");
  }

  function clearCheckoutTicket(message: string) {
    setCart([]);
    setPaymentEntries([]);
    setPaymentDraft("0");
    setCheckoutModalOpen(false);
    setCurrencyPaymentModalOpen(false);
    setCurrencyTenderDraft("0");
    setCurrencyTenderPrimed(false);
    setTicketDiscountDraft("0");
    setTicketDiscountMode("percent");
    setForm((current) => ({
      ...current,
      customerId: "",
      transporterId: "",
      sellerName: "",
      note: "",
      paymentMethod: "CASH",
      paymentAmount: "0",
      shippingFee: "0"
    }));
    setMessage(message);
  }

  async function checkout() {
    if (!cart.length) return;
    if (!form.registerId) {
      setMessage("Choisis d'abord une caisse.");
      return;
    }
    if (!paymentEntries.length) {
      setMessage("Ajoute au moins un reglement avant d'encaisser.");
      return;
    }
    if (paymentEntries.some((entry) => isCreditPaymentMethod(entry.methodCode, entry.methodLabel)) && !selectedCustomer) {
      setMessage("Client obligatoire pour un paiement en credit.");
      return;
    }
    setSaving(true);
    setMessage(null);
    let offlineDraft: {
      checkoutPayload: unknown;
      printableLines: Array<{
        name: string;
        reference?: string;
        color?: string | null;
        size?: string | null;
        quantity: number;
        unitPriceTtc: number;
        lineTotal: number;
        discountAmount: number;
        kind?: "PRODUCT" | "ORDER_DEPOSIT";
        orderType?: string;
        orderNumber?: string;
        orderTotal?: number;
        depositAmount?: number;
      }>;
      paymentSnapshot: PaymentEntry[];
      receiptContext: Parameters<typeof printPosReceipt>[3];
      checkoutSellerName: string;
      checkoutCustomerName: string;
    } | null = null;
    try {
      const checkoutSellerName = form.sellerName.trim() || "Non renseigne";
      const checkoutCustomerName = customerName;
      const checkoutWarehouseName = selectedWarehouse?.name || user?.defaultWarehouse?.name || "Boutique caisse";
      const checkoutWarehouseAddress = selectedWarehouse?.address || "";
      const checkoutWarehousePhone = selectedWarehouse?.phone || "";
      const checkoutRegisterName = selectedRegister?.name || "Caisse";
      const productNetTotal = cart.reduce((sum, line) => {
        const subtotal = line.quantity * line.price;
        const lineDiscount = Math.min(subtotal, line.discountAmount);
        return sum + Math.max(0, subtotal - lineDiscount);
      }, 0);
      let remainingTicketDiscount = ticketDiscountValue;
      const items = cart.map((line, index) => {
        const subtotal = line.quantity * line.price;
        const lineDiscount = Math.min(subtotal, line.discountAmount);
        const lineNet = Math.max(0, subtotal - lineDiscount);
        const extraDiscount = index === cart.length - 1
          ? remainingTicketDiscount
          : productNetTotal > 0
            ? Number(((ticketDiscountValue * lineNet) / productNetTotal).toFixed(2))
            : 0;
        remainingTicketDiscount = Math.max(0, remainingTicketDiscount - extraDiscount);
        return {
          productId: line.productId,
          quantity: line.quantity,
          discountAmount: Number((lineDiscount + extraDiscount).toFixed(2)),
          kind: line.kind ?? "PRODUCT",
          orderSource: line.orderSource,
          name: line.name,
          unitPriceTtc: line.price,
          orderType: line.orderType,
          orderNumber: line.orderNumber,
          orderTotal: line.orderTotal,
          depositAmount: line.depositAmount
        };
      });

      const printableLines = items.map((item, index) => ({
        name: cart[index]?.name || "Article",
        reference: cart[index]?.reference,
        color: cart[index]?.color,
        size: cart[index]?.size,
        quantity: item.quantity,
        unitPriceTtc: item.unitPriceTtc,
        lineTotal: Number((item.unitPriceTtc * item.quantity - item.discountAmount).toFixed(2)),
        discountAmount: item.discountAmount,
        kind: cart[index]?.kind ?? item.kind,
        orderType: cart[index]?.orderType ?? item.orderType,
        orderNumber: cart[index]?.orderNumber ?? item.orderNumber,
        orderTotal: cart[index]?.orderTotal ?? item.orderTotal,
        depositAmount: cart[index]?.depositAmount ?? item.depositAmount
      }));
      const paymentSnapshot = paymentEntries.map((entry) => ({ ...entry }));
      const noteSnapshot = buildCheckoutNote();
      const checkoutPayload = {
        warehouseId: form.warehouseId,
        registerId: form.registerId,
        customerId: form.customerId || null,
        transporterId: form.transporterId || null,
        sellerName: checkoutSellerName,
        note: noteSnapshot,
        shippingFee: Number(form.shippingFee || 0),
        items,
        payments: paymentEntries.map((entry) => ({
          amount: Number(entry.amountMad.toFixed(2)),
          method: normalizePaymentMethodForCheckout(entry.methodCode, entry.methodLabel),
          reference: entry.reference || null,
          tenderedAmount: entry.tenderedAmount ?? null,
          currencyCode: entry.currencyCode ?? null,
          changeMad: entry.changeMad ?? 0,
          changeCurrency: entry.changeCurrency ?? 0,
          changeMode: entry.changeMode ?? null,
          detail: entry.detail ?? null
        }))
      };
      const receiptContext = {
        customerName: checkoutCustomerName,
        sellerName: checkoutSellerName,
        warehouseName: checkoutWarehouseName,
        warehouseAddress: checkoutWarehouseAddress,
        warehousePhone: checkoutWarehousePhone,
        registerName: checkoutRegisterName,
        companyName: company?.name || "Galerie des Tanneurs",
        companyLogoUrl: company?.logoUrl || "",
        companyAddress: company?.address || "",
        companyPhone: company?.phone || "",
        companyEmail: company?.email || "",
        companyWebsite: company?.website || "",
        ticketFooter: company?.ticketFooter || "",
        cgvTerms: company?.cgvTerms || "",
        ticketPrintProfile: company?.ticketPrintProfiles?.cash ?? null,
        subtotal: cartSubtotal,
        shippingFee: shippingFeeValue,
        total: grandTotal,
        paidAmount,
        changeDue,
        ticketDiscountValue,
        note: noteSnapshot
      };
      offlineDraft = { checkoutPayload, printableLines, paymentSnapshot, receiptContext, checkoutSellerName, checkoutCustomerName };
      const sale = await api<PosCheckoutResult>("/pos/checkout", {
        method: "POST",
        body: JSON.stringify(checkoutPayload)
      });
      printPosReceipt(sale, printableLines, paymentSnapshot, receiptContext);
      clearCheckoutTicket("Ticket genere avec succes.");
      await load(search);
    } catch (err) {
      if (offlineDraft && (!navigator.onLine || isNetworkError(err))) {
        const queued = queueOfflineCheckout(offlineDraft.checkoutPayload, {
          total: grandTotal,
          sellerName: offlineDraft.checkoutSellerName,
          customerName: offlineDraft.checkoutCustomerName
        });
        printPosReceipt({
          id: queued.id,
          number: queued.receipt.temporaryNumber,
          createdAt: queued.createdAt,
          sellerName: queued.receipt.sellerName,
          totalAmount: grandTotal,
          paidAmount,
          shippingFee: shippingFeeValue,
          note: "Ticket hors ligne en attente de synchronisation.",
          payments: offlineDraft.paymentSnapshot.map((entry) => ({
            id: entry.id,
            amount: entry.amountMad,
            method: normalizePaymentMethodForCheckout(entry.methodCode, entry.methodLabel),
            reference: entry.reference
          }))
        }, offlineDraft.printableLines, offlineDraft.paymentSnapshot, {
          ...offlineDraft.receiptContext,
          note: "Ticket hors ligne en attente de synchronisation."
        });
        clearCheckoutTicket(`Mode hors ligne: ticket ${queued.receipt.temporaryNumber} enregistre localement. Synchronisation automatique au retour d'internet.`);
        return;
      }
      setMessage(err instanceof Error ? err.message : "Encaissement impossible.");
    } finally {
      setSaving(false);
    }
  }
  if (loading) return <LoadingBlock label="Chargement de la caisse..." />;

  const canCancelTicket = Boolean(
    cart.length ||
      paymentEntries.length ||
      form.customerId ||
      form.sellerName ||
      form.note ||
      Number(form.shippingFee || 0) > 0
  );
  const ticketLineActionLine = cart.find((line) => line.lineId === ticketLineActionLineId) ?? null;
  const managerApprovalLine = cart.find((line) => line.lineId === managerApprovalLineId) ?? null;

  const ticketDetail = (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-sm font-medium text-[#ecdccd]">
        <span className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-orange-200" /> Detail ticket</span>
        <div className="flex items-center gap-2">
          <Button
            className="h-8 !rounded-full !px-3 !py-0 text-[11px]"
            type="button"
            variant="secondary"
            onClick={cancelCurrentTicket}
            disabled={!canCancelTicket}
          >
            <span className="inline-flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              Annuler
            </span>
          </Button>
          <span className="hidden text-xs text-[#b8aa9c] sm:inline">{formatNumber(cart.length)} article(s)</span>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-[#d6c8ba] sm:hidden"
            onClick={() => setMobileTicketDetailOpen((current) => !current)}
          >
            <span>{formatCurrency(grandTotal)}</span>
            {mobileTicketDetailOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className={`${mobileTicketDetailOpen ? "block" : "hidden"} sm:block`}>
      <div className="max-h-[36vh] space-y-3 overflow-y-auto pr-1 sm:max-h-[300px] lg:max-h-[42vh]">
        {cart.map((line) => (
          <div
            key={line.lineId}
            className={`flex flex-col gap-3 rounded-[18px] border border-white/10 bg-white/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${line.kind !== "ORDER_DEPOSIT" ? "cursor-pointer transition hover:border-orange-300/30 hover:bg-white/7" : ""}`}
            onDoubleClick={() => openTicketLineActionModal(line)}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="cart-item-thumb flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[15px] border border-white/10 bg-black/20 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b9aa9b]">
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt={line.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span>{line.kind === "ORDER_DEPOSIT" ? "CMD" : "GDT"}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-white">{line.name}</div><div className="mt-1 text-[11px] text-[#baa999]">{[line.reference, line.barcode, line.color, line.size].filter(Boolean).join(" - ")}</div>
                <div className="mt-1 text-xs text-[#baa999]">
                  {line.quantity} x {formatCurrency(line.price)}
                  {line.price <= 0 ? <span className="ml-2 text-emerald-200">Offert</span> : null}
                  {line.discountAmount > 0 ? <span className="ml-2 text-orange-100">Remise {formatCurrency(line.discountAmount)}</span> : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:justify-end">
              <button
                type="button"
                className="min-w-[64px] rounded-[14px] border border-amber-300/55 bg-amber-300/16 px-4 py-2 text-base font-bold text-white shadow-[0_0_0_1px_rgba(251,191,36,0.14),0_10px_24px_rgba(251,146,60,0.12)] transition hover:border-amber-200 hover:bg-amber-300/24"
                onClick={() => openQuantityModal(line)}
              >
                {line.quantity}
              </button>
              <button type="button" className="rounded-full border border-rose-300/35 bg-rose-500/14 p-2 text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.10)] transition hover:border-rose-200 hover:bg-rose-500/24 hover:text-white" onClick={() => setCart((current) => current.filter((item) => item.lineId !== line.lineId))}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        {!cart.length ? <EmptyState title="Panier vide" description="" compact /> : null}
      </div>
      </div>
      <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:max-w-[520px]">
          <Button className="h-[44px] w-full !rounded-[16px] !justify-center !px-2.5 !py-0 text-center text-[11px] font-semibold leading-tight" type="button" variant="secondary" onClick={openShippingModal}>Frais de port</Button>
          <Button className="h-[44px] w-full !rounded-[16px] !justify-center !px-2.5 !py-0 text-center text-[11px] font-semibold leading-tight" type="button" variant="secondary" onClick={requestTicketDiscountApproval}>Remise ticket</Button>
          <Button className="h-[44px] w-full !rounded-[16px] !justify-center !px-2.5 !py-0 text-center text-[11px] font-semibold leading-tight" type="button" onClick={() => setOrderModalOpen(true)}>Ajouter une commande</Button>
          <Button className="h-[44px] w-full !rounded-[16px] !justify-center !px-2.5 !py-0 text-center text-[11px] font-semibold leading-tight" type="button" variant="secondary" onClick={openCreditNoteModal}>Bon d'avoir</Button>
          <Button className="h-[44px] w-full !rounded-[16px] !justify-center !px-2.5 !py-0 text-center text-[11px] font-semibold leading-tight sm:col-span-2" type="button" variant="secondary" onClick={openDeliveryOrderModal}>Livraison Commande</Button>
        </div>
        <div className="w-full space-y-1.5 rounded-[16px] border border-white/10 bg-black/25 p-2.5 text-xs text-[#eadfd4] xl:ml-auto xl:max-w-[300px]">
          <div className="flex items-center justify-between gap-4"><span>Sous-total articles</span><span className="font-semibold text-white">{formatCurrency(cartBaseSubtotal)}</span></div>
          {lineDiscountTotal > 0 ? <div className="flex items-center justify-between gap-4"><span>Remise articles</span><span className="font-semibold text-orange-100">- {formatCurrency(lineDiscountTotal)}</span></div> : null}
          {ticketDiscountValue > 0 ? <div className="flex items-center justify-between gap-4"><span>Remise ticket</span><span className="font-semibold text-orange-100">- {ticketDiscountMode === "percent" ? `${ticketDiscountDraft}%` : formatCurrency(ticketDiscountValue)}</span></div> : null}
          <div className="flex items-center justify-between gap-4"><span>Frais de port</span><span className="font-semibold text-white">{formatCurrency(shippingFeeValue)}</span></div>
          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2 text-white"><span className="text-sm font-semibold uppercase tracking-[0.16em] text-orange-100">Total ticket</span><span className="text-2xl font-bold leading-none">{formatCurrency(grandTotal)}</span></div>
        </div>
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      {message ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(92vw,420px)] justify-end">
          <div
            className={`pos-floating-message pos-floating-message-${messageTone} pointer-events-auto flex w-full items-start gap-3 rounded-[22px] border px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.35)] backdrop-blur-md ${
              messageTone === "success"
                ? "border-emerald-300/25 bg-emerald-500/12 text-emerald-50"
                : messageTone === "error"
                  ? "border-rose-300/25 bg-[#2b1b17]/96 text-[#f8ded7]"
                  : "border-sky-300/25 bg-sky-500/12 text-sky-50"
            }`}
          >
            <div className="pos-floating-message-icon mt-0.5 shrink-0">
              {messageTone === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : messageTone === "error" ? (
                <AlertCircle className="h-5 w-5" />
              ) : (
                <Info className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {messageTone === "error" ? (
                <p className="pos-floating-message-kicker mb-1 text-[10px] font-semibold uppercase tracking-[0.2em]">Alerte caisse</p>
              ) : null}
              <p className="pos-floating-message-text text-sm font-medium leading-5">{message}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-full border border-white/10 p-1.5 text-current/80 transition hover:border-white/20 hover:text-current"
              onClick={() => setMessage(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] 2xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,460px)]">
        <section className="card-shell min-w-0 space-y-4 p-4 md:p-5 lg:p-4 xl:p-5">
          <div className="rounded-[22px] border border-orange-300/15 bg-black/20 p-3">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-orange-200/80">Scanner</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input className="h-12 w-full flex-1 text-base" placeholder="Scanner ou rechercher..." value={search} onChange={(event) => void handleScannerChange(event)} onKeyDown={handleScannerKeyDown} />
              <Button className="w-full !px-4 !py-3 text-sm font-semibold sm:w-auto sm:min-w-[170px]" type="button" variant="secondary" onClick={openArticleModal}>Rechercher article</Button>
            </div>
          </div>

          {ticketDetail}

        </section>

        <section className="card-shell min-w-0 p-4 md:p-5 lg:sticky lg:top-4 lg:self-start lg:p-4 xl:p-5">
          <form className="space-y-3 lg:space-y-4" onSubmit={(event) => event.preventDefault()}>

            <div className="rounded-[22px] border border-white/10 bg-black/20 p-3 lg:p-2.5 xl:p-3">
              <div className="mb-3 flex rounded-2xl border border-white/10 bg-black/25 p-1">
                <button
                  type="button"
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${ticketTab === "payment" ? "bg-orange-300 text-black" : "text-[#ddcfc1] hover:bg-white/5"}`}
                  onClick={() => setTicketTab("payment")}
                >
                  <WalletCards className="h-4 w-4" />
                  Encaissement
                </button>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#ddcfc1] transition hover:bg-white/5"
                  onClick={openCashReportModal}
                >
                  <ReceiptText className="h-4 w-4" />
                  Rapports caisse
                </button>
              </div>

              {ticketTab === "payment" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Client">
                    <button
                      type="button"
                      className="input-base flex h-12 w-full items-center justify-between text-left text-white"
                      onClick={openClientModal}
                    >
                      <span className="truncate">{selectedCustomer?.fullName ?? "Client comptoir"}</span>
                      <Search className="h-4 w-4 shrink-0 text-orange-200" />
                    </button>
                  </Field>

                  <Field label="Vendeur">
                    <button
                      type="button"
                      className="input-base flex h-12 w-full items-center justify-between text-left text-white"
                      onClick={openSellerModal}
                    >
                      <span className="truncate">{form.sellerName || "Choisir vendeur(s)"}</span>
                      <Search className="h-4 w-4 shrink-0 text-orange-200" />
                    </button>
                  </Field>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 lg:p-3 xl:p-4">
                    <Button className="w-full" type="button" disabled={!cart.length} onClick={holdCurrentTicket}>Mettre en attente</Button>
                  </div>

                  <div className="space-y-2">
                    {heldTickets.map((ticket) => (
                      <div key={ticket.id} className="rounded-2xl border border-white/10 bg-black/25 p-2.5 lg:p-2.5 xl:p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-white">{ticket.customerName}</p>
                            <p className="mt-1 text-xs text-[#baa999]">{ticket.lines.length} ligne(s) - {ticket.createdAt}</p>
                          </div>
                          <span className="text-sm font-semibold text-orange-100">{formatCurrency(ticket.total)}</span>
                        </div>
                        <Button className="mt-3 w-full py-2 text-sm" type="button" variant="secondary" onClick={() => restoreHeldTicket(ticket)}>
                          <RotateCcw className="h-4 w-4" />
                          Reprendre
                        </Button>
                      </div>
                    ))}
                    {!heldTickets.length ? <EmptyState title="Aucun ticket en attente" description="Les paniers suspendus apparaitront ici." compact /> : null}
                  </div>
                </div>
              )}
            </div>

            <Button className="w-full !py-2.5 text-sm" type="button" variant="secondary" onClick={() => setTicketTab("hold")}>
              <span className="inline-flex items-center gap-2">
                <PauseCircle className="h-4 w-4" />
                Mise en attente
              </span>
            </Button>
            <Button className="w-full py-3 text-base lg:py-2.5 lg:text-[15px]" type="button" disabled={!cart.length || saving} onClick={openCheckoutModal}>{saving ? "Validation..." : `Encaisser ${formatCurrency(grandTotal)}`}</Button>
          </form>
        </section>
      </div>
      {cashReportModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-[1120px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[30px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">POS / Rapports caisse</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className="rounded-full border border-orange-300/25 bg-orange-300/10 px-4 py-2 text-xs font-semibold text-orange-100 transition hover:bg-orange-300/20" onClick={openCustomerCreditsModal}>
                  Credits clients
                </button>
                <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setCashReportModalOpen(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
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
                      void loadCashReport({ type: "Y", silent: true });
                      return;
                    }
                    if (tab.key === "report-periodic") {
                      void loadCashReport({ dateFrom: cashReportDateFrom || todayIso, dateTo: cashReportDateTo || todayIso, silent: true });
                      return;
                    }
                    void loadCashSessionsOverview({ silent: true });
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className={`grid gap-3 ${cashAdminTab === "report-periodic" ? "xl:grid-cols-[170px_170px_210px_auto]" : "xl:grid-cols-[170px_210px_auto]"}`}>
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
              <Field label="Caisse">
                <Select value={cashReportRegisterId} onChange={(event) => setCashReportRegisterId(event.target.value)} disabled={isCashierSession}>
                  {!isCashierSession ? <option value="">Toutes les caisses</option> : null}
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
                      ? loadCashSessionsOverview()
                      : loadCashReport()
                  )}
                >
                  {cashReportLoading ? "Chargement..." : "Actualiser"}
                </Button>
                <Button className="!py-3 text-sm" type="button" onClick={printCashReport} disabled={!cashReportData || !["report-x", "report-y", "report-end-day", "report-periodic"].includes(cashAdminTab)}>
                  <span className="inline-flex items-center gap-2">
                    <Printer className="h-4 w-4" />
                    Imprimer
                  </span>
                </Button>
              </div>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {cashReportLoading ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-white/10 bg-black/20">
                  <LoadingBlock label="Chargement du rapport caisse..." />
                </div>
              ) : (cashAdminTab === "report-x" || cashAdminTab === "report-y" || cashAdminTab === "report-end-day" || cashAdminTab === "report-periodic") && cashReportData ? (
                <div className="space-y-4">
                  {cashAdminTab !== "report-end-day" ? (
                    <div className="grid gap-3 md:grid-cols-1">
                      <div className="rounded-[18px] border border-white/10 bg-black/20 p-3.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">{cashAdminTab === "report-periodic" ? "Total periode" : "Total journee"}</p>
                        <p className="mt-1.5 text-xl font-bold text-white">{formatCurrency(cashReportData.totals.totalAmount)}</p>
                        <p className="mt-1 text-xs text-[#baa999]">{cashReportData.totals.ticketsCount} ticket(s)</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                    <div className="space-y-4">
                      {cashAdminTab === "report-end-day" ? (
                        <div className="rounded-[18px] border border-orange-300/20 bg-black/20 p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Total journee</p>
                              <p className="mt-1.5 text-xl font-bold text-white">{formatCurrency(cashReportPaymentTotals.totalDayNet)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={printEndDayTicket}
                              className="inline-flex shrink-0 items-center gap-2 rounded-[14px] border border-orange-300/30 bg-orange-300/12 px-3 py-2 text-xs font-semibold text-orange-100 transition hover:border-orange-300/50 hover:bg-orange-300/18"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Imprimer fin journee
                            </button>
                          </div>
                          <p className="mt-1 text-xs text-[#baa999]">{cashReportData.totals.ticketsCount} ticket(s)</p>
                        </div>
                      ) : null}

                      <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">
                              {cashAdminTab === "report-periodic"
                                ? "Rapport periodique"
                                : cashAdminTab === "report-end-day"
                                  ? "Rapport fin de journee"
                                  : `Rapport ${cashReportType}`}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-white">
                              {cashReportData.period?.isRange
                                ? `${formatReportDateLabel(cashReportData.period.dateFrom)} - ${formatReportDateLabel(cashReportData.period.dateTo)}`
                                : formatReportDateLabel(cashReportData.date)}
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
                              <span className="font-semibold text-white">{formatCurrency(cashReportPaymentTotals.totalDayNet)}</span>
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between gap-3"><span>Total HT</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.subtotalHt)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>TVA</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.taxAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Remises</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.discountAmount)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Frais de port</span><span className="font-semibold text-white">{formatCurrency(cashReportData.totals.shippingFee)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total Carte de Credit</span><span className="font-semibold text-white">{formatCurrency(cashReportPaymentTotals.card)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total Espece</span><span className="font-semibold text-white">{formatCurrency(cashReportPaymentTotals.cash)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total Euro</span><span className="font-semibold text-white">{formatForeignCurrency(cashReportPaymentTotals.euro, "EUR")}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Total USD</span><span className="font-semibold text-white">{formatForeignCurrency(cashReportPaymentTotals.usd, "USD")}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Avoir</span><span className="font-semibold text-white">{formatCurrency(cashReportPaymentTotals.voucher)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Compte Clients</span><span className="font-semibold text-white">{formatCurrency(cashReportPaymentTotals.credit)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Virement</span><span className="font-semibold text-white">{formatCurrency(cashReportPaymentTotals.transfer)}</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Cheque</span><span className="font-semibold text-white">{formatCurrency(cashReportPaymentTotals.cheque)}</span></div>
                        </div>
                      </div>

                      {cashAdminTab === "report-end-day" ? (
                        <div className="rounded-[22px] border border-orange-300/25 bg-[linear-gradient(135deg,rgba(255,157,47,0.14),rgba(255,157,47,0.04))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                          <div className="mb-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Cloture de caisse</p>
                            <h3 className="mt-1 text-lg font-semibold text-white">Fin de journee</h3>
                          </div>
                          <div className="space-y-2 rounded-[18px] border border-orange-300/20 bg-black/20 p-3 text-sm text-[#f1e6da]">
                            <div className="flex items-center justify-between gap-3">
                              <span>Ouverture MAD</span>
                              <span className="font-semibold text-white">{cashReportOpeningMad ? formatCurrency(cashReportOpeningMad.amount) : "-"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Ouverture EUR</span>
                              <span className="font-semibold text-white">{cashReportOpeningEur ? formatForeignCurrency(cashReportOpeningEur.amount, "EUR") : "-"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Cloture MAD</span>
                              <span className="font-semibold text-white">
                                {cashReportClosingMad
                                  ? formatCurrency(cashReportClosingMad.amount)
                                  : cashReportData.session?.closingAmount != null
                                    ? formatCurrency(cashReportData.session.closingAmount)
                                    : "-"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Cloture EUR</span>
                              <span className="font-semibold text-white">{cashReportClosingEur ? formatForeignCurrency(cashReportClosingEur.amount, "EUR") : "-"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Ecart MAD</span>
                              <span
                                className={
                                  (Number(cashReportClosingMad?.amount ?? 0) - Number(cashReportOpeningMad?.amount ?? 0)) !== 0
                                    ? "font-semibold text-rose-200"
                                    : "font-semibold text-white"
                                }
                              >
                                {formatCurrency(Number(cashReportClosingMad?.amount ?? 0) - Number(cashReportOpeningMad?.amount ?? 0))}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Ecart EUR</span>
                              <span
                                className={
                                  (Number(cashReportClosingEur?.amount ?? 0) - Number(cashReportOpeningEur?.amount ?? 0)) !== 0
                                    ? "font-semibold text-rose-200"
                                    : "font-semibold text-white"
                                }
                              >
                                {formatForeignCurrency(
                                  Number(cashReportClosingEur?.amount ?? 0) - Number(cashReportOpeningEur?.amount ?? 0),
                                  "EUR"
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2 text-xs text-[#d7c7b8]">
                              <span>Session</span>
                              <span>{cashReportData.session?.closedAt ? `Cloturee a ${new Date(cashReportData.session.closedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Session non cloturee"}</span>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {cashAdminTab !== "report-periodic" ? (
                        <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                          <div className="mb-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Ouverture</p>
                          </div>
                          <div className="overflow-hidden rounded-[18px] border border-white/10">
                            <table className="min-w-full text-sm text-[#eadfd4]">
                              <thead className="bg-[#1f1712] text-[11px] uppercase tracking-[0.16em] text-[#cdbfaf]">
                                <tr>
                                  <th className="px-3 py-3 text-left">Devise</th>
                                  <th className="px-3 py-3 text-right">Montant</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(cashReportData.session?.openingBreakdown ?? []).map((entry) => (
                                  <tr key={entry.currencyCode} className="border-t border-white/10">
                                    <td className="px-3 py-3 font-medium text-white">{entry.currencyCode}</td>
                                    <td className="px-3 py-3 text-right">{entry.currencyCode === "MAD" ? formatCurrency(entry.amount) : `${entry.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entry.currencyCode}`}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {!(cashReportData.session?.openingBreakdown ?? []).length ? (
                              <div className="p-4 text-sm text-[#baa999]">Aucun detail devise pour l'ouverture.</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
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
                          <EmptyState title="Aucun article vendu" description="Les ventes du jour apparaitront ici, avec les totaux par categorie." compact />
                        ) : null}
                      </div>
                    </div>
                    </div>
                  </div>
                </div>
              ) : cashAdminTab === "history" && cashSessionsOverview ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-[22px] border border-white/10 bg-black/20">
                    <table className="min-w-full text-sm text-[#eadfd4]">
                      <thead className="bg-[#1f1712] text-[11px] uppercase tracking-[0.16em] text-[#cdbfaf]">
                        <tr>
                          <th className="px-3 py-3 text-left">Caisse</th>
                          <th className="px-3 py-3 text-left">Ouverture</th>
                          <th className="px-3 py-3 text-left">Fermeture</th>
                          <th className="px-3 py-3 text-left">Operateurs</th>
                          <th className="px-3 py-3 text-right">Fond</th>
                          <th className="px-3 py-3 text-right">CA</th>
                          <th className="px-3 py-3 text-right">Ecart</th>
                          <th className="px-3 py-3 text-center">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCashSessionHistory.map((session) => (
                          <tr key={session.id} className="border-t border-white/10 align-top">
                            <td className="px-3 py-3">
                              <div className="font-semibold text-white">{session.register.name}</div>
                              <div className="mt-1 text-[11px] text-[#baa999]">{session.warehouse.name}</div>
                            </td>
                            <td className="px-3 py-3">
                              <div>{new Date(session.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
                              <div className="mt-1 text-[11px] text-[#baa999]">
                                {session.openingBreakdown.map((entry) => `${entry.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entry.currencyCode}`).join(" / ") || formatCurrency(session.openingAmount)}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div>{session.closedAt ? new Date(session.closedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"}</div>
                              <div className="mt-1 text-[11px] text-[#baa999]">
                                {session.closingBreakdown.length
                                  ? session.closingBreakdown.map((entry) => `${entry.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entry.currencyCode}`).join(" / ")
                                  : session.closingAmount != null
                                    ? formatCurrency(session.closingAmount)
                                    : "-"}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div>{session.openedBy.fullName}</div>
                              <div className="mt-1 text-[11px] text-[#baa999]">{session.closedBy?.fullName || "-"}</div>
                            </td>
                            <td className="px-3 py-3 text-right font-medium text-white">{formatCurrency(session.openingAmount)}</td>
                            <td className="px-3 py-3 text-right font-semibold text-white">{formatCurrency(session.turnoverAmount)}</td>
                            <td className="px-3 py-3 text-right font-medium text-white">{session.varianceAmount == null ? "-" : formatCurrency(session.varianceAmount)}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${session.status === "OPEN" ? "bg-emerald-400/15 text-emerald-100" : "bg-white/10 text-[#eadfd4]"}`}>
                                {session.status === "OPEN" ? "Active" : "Cloturee"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filteredCashSessionHistory.length ? (
                      <div className="p-4 text-sm text-[#baa999]">Aucune ouverture ou fermeture pour cette date.</div>
                    ) : null}
                  </div>
                </div>
              ) : cashAdminTab === "registers" && cashSessionsOverview ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {filteredCashRegisterSummaries.map((register) => (
                      <div key={register.register.id} className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Caisse</p>
                            <h3 className="mt-1 text-lg font-semibold text-white">{register.register.name}</h3>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${register.status === "OPEN" ? "bg-emerald-400/15 text-emerald-100" : "bg-white/10 text-[#eadfd4]"}`}>
                            {register.status === "OPEN" ? "Active" : "Cloturee"}
                          </span>
                        </div>
                        <div className="mt-4 space-y-2 text-sm text-[#eadfd4]">
                          <div className="flex items-center justify-between gap-3"><span>CA jour</span><strong className="text-white">{formatCurrency(register.turnoverAmount)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Total encaisse</span><strong className="text-white">{formatCurrency(register.paidAmount)}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Tickets</span><strong className="text-white">{register.ticketsCount}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Ouverte par</span><strong className="text-white">{register.openedBy?.fullName || "-"}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Ouverture</span><strong className="text-white">{register.openedAt ? new Date(register.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"}</strong></div>
                          <div className="flex items-center justify-between gap-3"><span>Fermeture</span><strong className="text-white">{register.closedAt ? new Date(register.closedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"}</strong></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!filteredCashRegisterSummaries.length ? (
                    <EmptyState title="Aucune caisse" description="Aucune caisse active ou cloturee pour cette date." compact />
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-white/10 bg-black/20">
                  <EmptyState title="Donnees indisponibles" description="Choisis la date, puis actualise pour afficher les informations caisse." compact />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {cashSessionModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-[920px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[28px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Caisse</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Ouverture de caisse</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setCashSessionModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid max-h-[calc(100vh-10rem)] gap-4 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Caisse">
                    <Select value={cashReportRegisterId} onChange={(event) => setCashReportRegisterId(event.target.value)} disabled={isCashierSession}>
                      <option value="">Choisir une caisse</option>
                      {reportRegisters.map((register) => (
                        <option key={register.id} value={register.id}>{register.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#d8cabd]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Boutique</p>
                    <p className="mt-1 font-semibold text-white">{warehouses.find((warehouse) => warehouse.id === form.warehouseId)?.name || user?.defaultWarehouse?.name || "Boutique caisse"}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    { code: "MAD" as const, label: "MAD", value: openingCashMad, secondary: formatCurrency(Number(openingCashMad || 0)) },
                    { code: "EUR" as const, label: "EUR", value: openingCashEur, secondary: `Eq. ${formatCurrency(convertForeignToMad(Number(openingCashEur || 0), eurCurrency?.rateFromMad))}` },
                    { code: "USD" as const, label: "USD", value: openingCashUsd, secondary: `Eq. ${formatCurrency(convertForeignToMad(Number(openingCashUsd || 0), usdCurrency?.rateFromMad))}` }
                  ].map((currency) => (
                    <button
                      key={currency.code}
                      type="button"
                      className={`rounded-[20px] border px-4 py-3 text-left transition ${openingCurrencyTarget === currency.code ? "border-orange-300/60 bg-orange-300/12" : "border-white/10 bg-black/20 hover:border-orange-300/30"}`}
                      onClick={() => setOpeningCurrencyTarget(currency.code)}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">{currency.label}</p>
                      <p className="mt-1 text-xl font-bold text-white">{Number(currency.value || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <p className="mt-1 text-xs text-[#baa999]">{currency.secondary}</p>
                    </button>
                  ))}
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Total ouverture</p>
                      <h3 className="mt-1 text-2xl font-bold text-white">
                        {formatCurrency(
                          Number(openingCashMad || 0)
                          + convertForeignToMad(Number(openingCashEur || 0), eurCurrency?.rateFromMad)
                          + convertForeignToMad(Number(openingCashUsd || 0), usdCurrency?.rateFromMad)
                        )}
                      </h3>
                    </div>
                    <div className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-[#d9cbbe]">
                      Cible: {openingCurrencyTarget}
                    </div>
                  </div>
                  <div className="grid gap-2 text-sm text-[#eadfd4]">
                    <div className="flex items-center justify-between gap-3"><span>MAD</span><strong>{formatCurrency(Number(openingCashMad || 0))}</strong></div>
                    <div className="flex items-center justify-between gap-3"><span>EUR</span><strong>{Number(openingCashEur || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR</strong></div>
                    <div className="flex items-center justify-between gap-3"><span>USD</span><strong>{Number(openingCashUsd || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong></div>
                  </div>
                </div>
              </div>

              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier numerique</p>
                <div className="grid grid-cols-3 gap-2">
                  {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "00"]].flat().map((key) => (
                    <button key={key} type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-base font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendOpeningCurrencyKey(key)}>
                      {key}
                    </button>
                  ))}
                  <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-3 text-xs font-semibold text-rose-100" onClick={deleteOpeningCurrencyKey}>Effacer</button>
                  <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-semibold text-white" onClick={clearOpeningCurrencyKey}>Vider</button>
                  <button type="button" className="rounded-xl border border-orange-300/25 bg-orange-300/10 py-3 text-xs font-semibold text-orange-100" onClick={submitCashOpening} disabled={openingSessionLoading}>
                    {openingSessionLoading ? "Ouverture..." : "Valider"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {checkoutModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-[1120px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[30px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Encaisser</p>
                
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setCheckoutModalOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid max-h-[calc(100vh-10rem)] gap-4 overflow-y-auto pr-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(172px,208px)] md:items-start">
                <div className="min-w-0 space-y-4">
                  <div className="w-full rounded-[20px] border border-orange-300/20 bg-orange-300/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-orange-200/80">Montant a payer</p>
                    <p className="mt-1 text-2xl font-bold text-white">{formatCurrency(Number(paymentDraft || 0))}</p>
                  </div>
                  <div className="w-full rounded-[24px] border border-white/10 bg-black/20 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier numerique</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[['1', '2', '3'],['4', '5', '6'],['7', '8', '9'],['.', '0', '00']].map((row, rowIndex) => row.map((key) => (
                        <button key={`${rowIndex}-${key}`} type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-base font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendPaymentKey(key)}>{key}</button>
                      )))}
                      <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-3 text-xs font-semibold text-rose-100" onClick={deletePaymentKey}>Effacer</button>
                      <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-semibold text-white" onClick={clearPaymentDraft}>Vider</button>
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Modes de paiement</p>
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
                    {activePaymentMethods.map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        className={`w-full rounded-[18px] border px-3 py-3 text-left transition ${selectedPaymentMethodCode === method.code ? "border-orange-300/60 bg-orange-300/12 text-white" : "border-white/10 bg-white/5 text-white hover:border-orange-300/30"}`}
                        onClick={() => handlePaymentMethodCard(method.code)}
                      >
                        <span className="block text-sm font-semibold">{method.label}</span>
                      </button>
                    ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="grid gap-3">
                  <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-3">
                    <p className="text-[9px] uppercase tracking-[0.16em] text-orange-200/80">Montant a encaisser</p>
                    <p className="mt-1 text-base font-bold text-white">{formatCurrency(grandTotal)}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                      <p className="text-[9px] uppercase tracking-[0.16em] text-[#cdbfaf]">Total Recu</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatCurrency(paidAmount)}</p>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                      <p className="text-[9px] uppercase tracking-[0.16em] text-[#cdbfaf]">Rendu</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatCurrency(changeDue)}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-black/25 p-3">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Detail du paiement</p>
                  <div className="max-h-[280px] overflow-auto rounded-[16px] border border-white/10">
                    <table className="min-w-full text-sm text-[#eadfd4]">
                      <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">
                        <tr>
                          <th className="px-3 py-2 text-left">Mode</th>
                          
                          <th className="px-3 py-2 text-right">Montant</th>
                          <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentEntries.map((entry) => (
                          <tr key={entry.id} className="border-t border-white/10">
                            <td className="px-3 py-2 font-semibold text-white">{entry.methodLabel}{entry.reference ? <div className="mt-1 text-[11px] font-medium text-[#baa999]">{entry.reference}</div> : null}</td>
                            
                            <td className="px-3 py-2 text-right font-semibold text-white">{formatCurrency(entry.amountMad)}</td>
                            <td className="px-3 py-2 text-right"><button type="button" className="text-xs font-semibold text-rose-100" onClick={() => removePaymentEntry(entry.id)}>Retirer</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!paymentEntries.length ? <div className="p-4 text-center text-sm text-[#baa999]">Aucun reglement ajoute.</div> : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-white/10 pt-3 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={() => setCheckoutModalOpen(false)}>Annuler</Button><Button type="button" onClick={() => void checkout()} disabled={!paymentEntries.length || saving || paidAmount < grandTotal}>{saving ? "Validation..." : "Valider l'encaissement"}</Button></div>
          </div>
        </div>
      ) : null}
      {customerCreditsModalOpen ? (
        <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[96dvh] w-full max-w-[1280px] flex-col overflow-hidden rounded-[30px] border border-orange-300/20 bg-[#17110d] p-4 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">POS / Credits clients</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Liste et remboursements credits</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" className="!px-4" onClick={() => void loadCustomerCredits({ keepSelection: true })} disabled={customerCreditsLoading}>
                  Actualiser
                </Button>
                <Button type="button" variant="secondary" className="!px-4" onClick={printCustomerCreditsList} disabled={!customerCreditRows.length}>
                  <Printer className="mr-2 h-4 w-4" /> Imprimer liste
                </Button>
                <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setCustomerCreditsModalOpen(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-[minmax(220px,1.1fr)_140px_150px_150px_auto]">
              <Input
                value={customerCreditFilters.query}
                onChange={(event) => setCustomerCreditFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Rechercher client, telephone, ticket..."
              />
              <select
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                value={customerCreditFilters.status}
                onChange={(event) => setCustomerCreditFilters((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="all">Tous</option>
                <option value="open">Ouverts</option>
                <option value="partial">Partiels</option>
                <option value="paid">Soldes</option>
              </select>
              <Input type="date" value={customerCreditFilters.dateFrom} onChange={(event) => setCustomerCreditFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
              <Input type="date" value={customerCreditFilters.dateTo} onChange={(event) => setCustomerCreditFilters((current) => ({ ...current, dateTo: event.target.value }))} />
              <Button type="button" onClick={() => void loadCustomerCredits()} disabled={customerCreditsLoading}>Rechercher</Button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] border border-orange-300/20 bg-orange-300/10 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-orange-100/80">Credits</p>
                <p className="mt-1 text-lg font-bold text-white">{formatCurrency(customerCreditsData?.summary.creditAmount ?? 0)}</p>
              </div>
              <div className="rounded-[20px] border border-emerald-300/20 bg-emerald-300/10 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-100/80">Rembourse</p>
                <p className="mt-1 text-lg font-bold text-white">{formatCurrency(customerCreditsData?.summary.repaidAmount ?? 0)}</p>
              </div>
              <div className="rounded-[20px] border border-rose-300/20 bg-rose-300/10 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-rose-100/80">Solde restant</p>
                <p className="mt-1 text-lg font-bold text-white">{formatCurrency(customerCreditsData?.summary.balanceAmount ?? 0)}</p>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(330px,0.7fr)]">
              <div className="min-h-0 overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
                <div className="max-h-full overflow-auto">
                  <table className="min-w-full text-sm text-[#eadfd4]">
                    <thead className="sticky top-0 z-10 bg-[#24170f] text-xs uppercase tracking-[0.2em] text-[#f8e7d3]">
                      <tr>
                        <th className="px-4 py-3 text-left">Ticket</th>
                        <th className="px-4 py-3 text-left">Client</th>
                        <th className="px-4 py-3 text-left">Boutique</th>
                        <th className="px-4 py-3 text-right">Credit</th>
                        <th className="px-4 py-3 text-right">Rembourse</th>
                        <th className="px-4 py-3 text-right">Solde</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {customerCreditRows.map((row) => (
                        <tr
                          key={row.id}
                          className={`cursor-pointer transition ${selectedCustomerCredit?.id === row.id ? "bg-orange-300/12" : "hover:bg-white/5"}`}
                          onClick={() => {
                            setSelectedCustomerCreditId(row.id);
                            setCustomerCreditRepaymentForm({
                              repaymentId: "",
                              amount: row.balanceAmount > 0 ? String(row.balanceAmount) : "",
                              method: customerCreditPaymentMethods[0]?.code || "CASH",
                              reference: "",
                              note: ""
                            });
                          }}
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-white">{row.saleNumber}</p>
                            <p className="text-xs text-[#baa999]">{formatDate(row.createdAt)}</p>
                            <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${row.status === "paid" ? "bg-emerald-300/15 text-emerald-100" : row.status === "partial" ? "bg-orange-300/15 text-orange-100" : "bg-rose-300/15 text-rose-100"}`}>
                              {row.status === "paid" ? "Solde" : row.status === "partial" ? "Partiel" : "Ouvert"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-white">{row.customer.fullName}</p>
                            <p className="text-xs text-[#baa999]">{row.customer.phone || "-"}</p>
                          </td>
                          <td className="px-4 py-3">{row.warehouse.name}</td>
                          <td className="px-4 py-3 text-right font-semibold text-white">{formatCurrency(row.creditAmount)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-100">{formatCurrency(row.repaidAmount)}</td>
                          <td className="px-4 py-3 text-right font-bold text-orange-100">{formatCurrency(row.balanceAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!customerCreditRows.length ? (
                    <div className="p-8 text-center text-sm text-[#baa999]">{customerCreditsLoading ? "Chargement..." : "Aucun credit client trouve pour ces criteres."}</div>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 overflow-auto rounded-[24px] border border-white/10 bg-black/20 p-4">
                {selectedCustomerCredit ? (
                  <div className="space-y-4">
                    <div className="rounded-[20px] border border-orange-300/20 bg-orange-300/10 p-4">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-orange-100/80">Credit selectionne</p>
                      <h3 className="mt-1 text-lg font-bold text-white">{selectedCustomerCredit.saleNumber}</h3>
                      <p className="mt-1 text-sm text-[#eadfd4]">{selectedCustomerCredit.customer.fullName} - {selectedCustomerCredit.warehouse.name}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-2xl bg-black/25 p-2"><span className="block text-[#baa999]">Credit</span><strong className="text-white">{formatCurrency(selectedCustomerCredit.creditAmount)}</strong></div>
                        <div className="rounded-2xl bg-black/25 p-2"><span className="block text-[#baa999]">Regle</span><strong className="text-emerald-100">{formatCurrency(selectedCustomerCredit.repaidAmount)}</strong></div>
                        <div className="rounded-2xl bg-black/25 p-2"><span className="block text-[#baa999]">Solde</span><strong className="text-orange-100">{formatCurrency(selectedCustomerCredit.balanceAmount)}</strong></div>
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#cdbfaf]">Remboursement</p>
                      <div className="grid gap-3">
                        <Field label="Montant">
                          <Input value={customerCreditRepaymentForm.amount} onChange={(event) => setCustomerCreditRepaymentForm((current) => ({ ...current, amount: event.target.value }))} />
                        </Field>
                        <Field label="Mode de paiement">
                          <select
                            className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none"
                            value={customerCreditRepaymentForm.method}
                            onChange={(event) => setCustomerCreditRepaymentForm((current) => ({ ...current, method: event.target.value }))}
                          >
                            {customerCreditPaymentMethods.map((method) => (
                              <option key={method.id} value={method.code}>{method.label}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Reference">
                          <Input value={customerCreditRepaymentForm.reference} onChange={(event) => setCustomerCreditRepaymentForm((current) => ({ ...current, reference: event.target.value }))} placeholder="Cheque, virement, note..." />
                        </Field>
                        <Field label="Note">
                          <Input value={customerCreditRepaymentForm.note} onChange={(event) => setCustomerCreditRepaymentForm((current) => ({ ...current, note: event.target.value }))} />
                        </Field>
                        <div className="flex gap-2">
                          <Button type="button" className="flex-1" onClick={() => void saveCustomerCreditRepayment()} disabled={customerCreditSaving || selectedCustomerCredit.balanceAmount <= 0}>
                            {customerCreditSaving ? "Enregistrement..." : customerCreditRepaymentForm.repaymentId ? "Modifier" : "Rembourser"}
                          </Button>
                          {customerCreditRepaymentForm.repaymentId ? (
                            <Button type="button" variant="secondary" onClick={() => setCustomerCreditRepaymentForm({ repaymentId: "", amount: String(selectedCustomerCredit.balanceAmount), method: customerCreditPaymentMethods[0]?.code || "CASH", reference: "", note: "" })}>
                              Annuler
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#cdbfaf]">Historique remboursements</p>
                      <div className="space-y-2">
                        {selectedCustomerCredit.repayments.map((repayment) => (
                          <div key={repayment.id} className="rounded-2xl border border-white/10 bg-black/25 p-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-white">{formatCurrency(repayment.amount)} - {formatPosPaymentMethodLabel(repayment.method)}</p>
                                <p className="text-xs text-[#baa999]">{formatDate(repayment.createdAt)} par {repayment.createdByName || "-"}</p>
                                {repayment.reference ? <p className="mt-1 text-xs text-[#eadfd4]">Ref: {repayment.reference}</p> : null}
                              </div>
                              {canManageCustomerCredits ? (
                                <div className="flex gap-1">
                                  <button type="button" className="rounded-full border border-white/10 px-2 py-1 text-[11px] font-semibold text-orange-100" onClick={() => editCustomerCreditRepayment(repayment)}>Modifier</button>
                                  <button type="button" className="rounded-full border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-[11px] font-semibold text-rose-100" onClick={() => void deleteCustomerCreditRepayment(repayment)}><Trash2 className="h-3.5 w-3.5" /></button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        {!selectedCustomerCredit.repayments.length ? <p className="text-sm text-[#baa999]">Aucun remboursement enregistre.</p> : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="Aucun credit selectionne" description="Recherche un client ou une periode pour afficher les credits a rembourser." />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {voucherModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-sm">
          <div className="w-full max-w-[520px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Bon achat</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Verifier un bon</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setVoucherModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <Field label="Numero du bon achat">
                <div className="flex gap-2">
                  <Input
                    data-pos-modal-search
                    value={voucherNumberDraft}
                    onChange={(event) => setVoucherNumberDraft(event.target.value.toUpperCase())}
                    placeholder="Ex. BA-2026-0001"
                    className="h-12 text-base uppercase"
                  />
                  <Button type="button" variant="secondary" className="shrink-0 !px-4" onClick={() => void lookupVoucher()} disabled={voucherLookupLoading}>
                    {voucherLookupLoading ? "..." : "Verifier"}
                  </Button>
                </div>
              </Field>
              {voucherLookup ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">Montant du bon</p>
                    <p className="mt-1 text-base font-semibold text-white">{formatCurrency(voucherLookup.initialAmount)}</p>
                  </div>
                  <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-orange-200/80">Solde actuel</p>
                    <p className="mt-1 text-base font-semibold text-white">{formatCurrency(voucherLookup.balanceAmount)}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">Montant utilise</p>
                    <p className="mt-1 text-base font-semibold text-white">{formatCurrency(voucherAmountToUse)}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">Solde du bon</p>
                    <p className="mt-1 text-base font-semibold text-white">{formatCurrency(voucherBalanceAfter)}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 sm:col-span-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">Client / Boutique</p>
                    <p className="mt-1 text-sm font-semibold text-white">{voucherLookup.customerName || "Client non renseigne"}</p>
                    <p className="mt-1 text-xs text-[#cdbfaf]">{voucherLookup.customerPhone || "-"} • {voucherLookup.warehouseName || "Boutique non definie"}</p>
                    {voucherLookup.usableInCurrentWarehouse === false ? <p className="mt-2 text-xs font-semibold text-rose-200">Consultation possible, paiement bloque dans cette boutique.</p> : null}
                  </div>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setVoucherModalOpen(false)}>Annuler</Button>
                <Button type="button" onClick={applyVoucherPayment} disabled={!voucherLookup || voucherAmountToUse <= 0}>Ajouter le bon</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {creditNoteModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[min(92vh,860px)] w-full max-w-[1240px] flex-col overflow-hidden rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-200/80">Bon d'avoir</p>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={closeCreditNoteModal}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col gap-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="rounded-[20px] border border-rose-300/15 bg-white/[0.03] p-3">
                <Field label="Ticket de caisse">
                  <div className="flex gap-2">
                    <Input
                      data-pos-modal-search
                      autoFocus
                      value={creditTicketCode}
                      onChange={(event) => setCreditTicketCode(event.target.value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void lookupCreditTicket();
                        }
                      }}
                      placeholder="Scanner ou saisir le ticket"
                      className="h-11 text-[15px] uppercase"
                    />
                    <Button type="button" variant="secondary" className="h-11 shrink-0 !px-4" onClick={() => void lookupCreditTicket()} disabled={creditPreviewLoading}>
                      {creditPreviewLoading ? "..." : "Charger"}
                    </Button>
                  </div>
                </Field>
                {creditTicketPreview ? (
                  <div className="mt-3 rounded-[16px] border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#eadfd4]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">Ticket charge</span>
                      <span className="font-semibold text-white">{creditTicketPreview.number}</span>
                    </div>
                    <div className="mt-1.5 text-[11px] text-[#baa999]">{creditTicketPreview.warehouse.name} • {formatDate(creditTicketPreview.createdAt)}</div>
                  </div>
                ) : null}
                </div>
                <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#cdbfaf]">Client</p>
                  <div className="mt-3 space-y-2.5">
                    <div className="grid grid-cols-[118px_minmax(0,1fr)] items-center gap-3">
                      <span className="text-sm font-medium text-[#efe3d7]">Nom du client</span>
                      <Input value={creditCustomerName} onChange={(event) => setCreditCustomerName(event.target.value)} placeholder="Nom complet" className="ml-auto h-11 max-w-[220px] text-[15px]" />
                    </div>
                    <div className="grid grid-cols-[118px_minmax(0,1fr)] items-center gap-3">
                      <span className="text-sm font-medium text-[#efe3d7]">Telephone client</span>
                      <Input value={creditCustomerPhone} onChange={(event) => setCreditCustomerPhone(event.target.value)} placeholder="Numero de telephone" className="ml-auto h-11 max-w-[220px] text-[15px]" />
                    </div>
                    <div className="grid grid-cols-[118px_minmax(0,1fr)] items-center gap-3">
                      <span className="text-sm font-medium text-[#efe3d7]">Motif</span>
                      <Input value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Retour client" className="ml-auto h-11 max-w-[220px] text-[15px]" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex min-h-0 flex-col space-y-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Articles du ticket</p>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto rounded-[18px] border border-white/10">
                  <table className="min-w-full text-sm text-[#eadfd4]">
                    <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">
                      <tr>
                        <th className="px-3 py-2 text-left">Reference</th>
                        <th className="px-3 py-2 text-left">Article</th>
                        <th className="px-3 py-2 text-center">Restant</th>
                        <th className="px-3 py-2 text-right">Prix</th>
                        <th className="px-3 py-2 text-right">Avoir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(creditTicketPreview?.items ?? []).map((item) => (
                        <tr key={item.saleItemId} className="border-t border-white/10">
                          <td className="px-3 py-2 text-xs font-semibold text-white">{item.reference || "-"}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-white">{item.productName}</div>
                            <div className="mt-1 text-[11px] text-[#baa999]">Vendu: {item.soldQty} • Deja credite: {item.creditedQty}</div>
                          </td>
                          <td className="px-3 py-2 text-center font-semibold text-white">{item.remainingQty}</td>
                          <td className="px-3 py-2 text-right font-semibold text-white">{formatCurrency(item.unitPriceTtc)}</td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              value={creditSelectedItems[item.saleItemId] ?? "0"}
                              onChange={(event) => patchCreditItemQuantity(item.saleItemId, event.target.value)}
                              className="ml-auto h-10 w-[84px] text-right"
                              disabled={item.remainingQty <= 0}
                            />
                          </td>
                        </tr>
                      ))}
                      {!creditTicketPreview ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-[#baa999]">Scanne d'abord un ticket de caisse pour charger les articles.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
                  <Button type="button" variant="secondary" onClick={closeCreditNoteModal}>Annuler</Button>
                  <Button type="button" className="bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400" onClick={() => void createCreditVoucher()} disabled={creditSubmitting || !creditTicketPreview}>
                    {creditSubmitting ? "Creation..." : "Valider le bon d'avoir"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {paymentReferenceModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-sm">
          <div className="w-full max-w-[420px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">{paymentReferenceMethod?.title || "Paiement"}</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Saisir la reference</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setPaymentReferenceModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <Field label={paymentReferenceMethod?.fieldLabel || "Reference"}>
                <Input
                  value={paymentReferenceDraft}
                  onChange={(event) => setPaymentReferenceDraft(event.target.value.toUpperCase())}
                  placeholder={paymentReferenceMethod?.fieldLabel || "Reference"}
                  className="h-12 text-base uppercase"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setPaymentReferenceModalOpen(false)}>Annuler</Button>
                <Button type="button" onClick={applyPaymentReference}>Valider</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}      {currencyPaymentModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-[860px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[28px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Devise</p>
                
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setCurrencyPaymentModalOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid max-h-[calc(100vh-10rem)] gap-4 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
              <div className="min-w-0 space-y-4">
                <div>
                  
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {currencies.filter((currency) => currency.code !== "MAD").map((currency) => (
                      <button key={currency.id} type="button" className={`rounded-[20px] border px-4 py-4 text-left transition ${paymentCurrency?.id === currency.id ? "border-orange-300/60 bg-orange-300/12 text-white" : "border-white/10 bg-white/5 text-white hover:border-orange-300/30"}`} onClick={() => setCurrencyId(currency.id)}>
                        <span className="block text-sm font-semibold">{currency.code}</span>
                        <span className="mt-1 block text-xs text-[#c9b9aa]">{currency.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-orange-200/80">Montant a payer MAD</p>
                    <p className="mt-1 text-xl font-semibold text-white">{formatCurrency(currencyAmountToPayMad)}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-[#cdbfaf]">Montant a payer en devise</p>
                    <p className="mt-1 text-xl font-semibold text-white">{paymentCurrency ? `${currencyDueAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${paymentCurrency.symbol || paymentCurrency.code}` : "-"}</p>
                  </div>
                </div>
                {currencyChangeMad > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button type="button" className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-orange-300/30" onClick={() => applyCurrencyPayment("MAD")}>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-[#cdbfaf]">Rendu en MAD</p>
                      <p className="mt-1 text-xl font-semibold text-white">{formatCurrency(currencyChangeMad)}</p>
                    </button>
                    <button type="button" className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-orange-300/30" onClick={() => applyCurrencyPayment("CURRENCY")}>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-[#cdbfaf]">Rendu en devise</p>
                      <p className="mt-1 text-xl font-semibold text-white">{paymentCurrency ? `${currencyChangeAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${paymentCurrency.symbol || paymentCurrency.code}` : "-"}</p>
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="w-full space-y-3">
                <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">Montant payer</p>
                  <p className="mt-1 text-xl font-semibold text-white">{paymentCurrency ? `${currencyTenderAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${paymentCurrency.symbol || paymentCurrency.code}` : "0"}</p>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier numerique</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[["1", "2", "3"],["4", "5", "6"],["7", "8", "9"],[".", "0", "00"]].map((row, rowIndex) => row.map((key) => (
                      <button key={`${rowIndex}-${key}`} type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-base font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendCurrencyPaymentKey(key)}>{key}</button>
                    )))}
                    <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-3 text-xs font-semibold text-rose-100" onClick={deleteCurrencyPaymentKey}>Effacer</button>
                    <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-semibold text-white" onClick={clearCurrencyPaymentDraft}>Vider</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-white/10 pt-3 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={() => setCurrencyPaymentModalOpen(false)}>Annuler</Button>{currencyChangeMad <= 0 ? <Button type="button" onClick={() => applyCurrencyPayment(null)}>Valider</Button> : null}</div>
          </div>
        </div>
      ) : null}
      {quantityModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Quantite</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Modifier la quantite</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setQuantityModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="rounded-[20px] border border-orange-300/20 bg-orange-300/10 px-4 py-3 text-center">
              <p className="text-3xl font-bold text-white">{quantityDraft || "0"}</p>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[["1","2","3"],["4","5","6"],["7","8","9"],["0"]].flat().map((key) => (
                <button key={key} type="button" className="rounded-xl border border-white/10 bg-white/5 py-4 text-lg font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendQuantityKey(key)}>{key}</button>
              ))}
              <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-4 text-sm font-semibold text-rose-100" onClick={deleteQuantityKey}>Effacer</button>
              <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-4 text-sm font-semibold text-white" onClick={clearQuantityDraft}>Vider</button>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setQuantityModalOpen(false)}>Annuler</Button><Button type="button" onClick={applyQuantityDraft}>Valider</Button></div>
          </div>
        </div>
      ) : null}
      {ticketLineActionModalOpen && ticketLineActionLine ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-[480px] rounded-[28px] border border-white/15 bg-[#17110d] p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">{ticketLineActionLine.name}</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={closeTicketLineActionModal}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  className="flex flex-1 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-orange-300/35 hover:bg-orange-300/10"
                  onClick={() => requestManagerApproval("offered")}
                >
                  <span>
                    <span className="block text-base font-semibold text-white">Offert</span>
                  </span>
                  <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold text-emerald-100">Offert</span>
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-[11px] font-semibold text-rose-100 transition hover:border-rose-300/35 hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => cancelOfferedLine(ticketLineActionLine.lineId)}
                  disabled={ticketLineActionLine.price > 0}
                >
                  Supprimer
                </button>
              </div>
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  className="flex flex-1 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-orange-300/35 hover:bg-orange-300/10"
                  onClick={() => requestManagerApproval("discount")}
                >
                  <span>
                    <span className="block text-base font-semibold text-white">Remise</span>
                  </span>
                  <span className="rounded-full border border-orange-300/30 bg-orange-300/10 px-3 py-1 text-[11px] font-semibold text-orange-100">R</span>
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-[11px] font-semibold text-rose-100 transition hover:border-rose-300/35 hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => cancelLineDiscount(ticketLineActionLine.lineId)}
                  disabled={ticketLineActionLine.discountAmount <= 0}
                >
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {managerApprovalModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[28px] border border-white/15 bg-[#17110d] p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Validation manager</p>
                <h2 className="mt-1 text-xl font-semibold text-white">
                  {managerApprovalAction === "offered"
                    ? "Article offert"
                    : managerApprovalAction === "ticket-discount"
                      ? "Autoriser une remise ticket"
                      : "Autoriser une remise"}
                </h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={closeManagerApprovalModal}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {managerApprovalLine ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-semibold text-white">{managerApprovalLine.name}</p>
                <p className="mt-1 text-xs text-[#c9b8aa]">{[managerApprovalLine.reference, managerApprovalLine.color, managerApprovalLine.size].filter(Boolean).join(" - ") || "Article selectionne"}</p>
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              <Field label="Scanner le badge manager">
                <Input
                  autoFocus
                  className="h-12 text-base"
                  value={managerApprovalCode}
                  onChange={(event) => setManagerApprovalCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void confirmManagerApproval();
                    }
                  }}
                  placeholder="Ex: MGR-nom-manager"
                />
              </Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeManagerApprovalModal}>Annuler</Button>
              <Button type="button" onClick={() => void confirmManagerApproval()} disabled={!managerApprovalCode.trim() || managerApprovalLoading}>
                {managerApprovalLoading ? "Validation..." : "Valider"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {lineDiscountModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Remise article</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Appliquer une remise</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setLineDiscountModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${lineDiscountMode === "amount" ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-white/5 text-white"}`} onClick={() => setLineDiscountMode("amount")}>Montant</button>
                  <button type="button" className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${lineDiscountMode === "percent" ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-white/5 text-white"}`} onClick={() => setLineDiscountMode("percent")}>Pourcentage</button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[5, 10, 20, 30].map((value) => (
                    <button key={value} type="button" className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${lineDiscountMode === "percent" && Number(lineDiscountDraft || 0) === value ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-black/25 text-[#eadccf] hover:border-orange-300/30"}`} onClick={() => selectLineDiscountPercent(value)}>{value}%</button>
                  ))}
                </div>
                <div className="w-full max-w-[240px] rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-3 py-2 text-sm text-[#eadfd4]">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Remise appliquee</p>
                  <p className="mt-1 text-lg font-semibold text-white">{lineDiscountMode === "percent" ? `${lineDiscountDraft || 0}%` : formatCurrency(Number(lineDiscountDraft || 0))}</p>
                </div>
              </div>
              <div className="w-full rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier numerique</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["1", "2", "3"],
                    ["4", "5", "6"],
                    ["7", "8", "9"],
                    [".", "0", "00"]
                  ].map((row, rowIndex) => row.map((key) => (
                    <button key={`${rowIndex}-${key}`} type="button" className="rounded-xl border border-white/10 bg-white/5 py-4 text-lg font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendLineDiscountKey(key)}>{key}</button>
                  )))}
                  <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-4 text-sm font-semibold text-rose-100" onClick={deleteLineDiscountKey}>Effacer</button>
                  <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-4 text-sm font-semibold text-white" onClick={clearLineDiscountDraft}>Vider</button>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setLineDiscountModalOpen(false)}>Annuler</Button><Button type="button" onClick={applyLineDiscountDraft}>Valider</Button></div>
          </div>
        </div>
      ) : null}
      {ticketDiscountModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <div className="w-full max-w-[980px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Remise ticket</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Appliquer une remise globale</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setTicketDiscountModalOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${ticketDiscountMode === "percent" ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-white/5 text-white"}`} onClick={() => setTicketDiscountMode("percent")}>Pourcentage</button>
                  <button type="button" className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${ticketDiscountMode === "amount" ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-white/5 text-white"}`} onClick={() => setTicketDiscountMode("amount")}>Montant</button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[5, 10, 20, 30].map((value) => (
                    <button key={value} type="button" className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${ticketDiscountMode === "percent" && Number(ticketDiscountDraft || 0) === value ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-black/25 text-[#eadccf] hover:border-orange-300/30"}`} onClick={() => selectTicketDiscountPercent(value)}>{value}%</button>
                  ))}
                </div>
                <div className="w-full max-w-[240px] rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-3 py-2 text-sm text-[#eadfd4]">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Remise appliquee</p>
                  <p className="mt-1 text-lg font-semibold text-white">{ticketDiscountMode === "percent" ? `${ticketDiscountDraft || 0}%` : formatCurrency(Number(ticketDiscountDraft || 0))}</p>
                </div>
              </div>
              <div className="w-full rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier numerique</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["1", "2", "3"],
                    ["4", "5", "6"],
                    ["7", "8", "9"],
                    [".", "0", "00"]
                  ].map((row, rowIndex) => row.map((key) => (
                    <button key={`${rowIndex}-${key}`} type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendTicketDiscountKey(key)}>{key}</button>
                  )))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-3 text-sm font-semibold text-rose-100" onClick={deleteTicketDiscountKey}>Effacer</button>
                  <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white" onClick={clearTicketDiscountDraft}>Vider</button>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setTicketDiscountModalOpen(false)}>Annuler</Button><Button type="button" onClick={applyTicketDiscountDraft}>Valider</Button></div>
          </div>
        </div>
      ) : null}
      {shippingModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <div className="w-full max-w-[980px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Livraison</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Frais de port</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setShippingModalOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
              <div className="min-w-0 space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Transporteur</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <button
                      type="button"
                      className={`rounded-[20px] border px-4 py-4 text-left transition ${!form.transporterId ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-white/5 text-white hover:border-orange-300/30"}`}
                      onClick={() => setForm((current) => ({ ...current, transporterId: "" }))}
                    >
                      <span className="block text-sm font-semibold">Aucun</span>
                    </button>
                    {transporters.map((transporter) => (
                      <button
                        key={transporter.id}
                        type="button"
                        className={`rounded-[20px] border px-4 py-4 text-left transition ${form.transporterId === transporter.id ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-white/5 text-white hover:border-orange-300/30"}`}
                        onClick={() => setForm((current) => ({ ...current, transporterId: transporter.id }))}
                      >
                        <span className="block text-sm font-semibold">{transporter.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="w-full rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier numerique</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["1", "2", "3"],
                    ["4", "5", "6"],
                    ["7", "8", "9"],
                    [".", "0", "00"]
                  ].map((row, rowIndex) => row.map((key) => (
                    <button key={`${rowIndex}-${key}`} type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendShippingFeeKey(key)}>{key}</button>
                  )))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-3 text-sm font-semibold text-rose-100" onClick={deleteShippingFeeKey}>Effacer</button>
                  <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white" onClick={clearShippingFeeDraft}>Vider</button>
                </div>
              </div>
            </div>
            <div className="-mt-16 flex justify-start">
              <div className="w-full max-w-[220px] rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-3 py-2 text-sm text-[#eadfd4]">
                <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Montant</p>
                <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(Number(shippingFeeDraft || 0))}</p>
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setShippingModalOpen(false)}>Annuler</Button><Button type="button" onClick={applyShippingFeeDraft}>Valider</Button></div>
          </div>
        </div>
      ) : null}
      {orderModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <form className="w-full max-w-4xl rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5" onSubmit={addOrderDepositLine}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Ajouter une commande</p>
                
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setOrderModalOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["Sac", "Vetement", "Chaussure", "Mobilier"].map((type) => <button key={type} type="button" className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${orderForm.type === type ? "border-orange-300/60 bg-orange-300 text-black" : "border-white/10 bg-black/25 text-[#eadccf] hover:border-orange-300/30"}`} onClick={() => setOrderForm((current) => ({ ...current, type }))}>{type}</button>)}
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
              <div className="space-y-3">
                <Field label="Numero de commande"><Input value={orderForm.number} onFocus={() => setOrderInputTarget("number")} onChange={(e) => setOrderForm((current) => ({ ...current, number: e.target.value }))} required /></Field>
                <Field label="Total commande"><Input type="number" step="0.01" min="0" inputMode="decimal" value={orderForm.totalAmount} onFocus={() => setOrderInputTarget("totalAmount")} onChange={(e) => setOrderForm((current) => ({ ...current, totalAmount: e.target.value }))} /></Field>
                <Field label="Montant acompte"><Input type="number" step="0.01" min="0" inputMode="decimal" value={orderForm.depositAmount} onFocus={() => setOrderInputTarget("depositAmount")} onChange={(e) => setOrderForm((current) => ({ ...current, depositAmount: e.target.value }))} required /></Field>
                <div className="w-full max-w-[220px] rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-3 py-2 text-sm text-[#eadfd4]">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Reste a payer</p>
                  <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(orderRemaining)}</p>
                </div>
              </div>
              <div className="w-full rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier numerique</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["1", "2", "3"],
                    ["4", "5", "6"],
                    ["7", "8", "9"],
                    [".", "0", "00"]
                  ].map((row, rowIndex) => row.map((key) => (
                    <button key={`${rowIndex}-${key}`} type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white active:bg-orange-300 active:text-black" onClick={() => appendOrderKey(key)}>{key}</button>
                  )))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-3 text-sm font-semibold text-rose-100" onClick={deleteOrderKey}>Effacer</button>
                  <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white" onClick={clearOrderField}>Vider</button>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOrderModalOpen(false)}>Annuler</Button><Button type="submit">Valider</Button></div>
          </form>
        </div>
      ) : null}
      {deliveryOrderModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <form
            className="flex h-[100dvh] w-full max-w-[980px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[28px] sm:border sm:border-white/15 sm:p-4 md:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void searchDeliveryOrder();
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Livraison Commande</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Rechercher une commande deja saisie</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setDeliveryOrderModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="rounded-[20px] border border-white/10 bg-black/20 p-3 md:p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                  <Field label="Numero de commande">
                    <Input
                      data-pos-modal-search
                      className="h-12"
                      inputMode="numeric"
                      value={deliveryOrderNumber}
                      onChange={(event) => setDeliveryOrderNumber(event.target.value.replace(/\D/g, ""))}
                      placeholder="Ex: 117263"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button className="w-full !py-3" type="submit" disabled={deliveryOrderLoading}>
                      {deliveryOrderLoading ? "Recherche..." : "Rechercher"}
                    </Button>
                  </div>
                </div>
                <div className="mt-3 rounded-[16px] border border-orange-300/15 bg-orange-300/6 px-3 py-2 text-xs text-[#d9c8b7]">
                  Saisis le numero de commande puis lance la recherche.
                </div>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Clavier numerique</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["1", "2", "3"],
                    ["4", "5", "6"],
                    ["7", "8", "9"],
                    ["0"]
                  ].map((row, rowIndex) => row.map((key) => (
                    <button
                      key={`delivery-order-${rowIndex}-${key}`}
                      type="button"
                      className="rounded-lg border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-white active:bg-orange-300 active:text-black"
                      onClick={() => appendDeliveryOrderKey(key)}
                    >
                      {key}
                    </button>
                  )))}
                  <button type="button" className="rounded-lg border border-rose-300/20 bg-rose-400/10 py-2.5 text-xs font-semibold text-rose-100" onClick={deleteDeliveryOrderKey}>Effacer</button>
                  <button type="button" className="rounded-lg border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-white" onClick={clearDeliveryOrderKey}>Vider</button>
                </div>
              </div>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {deliveryOrderResult ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Numero de commande</p>
                    <p className="mt-1 text-lg font-semibold text-white">{deliveryOrderResult.orderNumber}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Vendeuse</p>
                    <p className="mt-1 text-lg font-semibold text-white">{deliveryOrderResult.firstSale.sellerName || "Non renseigne"}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Ticket de vente</p>
                    <p className="mt-1 text-lg font-semibold text-white">{deliveryOrderResult.firstSale.ticketNumber}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Type</p>
                    <p className="mt-1 text-lg font-semibold text-white">{deliveryOrderResult.orderType}</p>
                  </div>
                </div>

                <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Details</p>
                  <p className="mt-2 text-sm text-[#eadfd4]">{deliveryOrderResult.firstSale.details}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Montant commande</p>
                    <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(deliveryOrderResult.orderTotal)}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Montant acompte</p>
                    <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(deliveryOrderResult.depositAmount)}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Montant regle</p>
                    <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(deliveryOrderResult.paidAmount)}</p>
                  </div>
                  <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Montant du reste</p>
                    <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(deliveryOrderResult.remainingAmount)}</p>
                  </div>
                </div>

                <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Paiement lors de la premiere fois</p>
                    <p className="text-xs text-[#baa999]">{new Date(deliveryOrderResult.firstSale.createdAt).toLocaleString("fr-FR")}</p>
                  </div>
                  <div className="overflow-x-auto rounded-[16px] border border-white/10">
                    <table className="min-w-full text-sm text-[#eadfd4]">
                      <thead className="bg-[#1f1712] text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">
                        <tr>
                          <th className="px-3 py-3 text-left">Mode</th>
                          <th className="px-3 py-3 text-left">Reference</th>
                          <th className="px-3 py-3 text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveryOrderResult.firstSale.payments.map((payment) => (
                          <tr key={payment.id} className="border-t border-white/10">
                            <td className="px-3 py-3 text-white">{formatPosPaymentMethodLabel(payment.method)}</td>
                            <td className="px-3 py-3 text-[#cdbfaf]">{payment.reference || "-"}</td>
                            <td className="px-3 py-3 text-right font-semibold text-white">{formatCurrency(payment.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!deliveryOrderResult.firstSale.payments.length ? (
                      <div className="p-4 text-sm text-[#baa999]">Aucun detail de paiement disponible.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeliveryOrderModalOpen(false)}>Annuler</Button>
              {deliveryOrderResult && deliveryOrderResult.remainingAmount <= 0 ? (
                <Button type="button" variant="secondary" onClick={() => void markDeliveryOrderAsDelivered()} disabled={deliveryOrderCompleting}>
                  {deliveryOrderCompleting ? "Mise a jour..." : "Marquer livree"}
                </Button>
              ) : null}
              <Button type="button" onClick={applyDeliveryOrderToCart} disabled={!deliveryOrderResult}>
                Valider
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {articleModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-[860px] flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[28px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Articles</p>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setArticleModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-w-0 space-y-3 overflow-y-auto pr-1">
              <Field label="">
                <Input
                  data-pos-article-search
                  value={articleSearch}
                  onClick={handleArticleSearchTap}
                  onDoubleClick={() => setArticleKeyboardOpen(true)}
                  onChange={(event) => void handleArticleSearchChange(event)}
                  placeholder="Reference, article ou prix..."
                />
              </Field>
              {articleKeyboardOpen ? (
                <div className="w-full rounded-[24px] border border-white/10 bg-black/20 p-2.5 sm:max-w-none sm:p-3">
                  <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_156px]">
                    <div className="space-y-2">
                      {["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"].map((row) => (
                        <div key={row} className={`grid gap-1.5 ${row.length === 10 ? "grid-cols-10" : "grid-cols-6"}`}>
                          {row.split("").map((key) => (
                            <button key={key} type="button" className="rounded-xl border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-white active:bg-orange-300 active:text-black sm:py-1.5 sm:text-xs" onClick={() => appendArticleSearchKey(key)}>{key}</button>
                          ))}
                        </div>
                      ))}
                      <button type="button" className="w-full rounded-xl border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-white sm:py-1.5 sm:text-xs" onClick={() => appendArticleSearchKey(" ")}>Espace</button>
                    </div>
                    <div className="space-y-2">
                      {["123", "456", "789"].map((row) => (
                        <div key={row} className="grid grid-cols-3 gap-1.5">
                          {row.split("").map((key) => (
                            <button key={key} type="button" className="rounded-xl border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-white active:bg-orange-300 active:text-black sm:py-1.5 sm:text-xs" onClick={() => appendArticleSearchKey(key)}>{key}</button>
                          ))}
                        </div>
                      ))}
                      <button type="button" className="w-full rounded-xl border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-white sm:py-1.5 sm:text-xs" onClick={() => appendArticleSearchKey("0")}>0</button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-1.5 text-[11px] font-semibold text-rose-100 sm:py-1.5 sm:text-xs" onClick={deleteArticleSearchKey}>Effacer</button>
                    <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-white sm:py-1.5 sm:text-xs" onClick={() => setArticleKeyboardOpen(false)}>Fermer</button>
                    <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-white sm:py-1.5 sm:text-xs" onClick={clearArticleSearch}>Vider</button>
                  </div>
                </div>
              ) : null}
              <div className="max-h-[52vh] overflow-auto rounded-[22px] border border-white/10 bg-black/20">
                <table className="min-w-full text-sm text-[#eadfd4]">
                  <thead className="sticky top-0 bg-[#1f1712] text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">
                    <tr>
                      <th className="px-4 py-3 text-left">Reference</th>
                      <th className="px-4 py-3 text-left">Article</th>
                      <th className="px-4 py-3 text-right">Prix</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCatalog.map((product) => (
                      <tr key={product.id} className="cursor-pointer border-t border-white/10 transition hover:bg-white/5" onDoubleClick={() => addArticleFromModal(product)}>
                        <td className="px-4 py-3 font-medium text-white">{product.reference}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-white">{product.name}</div>
                          <div className="mt-1 text-xs text-[#b8aa9c]">{product.barcode || "Sans code-barres"}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-white">{formatCurrency(product.salePriceTtc)}</td>
                        <td className="px-4 py-3 text-right">
                          <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => addArticleFromModal(product)}>Ajouter</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredCatalog.length ? <div className="p-4"><EmptyState title="Aucun article" description="Essaie avec une reference, un nom ou un prix." compact /></div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}      {sellerModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[28px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Vendeur</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Choisir vendeur(s)</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setSellerModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <Field label="Recherche vendeur">
              <Input data-pos-seller-search value={sellerSearch} onChange={(event) => setSellerSearch(event.target.value)} placeholder="Nom du vendeur..." />
            </Field>

            <div className="mt-4 grid max-h-[58vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSellers.map((seller) => {
                const checked = selectedSellerNames.includes(seller.fullName);
                return (
                  <button
                    key={seller.id}
                    type="button"
                    className={`flex min-h-[72px] items-center justify-between gap-3 rounded-[20px] border px-4 py-4 text-left transition ${checked ? "border-orange-300/55 bg-orange-300/15 shadow-[0_0_0_1px_rgba(253,186,116,.25)]" : "border-white/10 bg-black/25 hover:border-orange-300/30 hover:bg-white/5"}`}
                    onClick={() => toggleSeller(seller.fullName)}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{seller.fullName}</span>
                    <span className={`inline-flex min-w-[72px] justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${checked ? "bg-orange-300 text-black" : "bg-white/10 text-[#d8cabc]"}`}>
                      {checked ? "Selectionne" : "Choisir"}
                    </span>
                  </button>
                );
              })}
              {!filteredSellers.length ? <div className="sm:col-span-2 lg:col-span-3"><EmptyState title="Aucun vendeur" description="Aucun vendeur ne correspond a cette recherche." compact /></div> : null}
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-white/10 pt-3 sm:flex-row sm:justify-between">
              <Button type="button" variant="secondary" onClick={clearSellers}>Effacer</Button>
              <Button type="button" onClick={() => setSellerModalOpen(false)}>Valider</Button>
            </div>
          </div>
        </div>
      ) : null}
      {clientModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm">
          <div className="flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-none border-0 bg-[#17110d] p-3 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-1.5rem)] sm:rounded-[28px] sm:border sm:border-white/15 sm:p-4 md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Client</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Rechercher ou ajouter un client</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setClientModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid max-h-[calc(100vh-10rem)] gap-4 overflow-y-auto pr-1 lg:grid-cols-[1fr_0.95fr]">
              <div className="space-y-3">
                <Field label="Recherche client">
                  <Input data-pos-client-search value={clientSearch} onFocus={() => setClientInputTarget("search")} onChange={(event) => setClientSearch(event.target.value)} placeholder="Nom, telephone ou email..." />
                </Field>
                <button type="button" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white" onClick={() => selectCustomer(null)}>
                  Client comptoir
                </button>
                <div className="max-h-[36vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[290px]">
                  {filteredCustomers.map((customer) => (
                    <button key={customer.id} type="button" className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-left transition hover:border-orange-300/30 hover:bg-white/5" onClick={() => selectCustomer(customer)}>
                      <p className="font-semibold text-white">{customer.fullName}</p>
                      <p className="mt-1 text-xs text-[#b9aa9c]">{customer.phone || customer.email || "Aucune coordonnee"}</p>
                    </button>
                  ))}
                  {!filteredCustomers.length ? <EmptyState title="Aucun client" description="Ajoute-le rapidement depuis le formulaire a droite." compact /> : null}
                </div>
              </div>

              <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-orange-100"><UserPlus className="h-4 w-4" /> Nouveau client</div>
                <Field label="Nom client">
                  <Input value={newClient.fullName} onFocus={() => setClientInputTarget("name")} onChange={(event) => setNewClient((current) => ({ ...current, fullName: event.target.value }))} placeholder="Nom complet" />
                </Field>
                <Field label="Telephone">
                  <Input value={newClient.phone} onFocus={() => setClientInputTarget("phone")} onChange={(event) => setNewClient((current) => ({ ...current, phone: event.target.value }))} placeholder="06..." />
                </Field>
                <Button className="w-full" type="button" disabled={creatingClient} onClick={() => void createCustomerFromPos()}>{creatingClient ? "Creation..." : "Ajouter et choisir"}</Button>

                <div className="rounded-[22px] border border-white/10 bg-black/25 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Clavier tactile</p>
                  {["1234567890", "AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"].map((row) => (
                    <div key={row} className="mb-2 grid grid-cols-10 gap-1 last:mb-0">
                      {row.split("").map((key) => (
                        <button key={key} type="button" className="rounded-xl border border-white/10 bg-white/5 py-1.5 text-xs font-semibold text-white active:bg-orange-300 active:text-black sm:py-2 sm:text-sm" onClick={() => appendVirtualKey(key)}>{key}</button>
                      ))}
                    </div>
                  ))}
                  <div className="grid grid-cols-[1fr_1fr] gap-2">
                    <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-1.5 text-xs font-semibold text-white sm:py-2 sm:text-sm" onClick={() => appendVirtualKey(" ")}>Espace</button>
                    <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-1.5 text-xs font-semibold text-rose-100 sm:py-2 sm:text-sm" onClick={deleteVirtualKey}>Effacer</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


























