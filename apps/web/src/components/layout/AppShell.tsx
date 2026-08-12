import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Factory,
  FileSpreadsheet,
  LayoutDashboard,
  Menu,
  PackageSearch,
  Printer,
  Receipt,
  Search,
  Settings,
  ShoppingBasket,
  Truck,
  UsersRound,
  X
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { cn } from "../../lib/format";
import { isNetworkError, readCachedOpenCashSession, readPosSnapshot, rememberOpenCashSession } from "../../lib/offline";
import { useAuth } from "../../providers/AuthProvider";
import { Button, EmptyState, Input, LoadingBlock } from "../ui/primitives";

type NavItem = {
  label: string;
  to?: string;
  icon?: typeof LayoutDashboard;
  permission?: string;
  children?: Array<NavItem>;
};

const NAVIGATION: Array<NavItem> = [
  { label: "Tableau de bord", to: "/", icon: LayoutDashboard, permission: "dashboard_view" },
  {
    label: "Gestion",
    icon: Boxes,
    children: [
      { label: "Articles", to: "/gestion/produits", icon: PackageSearch, permission: "products_manage" },
      { label: "Type article", to: "/gestion/produits/types", icon: FileSpreadsheet, permission: "settings_manage" },
      { label: "Categorie article", to: "/gestion/produits/categories", icon: FileSpreadsheet, permission: "settings_manage" },
      { label: "Fournisseurs", to: "/gestion/fournisseurs", icon: Truck, permission: "suppliers_manage" },
      { label: "Clients", to: "/gestion/clients", icon: UsersRound, permission: "customers_manage" },
      { label: "Transporteurs", to: "/gestion/transporteurs", icon: Truck, permission: "settings_manage" }
    ]
  },
  {
    label: "Achat",
    icon: ClipboardList,
    children: [
      { label: "Bon de commande", to: "/achat/bon-de-commande", icon: ClipboardList, permission: "purchases_manage" },
      { label: "Bon de reception", to: "/achat/bon-de-reception", icon: ShoppingBasket, permission: "purchases_manage" },
      { label: "Avoir fournisseur", to: "/achat/avoir-fournisseur", icon: Receipt, permission: "purchases_manage" },
      { label: "Facture fournisseur", to: "/achat/facture-fournisseur", icon: Receipt, permission: "purchases_manage" }
    ]
  },
  { label: "Stock", to: "/stock", icon: Factory, permission: "inventory_manage" },
  {
    label: "Commandes",
    icon: CircleDollarSign,
    children: [
      { label: "Commandes non validee", to: "/commandes/non-validee", icon: ClipboardList, permission: "sales_manage" },
      { label: "Commandes validee", to: "/commandes/validee", icon: ClipboardList, permission: "sales_manage" },
      { label: "Commandes Sacs", to: "/commandes/sacs", icon: ShoppingBasket, permission: "sales_manage" },
      { label: "Commandes Vetements", to: "/commandes/vetements", icon: ShoppingBasket, permission: "sales_manage" },
      { label: "Commandes Chaussures", to: "/commandes/chaussures", icon: ShoppingBasket, permission: "sales_manage" },
      { label: "Commandes Iraqi", to: "/commandes/iraqi", icon: ShoppingBasket, permission: "sales_manage" },
      { label: "Commandes Mobiliers", to: "/commandes/mobiliers", icon: ShoppingBasket, permission: "sales_manage" },
      { label: "Verifier Commandes", to: "/commandes/verifier", icon: Search, permission: "sales_manage" }
    ]
  },
  {
    label: "Ventes",
    icon: CircleDollarSign,
    children: [
      { label: "Devis", to: "/ventes/devis", icon: FileSpreadsheet, permission: "sales_manage" },
      { label: "Bon de Livraison", to: "/ventes/bon-de-livraison", icon: ShoppingBasket, permission: "sales_manage" },
      { label: "Avoir Client", to: "/ventes/avoir-client", icon: Receipt, permission: "sales_manage" },
      { label: "Factures Client", to: "/ventes/facture-client", icon: Receipt, permission: "sales_manage" }
    ]
  },
  { label: "POS / Caisse", to: "/pos", icon: CreditCard, permission: "pos_use" },
  { label: "Rapports", to: "/rapports", icon: BarChart3, permission: "reports_view" },
  { label: "Parametres", to: "/parametres", icon: Settings, permission: "settings_manage" }
];

function canView(item: NavItem, permissions: string[]): boolean {
  if (item.children) {
    return item.children.some((child) => canView(child, permissions));
  }
  return !item.permission || permissions.includes(item.permission);
}

function commandValidationNavigation(): Array<NavItem> {
  return [
    {
      label: "Commandes",
      icon: CircleDollarSign,
      children: [
        { label: "Commandes non validee", to: "/commandes/non-validee", icon: ClipboardList, permission: "sales_manage" }
      ]
    }
  ];
}

function hasActiveChild(item: NavItem, pathname: string) {
  return item.children?.some((child) => child.to === pathname) ?? false;
}

type PosTicket = {
  id: string;
  number: string;
  createdAt: string;
  sellerName?: string | null;
  status: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  isInvoiced?: boolean;
  isDetaxed?: boolean;
  customer?: { fullName: string } | null;
  warehouse: { name: string };
  items: Array<{ id: string; quantity: number; productName: string; lineTotal: number }>;
  payments: Array<{ id: string; method: string; displayMethod?: string | null; amount: number; reference?: string | null; createdAt: string }>;
};

type ManagerAuthorizationResult = {
  id: string;
  fullName: string;
  warehouseId: string | null;
  warehouseName: string | null;
};

type PosCatalogRow = {
  id: string;
  productId: string;
  variantId?: string | null;
  name: string;
  reference: string;
  barcode?: string | null;
  salePriceTtc: number;
  stockOnHand: number;
  color?: string | null;
  size?: string | null;
};

type PosTicketItemDetail = {
  id?: string;
  productId: string;
  productName: string;
  reference: string;
  quantity: number;
  unitPriceTtc: number;
  discountAmount: number;
  taxRate: number;
  lineTotal: number;
  kind?: "PRODUCT" | "ORDER_DEPOSIT";
  orderType?: string | null;
  orderNumber?: string | null;
  orderTotal?: number | null;
  depositAmount?: number | null;
};

type PosTicketPaymentDetail = {
  id?: string;
  method: string;
  displayMethod?: string | null;
  amount: number;
  reference?: string | null;
  createdAt?: string;
};

type CurrentCashSession = {
  id: string;
  openingAmount: number;
  status: string;
  openedAt: string;
  openingBreakdown: Array<{
    currencyCode: string;
    amount: number;
    amountMad: number;
    rateFromMad: number;
  }>;
  register: {
    id: string;
    name: string;
    warehouseId: string;
    warehouseName: string;
  };
} | null;

type CashierSessionReminder = {
  type: "open" | "close-previous";
  title: string;
  message: string;
  actionLabel: string;
} | null;

type CashRegisterOption = {
  id: string;
  name: string;
  warehouseId: string;
};

type PosCompanyInfo = {
  name: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  cgvTerms?: string;
  ticketFooter?: string;
};

type CurrencyOption = {
  id: string;
  code: string;
  rateFromMad: number;
  isActive: boolean;
};

type CachedPosSnapshot = {
  bootstrap?: {
    registers?: CashRegisterOption[];
    currencies?: CurrencyOption[];
    company?: PosCompanyInfo;
  };
};

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
  status?: "PENDING" | "ACCEPTED" | "REJECTED";
  respondedAt?: string | null;
  respondedByUserId?: string | null;
  respondedByName?: string | null;
};

type InventoryTransferNotificationHistory = InventoryTransferNotification & {
  isRead: boolean;
};

type PosTicketDetail = Omit<PosTicket, "items" | "payments"> & {
  customerId?: string | null;
  warehouseId: string;
  shippingFee: number;
  editable: boolean;
  editBlockedReason?: string | null;
  items: PosTicketItemDetail[];
  payments: PosTicketPaymentDetail[];
};

type PosTicketReprintPayload = {
  ticket: PosTicketDetail;
  reprintCount: number;
};

type PosDetaxTicketItem = {
  id: string;
  saleItemId: string;
  sourceTicketId: string;
  sourceTicketNumber: string;
  productId: string;
  productName: string;
  reference: string;
  quantity: number;
  unitPriceTtc: number;
  taxRate: number;
  lineTotal: number;
};

type PosDetaxTicketRecord = {
  id: string;
  number: string;
  sourceTicketId: string;
  sourceTicketNumber: string;
  sourceTicketDate: string;
  sourceTickets: Array<{
    sourceTicketId: string;
    sourceTicketNumber: string;
    sourceTicketDate: string;
    warehouseId: string;
    warehouseName: string;
    customerName?: string | null;
    sellerName?: string | null;
  }>;
  warehouseId: string;
  warehouseName: string;
  customerName?: string | null;
  sellerName?: string | null;
  createdByName?: string | null;
  createdAt: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  itemCount: number;
  items: PosDetaxTicketItem[];
  payments: Array<{
    method: string;
    displayMethod?: string | null;
    amount: number;
    reference?: string | null;
  }>;
};

type PosDetaxPreview = {
  sourceTicketId: string;
  sourceTicketNumber: string;
  sourceTicketDate: string;
  sourceTickets: Array<{
    sourceTicketId: string;
    sourceTicketNumber: string;
    sourceTicketDate: string;
    warehouseId: string;
    warehouseName: string;
    customerName?: string | null;
    sellerName?: string | null;
  }>;
  warehouseId: string;
  warehouseName: string;
  customerName?: string | null;
  sellerName?: string | null;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  items: PosDetaxTicketItem[];
  skippedItems: Array<{
    id: string;
    saleItemId: string;
    sourceTicketId: string;
    sourceTicketNumber: string;
    productId: string;
    productName: string;
    reference: string;
    quantity: number;
    unitPriceTtc: number;
    lineTotal: number;
    reason: string;
  }>;
  payments: Array<{
    method: string;
    displayMethod?: string | null;
    amount: number;
    reference?: string | null;
  }>;
};

function formatPaymentMethod(method: string, options?: { fallbackCash?: boolean }) {
  const normalized = String(method || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (normalized === "CASH") return "Espece";
  if (normalized === "CARD") return "Carte bancaire";
  if (normalized === "TRANSFER") return "Virement";
  if (normalized === "CHEQUE") return "Cheque";
  if (normalized === "CREDIT") return "Credit";
  if (normalized === "VOUCHER") return "Bon achat";
  if (normalized === "FOREIGN_CURRENCY") return "Devise";
  if (normalized === "MIXED" && options?.fallbackCash) return "Espece";
  if (normalized === "MIXED") return "Espece";
  return normalized.replace(/_/g, " ");
}

function getPaymentDisplayLabel(
  payment: Pick<PosTicketPaymentDetail, "method" | "displayMethod" | "reference">,
  options?: { fallbackCash?: boolean }
) {
  const displayMethod = String(payment.displayMethod ?? "").trim();
  if (displayMethod) return formatPaymentMethod(displayMethod, options);
  return formatPaymentMethod(payment.method, options);
}

function formatReceiptPaymentLabel(
  payment: Pick<PosTicketPaymentDetail, "method" | "displayMethod">,
  options?: { fallbackCash?: boolean }
) {
  const normalizedMethod = String(payment.method ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  const normalizedDisplay = String(payment.displayMethod ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (normalizedMethod === "CASH" || normalizedMethod === "FOREIGN_CURRENCY" || normalizedMethod === "MIXED") return "ESPECE";
  if (normalizedDisplay === "ESPECE" || normalizedDisplay === "DEVISE") return "ESPECE";
  return getPaymentDisplayLabel(payment, options).toUpperCase();
}

function getSafeDraftId(prefix: string) {
  return `draft-${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function isDraftId(value?: string | null) {
  return String(value ?? "").startsWith("draft-");
}

function normalizeEditPaymentMethod(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "MIXED") return "CASH";
  return normalized || "CASH";
}

const madFormatter = new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD" });

function formatMad(amount: number) {
  return madFormatter.format(amount);
}

function formatTicketDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCasablancaDayKey(value: string | Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function formatDetaxSourceSummary(sourceTickets: Array<{ sourceTicketNumber: string }>) {
  if (!sourceTickets.length) return "";
  if (sourceTickets.length === 1) return sourceTickets[0].sourceTicketNumber;
  return `${sourceTickets[0].sourceTicketNumber} + ${sourceTickets.length - 1}`;
}

function mergeDetaxPreview(current: PosDetaxPreview | null, incoming: PosDetaxPreview) {
  if (!current) return incoming;
  const currentSourceIds = new Set(current.sourceTickets.map((ticket) => ticket.sourceTicketId));
  if (currentSourceIds.has(incoming.sourceTicketId)) {
    return current;
  }
  const mergedWarehouseNames = Array.from(new Set([current.warehouseName, incoming.warehouseName].filter(Boolean)));
  return {
    sourceTicketId: current.sourceTicketId,
    sourceTicketNumber: current.sourceTicketNumber,
    sourceTicketDate: current.sourceTicketDate,
    sourceTickets: [...current.sourceTickets, ...incoming.sourceTickets],
    warehouseId: current.warehouseId,
    warehouseName: mergedWarehouseNames.length <= 1 ? (mergedWarehouseNames[0] ?? current.warehouseName) : "Multi-boutiques",
    customerName: current.customerName || incoming.customerName,
    sellerName: current.sellerName && incoming.sellerName && current.sellerName === incoming.sellerName ? current.sellerName : null,
    subtotal: Number((current.subtotal + incoming.subtotal).toFixed(2)),
    taxAmount: Number((current.taxAmount + incoming.taxAmount).toFixed(2)),
    totalAmount: Number((current.totalAmount + incoming.totalAmount).toFixed(2)),
    items: [...current.items, ...incoming.items],
    skippedItems: [...current.skippedItems, ...incoming.skippedItems],
    payments: [...current.payments, ...incoming.payments]
  };
}

function formatForeignAmount(amount: number, currencyCode: string) {
  return `${Number(amount || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode}`;
}

function buildCode39Svg(value: string) {
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
  const encoded = source.split("").every((char) => patterns[char]) ? source : "*TICKET*";
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
        bars.push(`<rect x="${x}" y="0" width="${width}" height="54" fill="#111" />`);
      }
      x += width;
    }
    x += gap;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} 54" width="100%" height="54" preserveAspectRatio="none">${bars.join("")}</svg>`;
}

function sanitizeUiText(value?: string | null) {
  return String(value ?? "");
}

function renderReceiptTextLines(value?: string | null, className = "muted") {
  const lines = String(value ?? "").split(/\r?\n/);
  return lines.map((line) => {
    const trimmed = sanitizeUiText(line).trim();
    if (!trimmed) return `<div style="height:4px;"></div>`;
    return `<div class="${className}" style="margin-bottom:2px;line-height:1.25;">${trimmed}</div>`;
  }).join("");
}

function formatCleanOrderDepositLabel(item: Pick<PosTicketItemDetail, "orderNumber" | "orderType" | "productName">) {
  if (item.orderNumber) {
    return `Acompte commande NÃ¯Â¿Â½ ${item.orderNumber}${item.orderType ? ` - ${item.orderType}` : ""}`;
  }
  return sanitizeUiText(item.productName);
}

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout, sessionScope } = useAuth();
  const permissions = user?.permissions ?? [];
  const navigationItems = useMemo(
    () => (sessionScope === "command_validation" ? commandValidationNavigation() : NAVIGATION),
    [sessionScope]
  );
  const isPosRoute = pathname === "/pos";
  const defaultWarehouseName = user?.defaultWarehouse?.name ?? "Boutique non assignee";

  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [ticketsModalOpen, setTicketsModalOpen] = useState(false);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [tickets, setTickets] = useState<PosTicket[]>([]);
  const [ticketsQuery, setTicketsQuery] = useState("");
  const [ticketsDateFrom, setTicketsDateFrom] = useState("");
  const [ticketsDateTo, setTicketsDateTo] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketActionLoading, setTicketActionLoading] = useState<"" | "facture" | "detaxe" | "print" | "delete">("");
  const [ticketActionMessage, setTicketActionMessage] = useState<string | null>(null);
  const [detaxModalOpen, setDetaxModalOpen] = useState(false);
  const [detaxTickets, setDetaxTickets] = useState<PosDetaxTicketRecord[]>([]);
  const [detaxTicketsLoading, setDetaxTicketsLoading] = useState(false);
  const [detaxQuery, setDetaxQuery] = useState("");
  const [detaxDateFrom, setDetaxDateFrom] = useState("");
  const [detaxDateTo, setDetaxDateTo] = useState("");
  const [selectedDetaxTicketId, setSelectedDetaxTicketId] = useState<string | null>(null);
  const [detaxCreateModalOpen, setDetaxCreateModalOpen] = useState(false);
  const [detaxLookupCode, setDetaxLookupCode] = useState("");
  const [detaxLookupLoading, setDetaxLookupLoading] = useState(false);
  const [detaxPreview, setDetaxPreview] = useState<PosDetaxPreview | null>(null);
  const [detaxDraftItems, setDetaxDraftItems] = useState<PosDetaxTicketItem[]>([]);
  const [detaxCustomerName, setDetaxCustomerName] = useState("");
  const [detaxCustomerEditOpen, setDetaxCustomerEditOpen] = useState(false);
  const [detaxSaving, setDetaxSaving] = useState(false);
  const [createdDetaxTicket, setCreatedDetaxTicket] = useState<PosDetaxTicketRecord | null>(null);
  const detaxLookupInputRef = useRef<HTMLInputElement | null>(null);
  const detaxScannerBufferRef = useRef("");
  const detaxScannerLastKeyAtRef = useRef(0);
  const detaxScannerResetTimerRef = useRef<number | null>(null);
  const [editTicketModalOpen, setEditTicketModalOpen] = useState(false);
  const [editTicketLoading, setEditTicketLoading] = useState(false);
  const [editTicketSaving, setEditTicketSaving] = useState(false);
  const [editTicketDraft, setEditTicketDraft] = useState<PosTicketDetail | null>(null);
  const [editCatalogModalOpen, setEditCatalogModalOpen] = useState(false);
  const [editCatalogLoading, setEditCatalogLoading] = useState(false);
  const [editCatalogQuery, setEditCatalogQuery] = useState("");
  const [editCatalogRows, setEditCatalogRows] = useState<PosCatalogRow[]>([]);
  const [editOrderModalOpen, setEditOrderModalOpen] = useState(false);
  const [editOrderForm, setEditOrderForm] = useState({ type: "Sac", number: "", totalAmount: "0", depositAmount: "0" });
  const [editPaymentModalOpen, setEditPaymentModalOpen] = useState(false);
  const [editPaymentDraft, setEditPaymentDraft] = useState({ paymentId: "", method: "CASH", amount: "0" });
  const [ticketManagerApprovalOpen, setTicketManagerApprovalOpen] = useState(false);
  const [ticketManagerApprovalAction, setTicketManagerApprovalAction] = useState<"edit" | "delete" | null>(null);
  const [ticketManagerApprovalCode, setTicketManagerApprovalCode] = useState("");
  const [ticketManagerApprovalLoading, setTicketManagerApprovalLoading] = useState(false);
  const [inventoryNotifications, setInventoryNotifications] = useState<InventoryTransferNotification[]>([]);
  const [inventoryHistoryOpen, setInventoryHistoryOpen] = useState(false);
  const [inventoryHistoryLoading, setInventoryHistoryLoading] = useState(false);
  const [inventoryHistory, setInventoryHistory] = useState<InventoryTransferNotificationHistory[]>([]);
  const [inventoryNotificationActionId, setInventoryNotificationActionId] = useState<string | null>(null);
  const [cashierSessionMenuOpen, setCashierSessionMenuOpen] = useState(false);
  const [cashierSessionLoading, setCashierSessionLoading] = useState(false);
  const [currentCashSession, setCurrentCashSession] = useState<CurrentCashSession>(null);
  const [cashClosingMad, setCashClosingMad] = useState("0");
  const [cashClosingEur, setCashClosingEur] = useState("0");
  const [cashClosingTarget, setCashClosingTarget] = useState<"MAD" | "EUR">("MAD");
  const [cashierSessionStep, setCashierSessionStep] = useState<"actions" | "close" | "open" | "password">("actions");
  const [cashSessionActionLoading, setCashSessionActionLoading] = useState<"" | "close" | "logout" | "open">("");
  const [cashierSessionMessage, setCashierSessionMessage] = useState<string | null>(null);
  const [cashierSessionReminder, setCashierSessionReminder] = useState<CashierSessionReminder>(null);
  const [cashSessionRegisters, setCashSessionRegisters] = useState<CashRegisterOption[]>([]);
  const [cashSessionCurrencies, setCashSessionCurrencies] = useState<CurrencyOption[]>([]);
  const [posCompany, setPosCompany] = useState<PosCompanyInfo | null>(null);
  const [cashOpeningRegisterId, setCashOpeningRegisterId] = useState("");
  const [openingCashMad, setOpeningCashMad] = useState("0");
  const [openingCashEur, setOpeningCashEur] = useState("0");
  const [openingCashUsd, setOpeningCashUsd] = useState("0");
  const [openingCurrencyTarget, setOpeningCurrencyTarget] = useState<"MAD" | "EUR" | "USD">("MAD");
  const [cashierPasswordDraft, setCashierPasswordDraft] = useState({ currentCode: "", nextCode: "", confirmCode: "" });
  const [cashierPasswordTarget, setCashierPasswordTarget] = useState<"currentCode" | "nextCode" | "confirmCode">("currentCode");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      navigationItems.filter((item) => item.children).map((item) => [item.label, hasActiveChild(item, pathname)])
    )
  );

  useEffect(() => {
    setOpenMenus((current) => {
      const next = { ...current };
      navigationItems.filter((item) => item.children && canView(item, permissions)).forEach((item) => {
        if (hasActiveChild(item, pathname)) {
          next[item.label] = true;
        } else if (!(item.label in next)) {
          next[item.label] = false;
        }
      });
      return next;
    });
  }, [navigationItems, pathname, permissions]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!(detaxCreateModalOpen && !detaxCustomerEditOpen && !createdDetaxTicket)) return;

    function clearDetaxScannerBuffer() {
      detaxScannerBufferRef.current = "";
      detaxScannerLastKeyAtRef.current = 0;
      if (detaxScannerResetTimerRef.current) {
        window.clearTimeout(detaxScannerResetTimerRef.current);
        detaxScannerResetTimerRef.current = null;
      }
    }

    function scheduleDetaxScannerReset() {
      if (detaxScannerResetTimerRef.current) {
        window.clearTimeout(detaxScannerResetTimerRef.current);
      }
      detaxScannerResetTimerRef.current = window.setTimeout(() => {
        clearDetaxScannerBuffer();
      }, 140);
    }

    function handleDetaxScannerKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName?.toLowerCase();
        const isEditable = target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
        const isLookupInput = target === detaxLookupInputRef.current;
        if (isEditable && !isLookupInput) return;
      }

      if (event.key === "Enter") {
        const scannedCode = detaxScannerBufferRef.current.trim();
        if (!scannedCode) return;
        event.preventDefault();
        setDetaxLookupCode(scannedCode);
        void previewDetaxSourceTicket(scannedCode);
        clearDetaxScannerBuffer();
        return;
      }

      if (event.key.length !== 1) return;

      const now = Date.now();
      if (now - detaxScannerLastKeyAtRef.current > 90) {
        detaxScannerBufferRef.current = "";
      }

      detaxScannerLastKeyAtRef.current = now;
      detaxScannerBufferRef.current = `${detaxScannerBufferRef.current}${event.key}`;
      scheduleDetaxScannerReset();
    }

    window.addEventListener("keydown", handleDetaxScannerKeyDown);
    return () => {
      window.removeEventListener("keydown", handleDetaxScannerKeyDown);
      clearDetaxScannerBuffer();
    };
  }, [detaxCreateModalOpen, detaxCustomerEditOpen, createdDetaxTicket]);

  const todayIso = useMemo(() => {
    const year = currentTime.getFullYear();
    const month = String(currentTime.getMonth() + 1).padStart(2, "0");
    const day = String(currentTime.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [currentTime]);

  const currentDateLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Casablanca",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(currentTime);

  const currentTimeLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Casablanca",
    hour: "2-digit",
    minute: "2-digit"
  }).format(currentTime);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );
  const selectedDetaxTicket = useMemo(
    () => detaxTickets.find((ticket) => ticket.id === selectedDetaxTicketId) ?? null,
    [detaxTickets, selectedDetaxTicketId]
  );
  const detaxScannerCaptureEnabled = detaxCreateModalOpen && !detaxCustomerEditOpen && !createdDetaxTicket;
  const requiresManagerTicketApproval = Boolean(user?.roles?.some((role) => role.toLowerCase() === "caissier"));
  const canOpenProductDetailsFromPos = !user?.roles?.some((role) => role.toLowerCase() === "caissier");
  const editTicketLinesTotal = useMemo(
    () => editTicketDraft?.items.reduce((sum, item) => sum + item.lineTotal, 0) ?? 0,
    [editTicketDraft]
  );
  const editTicketPaymentsTotal = useMemo(
    () => editTicketDraft?.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) ?? 0,
    [editTicketDraft]
  );
  const editTicketBalanceGap = useMemo(
    () => Number((editTicketLinesTotal - editTicketPaymentsTotal).toFixed(2)),
    [editTicketLinesTotal, editTicketPaymentsTotal]
  );
  const editOrderRemaining = useMemo(
    () => Math.max(0, Number(editOrderForm.totalAmount || 0) - Number(editOrderForm.depositAmount || 0)),
    [editOrderForm]
  );
  const canSeeInventoryNotifications = Boolean(
    user
    && !user.roles.includes("admin")
    && user.permissions.includes("inventory_manage")
    && user.defaultWarehouse?.id
  );
  const canManageCash = Boolean(user?.permissions.includes("cash_manage"));

  function getCachedCashSessionSetup() {
    const cached = readPosSnapshot<CachedPosSnapshot>();
    const bootstrap = cached?.bootstrap;
    const registers = (bootstrap?.registers ?? []).filter((register) => !user?.defaultWarehouse?.id || register.warehouseId === user.defaultWarehouse.id);
    const currencies = (bootstrap?.currencies ?? []).filter((currency) => currency.isActive !== false);
    return {
      registers,
      currencies,
      company: bootstrap?.company ?? null
    };
  }

  function buildSessionFromCachedOpenSession(cachedSession: NonNullable<ReturnType<typeof readCachedOpenCashSession>>): CurrentCashSession {
    const register = cashSessionRegisters.find((item) => item.id === cachedSession.registerId);
    return {
      id: cachedSession.id || `offline-cash-${cachedSession.registerId}-${cachedSession.openedAt}`,
      openingAmount: Number(cachedSession.openingAmount ?? 0),
      status: "OPEN",
      openedAt: cachedSession.openedAt,
      openingBreakdown: cachedSession.openingBreakdown ?? [],
      register: {
        id: cachedSession.registerId,
        name: cachedSession.registerName || register?.name || "Caisse",
        warehouseId: cachedSession.warehouseId,
        warehouseName: cachedSession.warehouseName || user?.defaultWarehouse?.name || "Boutique"
      }
    };
  }

  function syncCachedOpenCashSession() {
    const cachedSession = readCachedOpenCashSession({
      warehouseId: user?.defaultWarehouse?.id || undefined,
      date: todayIso
    });
    if (!cachedSession) return false;
    syncCurrentCashSession(buildSessionFromCachedOpenSession(cachedSession));
    return true;
  }

  function syncCurrentCashSession(session: CurrentCashSession) {
    setCurrentCashSession(session);
    const openingMad = session?.openingBreakdown.find((entry) => entry.currencyCode === "MAD")?.amount ?? session?.openingAmount ?? 0;
    const openingEur = session?.openingBreakdown.find((entry) => entry.currencyCode === "EUR")?.amount ?? 0;
    setCashClosingMad(String(Number(openingMad).toFixed(2)));
    setCashClosingEur(String(Number(openingEur).toFixed(2)));
    setCashClosingTarget("MAD");

    if (!session) {
      setCashierSessionReminder({
        type: "open",
        title: "Session caisse a ouvrir",
        message: "Aucune session ouverte pour ce caissier aujourd'hui.",
        actionLabel: "Ouvrir la session"
      });
      return;
    }

    if (formatCasablancaDayKey(session.openedAt) !== todayIso) {
      setCashierSessionReminder({
        type: "close-previous",
        title: "Session precedente a cloturer",
        message: `Une session du ${formatTicketDate(session.openedAt)} est encore ouverte sur ${session.register.name}.`,
        actionLabel: "Fermer la session"
      });
      return;
    }

    setCashierSessionReminder(null);
    rememberOpenCashSession({
      id: session.id,
      registerId: session.register.id,
      registerName: session.register.name,
      warehouseId: session.register.warehouseId,
      warehouseName: session.register.warehouseName,
      openedAt: session.openedAt,
      openingAmount: session.openingAmount,
      openingBreakdown: session.openingBreakdown
    });
  }

  async function refreshCashierSessionState(options?: { includeSetup?: boolean }) {
    if (!canManageCash) {
      syncCurrentCashSession(null);
      setCashSessionRegisters([]);
      return;
    }

    try {
      const session = await api<CurrentCashSession>(`/pos/sessions/current${user?.defaultWarehouse?.id ? `?warehouseId=${encodeURIComponent(user.defaultWarehouse.id)}` : ""}`);
      syncCurrentCashSession(session);
      if (!session && options?.includeSetup) {
        await loadCashSessionSetup();
      }
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (!syncCachedOpenCashSession()) {
        syncCurrentCashSession(null);
        if (options?.includeSetup) {
          await loadCashSessionSetup();
        }
      }
    }
  }

  async function loadTickets(filters?: { query?: string; dateFrom?: string; dateTo?: string }) {
    const query = filters?.query ?? ticketsQuery;
    const dateFrom = filters?.dateFrom ?? ticketsDateFrom;
    const dateTo = filters?.dateTo ?? ticketsDateTo;
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    setTicketsLoading(true);
    try {
      const data = await api<PosTicket[]>(`/pos/tickets${params.toString() ? `?${params.toString()}` : ""}`);
      setTickets(data);
      setSelectedTicketId((current) => (current && data.some((ticket) => ticket.id === current) ? current : null));
    } finally {
      setTicketsLoading(false);
    }
  }

  async function loadDetaxTickets(filters?: { query?: string; dateFrom?: string; dateTo?: string }) {
    const query = filters?.query ?? detaxQuery;
    const dateFrom = filters?.dateFrom ?? detaxDateFrom;
    const dateTo = filters?.dateTo ?? detaxDateTo;
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    setDetaxTicketsLoading(true);
    try {
      const data = await api<PosDetaxTicketRecord[]>(`/pos/detax-tickets${params.toString() ? `?${params.toString()}` : ""}`);
      setDetaxTickets(data);
      setSelectedDetaxTicketId((current) => (current && data.some((ticket) => ticket.id === current) ? current : data[0]?.id ?? null));
    } finally {
      setDetaxTicketsLoading(false);
    }
  }

  function resetDetaxCreateState() {
    setDetaxLookupCode("");
    setDetaxPreview(null);
    setDetaxDraftItems([]);
    setDetaxCustomerName("");
    setDetaxCustomerEditOpen(false);
    setCreatedDetaxTicket(null);
  }

  async function openDetaxModal() {
    setTicketActionMessage(null);
    setDetaxModalOpen(true);
    setDetaxDateFrom((current) => current || todayIso);
    setDetaxDateTo((current) => current || todayIso);
    await loadDetaxTickets({
      query: detaxQuery,
      dateFrom: detaxDateFrom || todayIso,
      dateTo: detaxDateTo || todayIso
    });
  }

  function openNewDetaxModal(prefillTicketNumber?: string | null) {
    setTicketActionMessage(null);
    resetDetaxCreateState();
    if (prefillTicketNumber) {
      setDetaxLookupCode(prefillTicketNumber);
    }
    setDetaxCreateModalOpen(true);
  }

  function closeNewDetaxModal() {
    setDetaxCreateModalOpen(false);
    setTicketActionMessage(null);
    resetDetaxCreateState();
  }

  function appendDetaxLookupDigit(value: string) {
    setDetaxLookupCode((current) => `${current}${value}`.slice(0, 24));
  }

  function deleteDetaxLookupDigit() {
    setDetaxLookupCode((current) => current.slice(0, -1));
  }

  function clearDetaxLookupDigit() {
    setDetaxLookupCode("");
  }

  async function previewDetaxSourceTicket(rawTicketCode?: string) {
    const ticketCode = String(rawTicketCode ?? detaxLookupCode).trim();
    if (!ticketCode) {
      setTicketActionMessage("Saisis ou scanne d'abord un ticket de caisse.");
      return;
    }
    setDetaxLookupLoading(true);
    try {
      const incoming = await api<PosDetaxPreview>("/pos/detax-tickets/preview", {
        method: "POST",
        body: JSON.stringify({ ticketCode })
      });
      const preview: PosDetaxPreview = {
        ...incoming,
        sourceTickets: incoming.sourceTickets?.length ? incoming.sourceTickets : [{
          sourceTicketId: incoming.sourceTicketId,
          sourceTicketNumber: incoming.sourceTicketNumber,
          sourceTicketDate: incoming.sourceTicketDate,
          warehouseId: incoming.warehouseId,
          warehouseName: incoming.warehouseName,
          customerName: incoming.customerName,
          sellerName: incoming.sellerName
        }]
      };
      const mergedPreview = mergeDetaxPreview(detaxPreview, preview);
      const alreadyLoaded = Boolean(detaxPreview?.sourceTickets.some((ticket) => ticket.sourceTicketId === preview.sourceTicketId));
      setDetaxLookupCode("");
      setDetaxPreview(mergedPreview);
      setDetaxDraftItems((current) => {
        if (alreadyLoaded) return current;
        return [...current, ...preview.items];
      });
      setDetaxCustomerName((current) => current || preview.customerName || "");
      setCreatedDetaxTicket(null);
      setTicketActionMessage(
        alreadyLoaded
          ? `Le ticket ${preview.sourceTicketNumber} est deja charge dans la detaxe.`
          : preview.items.length
            ? `Ticket ${preview.sourceTicketNumber} ajoute. ${preview.items.length} article(s) detaxable(s) charge(s).`
            : `Ticket ${preview.sourceTicketNumber} trouve, mais aucun article detaxable n'est disponible.`
      );
    } catch (error) {
      setTicketActionMessage(error instanceof Error ? error.message : "Ticket introuvable ou lecture detaxe impossible.");
    } finally {
      setDetaxLookupLoading(false);
    }
  }

  function removeDetaxDraftItem(itemId: string) {
    setDetaxDraftItems((current) => current.filter((item) => item.id !== itemId));
  }

  function removeDetaxSourceTicket(sourceTicketId: string) {
    const nextDraftItems = detaxDraftItems.filter((item) => item.sourceTicketId !== sourceTicketId);
    setDetaxDraftItems(nextDraftItems);
    setDetaxPreview((current) => {
      if (!current) return current;
      const nextSourceTickets = current.sourceTickets.filter((ticket) => ticket.sourceTicketId !== sourceTicketId);
      if (!nextSourceTickets.length) return null;
      const nextItems = current.items.filter((item) => item.sourceTicketId !== sourceTicketId);
      const nextSubtotal = Number(nextItems.reduce((sum, item) => sum + item.lineTotal / (1 + item.taxRate / 100), 0).toFixed(2));
      const nextTotal = Number(nextItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
      return {
        ...current,
        sourceTicketId: nextSourceTickets[0].sourceTicketId,
        sourceTicketNumber: nextSourceTickets[0].sourceTicketNumber,
        sourceTicketDate: nextSourceTickets[0].sourceTicketDate,
        sourceTickets: nextSourceTickets,
        sellerName: nextSourceTickets.length === 1 ? (nextSourceTickets[0].sellerName ?? null) : null,
        subtotal: nextSubtotal,
        taxAmount: Number((nextTotal - nextSubtotal).toFixed(2)),
        totalAmount: nextTotal,
        items: nextItems,
        skippedItems: current.skippedItems.filter((item) => item.sourceTicketId !== sourceTicketId),
        payments: current.payments
      };
    });
    setTicketActionMessage("Ticket retire de la detaxe en cours.");
  }

  async function saveDetaxTicket() {
    if (!detaxPreview) {
      setTicketActionMessage("Charge d'abord un ticket de caisse.");
      return;
    }
    if (!detaxDraftItems.length) {
      setTicketActionMessage("Aucun article detaxable n'est selectionne.");
      return;
    }
    const detaxTotalAmount = detaxDraftItems.reduce((sum, item) => sum + item.lineTotal, 0);
    if (detaxTotalAmount <= 2000) {
      setTicketActionMessage("Le montant du ticket detaxe doit depasser 2000 MAD pour valider la detaxe.");
      return;
    }
    setDetaxSaving(true);
    try {
      const created = await api<PosDetaxTicketRecord>("/pos/detax-tickets", {
        method: "POST",
        body: JSON.stringify({
          customerName: detaxCustomerName.trim() || null,
          sourceTickets: detaxPreview.sourceTickets.map((sourceTicket) => ({
            sourceTicketId: sourceTicket.sourceTicketId,
            itemIds: detaxDraftItems
              .filter((item) => item.sourceTicketId === sourceTicket.sourceTicketId)
              .map((item) => item.saleItemId)
          })).filter((sourceTicket) => sourceTicket.itemIds.length > 0)
        })
      });
      setCreatedDetaxTicket(created);
      setDetaxTickets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedDetaxTicketId(created.id);
      setTickets((current) => current.map((ticket) => (
        created.sourceTickets.some((sourceTicket) => sourceTicket.sourceTicketId === ticket.id) ? { ...ticket, isDetaxed: true } : ticket
      )));
      setTicketActionMessage(`Ticket detaxe ${created.number} cree.`);
      await loadDetaxTickets({
        query: detaxQuery,
        dateFrom: detaxDateFrom,
        dateTo: detaxDateTo
      });
    } finally {
      setDetaxSaving(false);
    }
  }

  function openProductDetailFromDetax(productId: string) {
    if (!canOpenProductDetailsFromPos) {
      setTicketActionMessage("Ouvre la fiche article depuis une session manager ou admin.");
      return;
    }
    setDetaxCreateModalOpen(false);
    setDetaxModalOpen(false);
    navigate(`/gestion/produits/${productId}`);
  }

  async function openCashierSessionMenu(preferredStep: "actions" | "close" | "open" | "password" = "actions") {
    setCashierSessionMenuOpen(true);
    setCashierSessionMessage(null);
    setCashierSessionStep("actions");
    setCashierPasswordDraft({ currentCode: "", nextCode: "", confirmCode: "" });
    setCashierPasswordTarget("currentCode");
    if (!canManageCash) {
      setCurrentCashSession(null);
      setCashClosingMad("0");
      setCashClosingEur("0");
      return;
    }
    setCashierSessionLoading(true);
    try {
      let session: CurrentCashSession = null;
      try {
        session = await api<CurrentCashSession>(`/pos/sessions/current${user?.defaultWarehouse?.id ? `?warehouseId=${encodeURIComponent(user.defaultWarehouse.id)}` : ""}`);
        syncCurrentCashSession(session);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        const cachedSession = readCachedOpenCashSession({
          warehouseId: user?.defaultWarehouse?.id || undefined,
          date: todayIso
        });
        session = cachedSession ? buildSessionFromCachedOpenSession(cachedSession) : null;
        syncCurrentCashSession(session);
        setCashierSessionMessage("Mode hors ligne: session caisse lue depuis cet ordinateur.");
      }
      if (!session) {
        await loadCashSessionSetup();
      }
      if (preferredStep === "close" && session) {
        setCashierSessionStep("close");
      } else if (preferredStep === "open" && !session) {
        setCashierSessionReminder(null);
        setOpeningCashMad("0");
        setOpeningCashEur("0");
        setOpeningCashUsd("0");
        setOpeningCurrencyTarget("MAD");
        setCashierSessionStep("open");
      }
    } finally {
      setCashierSessionLoading(false);
    }
  }

  async function handleCashierSessionReminder() {
    if (!cashierSessionReminder) return;
    await openCashierSessionMenu(cashierSessionReminder.type === "close-previous" ? "close" : "open");
  }

  async function loadCashSessionSetup() {
    try {
      const bootstrap = await api<{ registers: CashRegisterOption[]; currencies: CurrencyOption[]; company?: PosCompanyInfo }>("/pos/bootstrap");
      const filteredRegisters = (bootstrap.registers ?? []).filter((register) => !user?.defaultWarehouse?.id || register.warehouseId === user.defaultWarehouse.id);
      setCashSessionRegisters(filteredRegisters);
      setCashSessionCurrencies((bootstrap.currencies ?? []).filter((currency) => currency.isActive !== false));
      setPosCompany(bootstrap.company ?? null);
      setCashOpeningRegisterId((current) => current || filteredRegisters[0]?.id || "");
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      const cached = getCachedCashSessionSetup();
      setCashSessionRegisters(cached.registers);
      setCashSessionCurrencies(cached.currencies.length ? cached.currencies : [
        { id: "MAD", code: "MAD", rateFromMad: 1, isActive: true },
        { id: "EUR", code: "EUR", rateFromMad: 0.09206, isActive: true },
        { id: "USD", code: "USD", rateFromMad: 0.1, isActive: true }
      ]);
      setPosCompany(cached.company);
      setCashOpeningRegisterId((current) => current || cached.registers[0]?.id || "");
      setCashierSessionMessage(cached.registers.length
        ? "Mode hors ligne: caisses chargees depuis cet ordinateur."
        : "Mode hors ligne: ouvre une fois le POS avec internet pour memoriser les caisses.");
    }
  }

  function getOpeningBreakdownAmount(currencyCode: "MAD" | "EUR") {
    return currentCashSession?.openingBreakdown.find((entry) => entry.currencyCode === currencyCode) ?? null;
  }

  function resolveRateFromMad(currencyCode: "MAD" | "EUR" | "USD", rateFromMad?: number | null) {
    const configuredRate = Number(rateFromMad ?? 0);
    if (configuredRate > 0) return configuredRate;
    if (currencyCode === "EUR") return 0.09206;
    if (currencyCode === "USD") return 0.1;
    return 1;
  }

  function convertForeignToMad(amount: number, rateFromMad?: number | null) {
    if (!rateFromMad || rateFromMad <= 0) return 0;
    return amount / rateFromMad;
  }

  function sanitizeCashClosingValue(rawValue: string) {
    const normalized = rawValue.replace(",", ".").replace(/[^\d.]/g, "");
    if (!normalized) return "";
    const [integerPart = "0", ...decimalParts] = normalized.split(".");
    const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
    if (!decimalParts.length) return integer;
    return `${integer}.${decimalParts.join("")}`;
  }

  function updateCashClosingValue(target: "MAD" | "EUR", rawValue: string) {
    const nextValue = sanitizeCashClosingValue(rawValue);
    if (target === "MAD") {
      setCashClosingMad(nextValue);
      return;
    }
    setCashClosingEur(nextValue);
  }

  function appendCashClosingKey(value: string) {
    const setter = cashClosingTarget === "MAD" ? setCashClosingMad : setCashClosingEur;
    setter((current) => {
      if (value === ".") return current.includes(".") ? current : `${current || "0"}.`;
      if (current === "0" || current === "") return value;
      return `${current}${value}`;
    });
  }

  function deleteCashClosingKey() {
    const setter = cashClosingTarget === "MAD" ? setCashClosingMad : setCashClosingEur;
    setter((current) => current.slice(0, -1) || "0");
  }

  function clearCashClosingKey() {
    const setter = cashClosingTarget === "MAD" ? setCashClosingMad : setCashClosingEur;
    setter("");
  }

  function appendOpeningCurrencyKey(value: string) {
    const setter = openingCurrencyTarget === "MAD"
      ? setOpeningCashMad
      : openingCurrencyTarget === "EUR"
        ? setOpeningCashEur
        : setOpeningCashUsd;
    setter((current) => {
      if (value === ".") return current.includes(".") ? current : `${current || "0"}.`;
      if (current === "0" || current === "") return value;
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

  function updateCashierPasswordField(target: "currentCode" | "nextCode" | "confirmCode", rawValue: string) {
    const nextValue = String(rawValue ?? "").replace(/\D/g, "").slice(0, 12);
    setCashierPasswordDraft((current) => ({ ...current, [target]: nextValue }));
  }

  function appendCashierPasswordKey(value: string) {
    setCashierPasswordDraft((current) => ({
      ...current,
      [cashierPasswordTarget]: `${current[cashierPasswordTarget]}${value}`.replace(/\D/g, "").slice(0, 12)
    }));
  }

  function deleteCashierPasswordKey() {
    setCashierPasswordDraft((current) => ({
      ...current,
      [cashierPasswordTarget]: current[cashierPasswordTarget].slice(0, -1)
    }));
  }

  function clearCashierPasswordKey() {
    setCashierPasswordDraft((current) => ({
      ...current,
      [cashierPasswordTarget]: ""
    }));
  }

  async function changeCashierPasswordCode() {
    const currentCode = cashierPasswordDraft.currentCode.trim();
    const nextCode = cashierPasswordDraft.nextCode.trim();
    const confirmCode = cashierPasswordDraft.confirmCode.trim();

    if (!currentCode || !nextCode || !confirmCode) {
      setCashierSessionMessage("Remplis d'abord les trois champs.");
      return;
    }

    setCashSessionActionLoading("open");
    try {
      await api("/auth/change-cashier-code", {
        method: "POST",
        body: JSON.stringify({
          currentCode,
          nextCode,
          confirmCode
        })
      });
      setCashierPasswordDraft({ currentCode: "", nextCode: "", confirmCode: "" });
      setCashierPasswordTarget("currentCode");
      setCashierSessionStep("actions");
      setCashierSessionMessage("Code confidentiel mis a jour.");
    } catch (error) {
      setCashierSessionMessage(error instanceof Error ? error.message : "Changement du code impossible.");
    } finally {
      setCashSessionActionLoading("");
    }
  }

  async function startNewCashSession() {
    if (!cashOpeningRegisterId) {
      setCashierSessionMessage("Choisis d'abord une caisse.");
      return;
    }

    const eurRate = resolveRateFromMad("EUR", cashSessionCurrencies.find((currency) => currency.code.toUpperCase() === "EUR")?.rateFromMad);
    const usdRate = resolveRateFromMad("USD", cashSessionCurrencies.find((currency) => currency.code.toUpperCase() === "USD")?.rateFromMad);
    const madAmount = Number(openingCashMad || 0);
    const eurAmount = Number(openingCashEur || 0);
    const usdAmount = Number(openingCashUsd || 0);
    const openingAmount = madAmount + convertForeignToMad(eurAmount, eurRate) + convertForeignToMad(usdAmount, usdRate);

    if (openingAmount <= 0) {
      setCashierSessionMessage("Le fond d'ouverture doit etre superieur a 0.");
      return;
    }

    const openingBreakdown = [
      { currencyCode: "MAD", amount: madAmount, amountMad: madAmount, rateFromMad: 1 },
      { currencyCode: "EUR", amount: eurAmount, amountMad: Number(convertForeignToMad(eurAmount, eurRate).toFixed(2)), rateFromMad: Number(eurRate ?? 0) },
      { currencyCode: "USD", amount: usdAmount, amountMad: Number(convertForeignToMad(usdAmount, usdRate).toFixed(2)), rateFromMad: Number(usdRate ?? 0) }
    ].filter((entry) => entry.amount > 0);

    setCashSessionActionLoading("open");
    try {
      await api("/pos/sessions/open", {
        method: "POST",
        body: JSON.stringify({
          registerId: cashOpeningRegisterId,
          openingAmount: Number(openingAmount.toFixed(2)),
          openingBreakdown
        })
      });
      await refreshCashierSessionState();
      setCashierSessionReminder(null);
      setCashierSessionMessage(null);
      setCashierSessionStep("actions");
      setCashierSessionMenuOpen(false);
    } catch (error) {
      if (isNetworkError(error)) {
        const register = cashSessionRegisters.find((item) => item.id === cashOpeningRegisterId);
        if (!register) {
          setCashierSessionMessage("Mode hors ligne: caisse introuvable dans le cache de cet ordinateur.");
          return;
        }
        const openedAt = new Date().toISOString();
        const localSession: CurrentCashSession = {
          id: `offline-cash-${cashOpeningRegisterId}-${Date.now()}`,
          openingAmount: Number(openingAmount.toFixed(2)),
          status: "OPEN",
          openedAt,
          openingBreakdown,
          register: {
            id: register.id,
            name: register.name,
            warehouseId: register.warehouseId,
            warehouseName: user?.defaultWarehouse?.name || "Boutique"
          }
        };
        syncCurrentCashSession(localSession);
        setCashierSessionReminder(null);
        setCashierSessionMessage(null);
        setCashierSessionStep("actions");
        setCashierSessionMenuOpen(false);
        return;
      }
      setCashierSessionMessage(error instanceof Error ? error.message : "Ouverture de caisse impossible.");
    } finally {
      setCashSessionActionLoading("");
    }
  }

  async function closeCashierSessionAndLogout() {
    if (!currentCashSession) return;
    setCashSessionActionLoading("close");
    try {
      const eurRate = getOpeningBreakdownAmount("EUR")?.rateFromMad ?? 0;
      const closingAmountMad = Number(cashClosingMad || 0) + (eurRate > 0 ? Number(cashClosingEur || 0) / eurRate : 0);
      await api(`/pos/sessions/${currentCashSession.id}/close`, {
        method: "POST",
        body: JSON.stringify({
          closingAmount: Number(closingAmountMad.toFixed(2)),
          closingBreakdown: [
            { currencyCode: "MAD", amount: Number(cashClosingMad || 0), amountMad: Number(cashClosingMad || 0), rateFromMad: 1 },
            { currencyCode: "EUR", amount: Number(cashClosingEur || 0), amountMad: Number((eurRate > 0 ? Number(cashClosingEur || 0) / eurRate : 0).toFixed(2)), rateFromMad: eurRate }
          ].filter((entry) => entry.amount > 0)
        })
      });
      await logout();
    } catch (error) {
      setCashierSessionMessage(error instanceof Error ? error.message : "Fermeture de session impossible.");
    } finally {
      setCashSessionActionLoading("");
    }
  }

  async function loadInventoryNotifications() {
    if (!canSeeInventoryNotifications) {
      setInventoryNotifications([]);
      return;
    }

    try {
      const data = await api<InventoryTransferNotification[]>("/inventory/notifications");
      setInventoryNotifications(data);
    } catch {
      setInventoryNotifications([]);
    }
  }

  async function respondInventoryNotification(notificationId: string, decision: "ACCEPTED" | "REJECTED") {
    setInventoryNotificationActionId(`${notificationId}:${decision}`);
    try {
      await api(`/inventory/notifications/${notificationId}/respond`, {
        method: "POST",
        body: JSON.stringify({ decision })
      });
      const respondedAt = new Date().toISOString();
      setInventoryNotifications((current) => current.filter((notification) => notification.id !== notificationId));
      setInventoryHistory((current) => current.map((notification) => notification.id === notificationId ? {
        ...notification,
        status: decision,
        isRead: true,
        respondedAt,
        respondedByName: user?.fullName ?? null
      } : notification));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Validation de reception impossible.");
    } finally {
      setInventoryNotificationActionId(null);
    }
  }

  async function openInventoryHistory() {
    setInventoryHistoryOpen(true);
    setInventoryHistoryLoading(true);
    try {
      const data = await api<InventoryTransferNotificationHistory[]>("/inventory/notifications/history");
      setInventoryHistory(data);
    } catch {
      setInventoryHistory([]);
    } finally {
      setInventoryHistoryLoading(false);
    }
  }

  function openTicketsModal() {
    setTicketsQuery("");
    setTicketsDateFrom(todayIso);
    setTicketsDateTo(todayIso);
    setSelectedTicketId(null);
    setTicketActionMessage(null);
    setTicketsModalOpen(true);
    void loadCashSessionSetup();
    void loadTickets({ query: "", dateFrom: todayIso, dateTo: todayIso });
  }

  useEffect(() => {
    if (!canSeeInventoryNotifications) {
      setInventoryNotifications([]);
      return;
    }

    void loadInventoryNotifications();
    const timer = window.setInterval(() => {
      void loadInventoryNotifications();
    }, 30000);

    return () => window.clearInterval(timer);
  }, [canSeeInventoryNotifications, user?.defaultWarehouse?.id]);

  useEffect(() => {
    if (!isPosRoute || !canManageCash) {
      setCashierSessionReminder(null);
      return;
    }

    void refreshCashierSessionState({ includeSetup: true });
  }, [canManageCash, isPosRoute, todayIso, user?.defaultWarehouse?.id]);

  useEffect(() => {
    if (!ticketManagerApprovalOpen || ticketManagerApprovalLoading) return;
    const normalizedCode = ticketManagerApprovalCode.trim();
    if (!/^mgr[-:]/i.test(normalizedCode)) return;

    const timeout = window.setTimeout(() => {
      void confirmTicketManagerApproval();
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [ticketManagerApprovalCode, ticketManagerApprovalLoading, ticketManagerApprovalOpen]);

  function toggleTicketSelection(ticketId: string) {
    setSelectedTicketId((current) => (current === ticketId ? null : ticketId));
    setTicketActionMessage(null);
  }

  function requestTicketManagerApproval(action: "edit" | "delete") {
    if (!selectedTicket) return;
    setTicketManagerApprovalAction(action);
    setTicketManagerApprovalCode("");
    setTicketManagerApprovalLoading(false);
    setTicketManagerApprovalOpen(true);
    setTicketActionMessage(null);
  }

  function closeTicketManagerApproval() {
    setTicketManagerApprovalOpen(false);
    setTicketManagerApprovalAction(null);
    setTicketManagerApprovalCode("");
    setTicketManagerApprovalLoading(false);
  }

  async function openEditTicketModal() {
    if (!selectedTicket) return;
    setEditTicketLoading(true);
    setEditTicketModalOpen(true);
    setTicketActionMessage(null);
    try {
      const detail = await api<PosTicketDetail>(`/pos/tickets/${selectedTicket.id}`);
      setEditTicketDraft({
        ...detail,
        items: detail.items.map((item) => ({
          ...item,
          productName: item.kind === "ORDER_DEPOSIT" ? formatCleanOrderDepositLabel(item) : sanitizeUiText(item.productName)
        })),
          payments: detail.payments.map((payment) => ({
            ...payment,
            method: normalizeEditPaymentMethod(payment.method)
          }))
      });
    } catch (error) {
      setEditTicketModalOpen(false);
      setEditTicketDraft(null);
      setTicketActionMessage(error instanceof Error ? error.message : "Chargement ticket impossible.");
    } finally {
      setEditTicketLoading(false);
    }
  }

  async function deleteSelectedTicket() {
    if (!selectedTicket) return;
    setTicketActionLoading("delete");
    setTicketActionMessage(null);
    try {
      await api<boolean>(`/pos/tickets/${selectedTicket.id}`, { method: "DELETE" });
      setTickets((current) => current.filter((ticket) => ticket.id !== selectedTicket.id));
      setSelectedTicketId(null);
      setTicketActionMessage(`Ticket ${selectedTicket.number} supprime.`);
    } catch (error) {
      setTicketActionMessage(error instanceof Error ? error.message : "Suppression ticket impossible.");
    } finally {
      setTicketActionLoading("");
    }
  }

  async function confirmTicketManagerApproval() {
    if (!selectedTicket || !ticketManagerApprovalAction) return;
    setTicketManagerApprovalLoading(true);
    try {
      const manager = await api<ManagerAuthorizationResult>("/pos/manager-authorization", {
        method: "POST",
        body: JSON.stringify({
          code: ticketManagerApprovalCode,
          warehouseId: user?.defaultWarehouse?.id || null
        })
      });

      closeTicketManagerApproval();

      if (ticketManagerApprovalAction === "edit") {
        await openEditTicketModal();
        setTicketActionMessage(`Modification ticket autorisee par ${manager.fullName}.`);
      } else {
        await deleteSelectedTicket();
        setTicketActionMessage(`Suppression ticket autorisee par ${manager.fullName}.`);
      }
    } catch (error) {
      setTicketActionMessage(error instanceof Error ? error.message : "Autorisation manager impossible.");
      setTicketManagerApprovalLoading(false);
    }
  }

  function closeEditTicketModal() {
    setEditTicketModalOpen(false);
    setEditTicketDraft(null);
    setEditCatalogModalOpen(false);
    setEditOrderModalOpen(false);
    setEditPaymentModalOpen(false);
  }

  async function loadEditCatalog(query = "") {
    setEditCatalogLoading(true);
    try {
      const rows = await api<PosCatalogRow[]>(`/pos/catalog${query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ""}`);
      setEditCatalogRows(rows.filter((row) => !row.variantId));
    } catch (error) {
      setTicketActionMessage(error instanceof Error ? error.message : "Chargement catalogue impossible.");
    } finally {
      setEditCatalogLoading(false);
    }
  }

  function openEditCatalogModal() {
    setEditCatalogQuery("");
    setEditCatalogRows([]);
    setEditOrderModalOpen(false);
    setEditPaymentModalOpen(false);
    setEditCatalogModalOpen(true);
    void loadEditCatalog("");
  }

  function addCatalogRowToEditTicket(row: PosCatalogRow) {
    setEditTicketDraft((current) => {
      if (!current) return current;
      const nextId = getSafeDraftId("item");
      const nextItem: PosTicketItemDetail = {
        id: nextId,
        productId: row.productId,
        productName: row.name,
        reference: row.reference,
        quantity: 1,
        unitPriceTtc: Number(row.salePriceTtc),
        discountAmount: 0,
        taxRate: 20,
        lineTotal: Number(row.salePriceTtc)
      };
      return { ...current, items: [...current.items, nextItem] };
    });
    setEditCatalogModalOpen(false);
    setTicketActionMessage(null);
  }

  function openEditOrderModal() {
    setEditOrderForm({ type: "Sac", number: "", totalAmount: "0", depositAmount: "0" });
    setEditCatalogModalOpen(false);
    setEditPaymentModalOpen(false);
    setEditOrderModalOpen(true);
  }

  function addOrderLineToEditTicket() {
    const orderNumber = editOrderForm.number.trim();
    const orderTotal = Number(editOrderForm.totalAmount || 0);
    const depositAmount = Number(editOrderForm.depositAmount || 0);

    if (!orderNumber || depositAmount <= 0) {
      setTicketActionMessage("Numero de commande et montant acompte obligatoires.");
      return;
    }

    setEditTicketDraft((current) => {
      if (!current) return current;
      const nextItem: PosTicketItemDetail = {
        id: getSafeDraftId("order"),
        productId: getSafeDraftId("order-product"),
        productName: `Acompte commande NÃƒâ€šÃ‚Â° ${orderNumber} - ${editOrderForm.type}`,
        reference: "POS-ORDER-DEPOSIT",
        quantity: 1,
        unitPriceTtc: depositAmount,
        discountAmount: 0,
        taxRate: 0,
        lineTotal: depositAmount,
        kind: "ORDER_DEPOSIT",
        orderType: editOrderForm.type,
        orderNumber,
        orderTotal,
        depositAmount
      };
      return { ...current, items: [...current.items, nextItem] };
    });

    setEditOrderModalOpen(false);
    setTicketActionMessage(null);
  }

  function removeEditItem(itemId: string | undefined) {
    if (!itemId) return;
    setEditTicketDraft((current) => {
      if (!current) return current;
      return { ...current, items: current.items.filter((item) => item.id !== itemId) };
    });
  }

  function removeEditPayment(paymentId: string | undefined) {
    if (!paymentId) return;
    setEditTicketDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        payments: current.payments.filter((payment) => payment.id !== paymentId)
      };
    });
  }

  function openEditPaymentModal(payment?: PosTicketPaymentDetail) {
    const defaultAmount = payment?.amount ?? Math.max(0.01, Number((editTicketBalanceGap > 0 ? editTicketBalanceGap : 0.01).toFixed(2)));
    setEditPaymentDraft({
      paymentId: payment?.id ?? "",
      method: normalizeEditPaymentMethod(payment?.method ?? "CASH"),
      amount: String(defaultAmount)
    });
    setEditPaymentModalOpen(true);
  }

  function applyEditPaymentModal() {
    const amount = Math.max(0.01, Number(editPaymentDraft.amount || 0));
    const method = normalizeEditPaymentMethod(editPaymentDraft.method);
    setEditTicketDraft((current) => {
      if (!current) return current;
      if (editPaymentDraft.paymentId) {
        return {
          ...current,
          payments: current.payments.map((payment) =>
            payment.id === editPaymentDraft.paymentId
              ? { ...payment, method, amount, reference: null }
              : payment
          )
        };
      }

      const nextPayment: PosTicketPaymentDetail = {
        id: getSafeDraftId("payment"),
        method,
        amount,
        reference: null,
        createdAt: new Date().toISOString()
      };
      return { ...current, payments: [...current.payments, nextPayment] };
    });

    setEditPaymentModalOpen(false);
    setEditPaymentDraft({ paymentId: "", method: "CASH", amount: "0" });
  }

  async function saveEditedTicket() {
    if (!editTicketDraft || !selectedTicket) return;
    if (!editTicketDraft.items.length) {
      setTicketActionMessage("Le ticket doit contenir au moins un article.");
      return;
    }
    if (!editTicketDraft.payments.length) {
      setTicketActionMessage("Le ticket doit contenir au moins un paiement.");
      return;
    }

    setEditTicketSaving(true);
    setTicketActionMessage(null);
    try {
      const updated = await api<PosTicketDetail>(`/pos/tickets/${selectedTicket.id}`, {
        method: "PUT",
        body: JSON.stringify({
          sellerName: editTicketDraft.sellerName ?? null,
          items: editTicketDraft.items.map((item) => ({
            id: item.id && !isDraftId(item.id) ? item.id : undefined,
            productId: item.productId,
            quantity: Number(item.quantity),
            unitPriceTtc: Number(item.unitPriceTtc),
            kind: item.kind ?? "PRODUCT",
            orderType: item.orderType ?? undefined,
            orderNumber: item.orderNumber ?? undefined,
            orderTotal: item.orderTotal ?? undefined,
            depositAmount: item.depositAmount ?? undefined
          })),
          payments: editTicketDraft.payments.map((payment) => ({
            id: payment.id && !isDraftId(payment.id) ? payment.id : undefined,
            method: normalizeEditPaymentMethod(payment.method),
            amount: Number(payment.amount),
            reference: payment.reference ?? null
          }))
        })
      });

      const updatedTicketRow: PosTicket = {
        id: updated.id,
        number: updated.number,
        createdAt: updated.createdAt,
        sellerName: updated.sellerName,
        status: updated.status,
        totalAmount: updated.totalAmount,
        paidAmount: updated.paidAmount,
        remainingAmount: updated.remainingAmount,
        isInvoiced: updated.isInvoiced,
        isDetaxed: updated.isDetaxed,
        customer: updated.customer,
        warehouse: updated.warehouse,
        items: updated.items.map((item) => ({
          id: item.id || getSafeDraftId("saved-item"),
          quantity: item.quantity,
          productName: item.productName,
          lineTotal: item.lineTotal
        })),
          payments: updated.payments.map((payment) => ({
            id: payment.id || getSafeDraftId("saved-payment"),
            method: payment.method,
            displayMethod: payment.displayMethod,
            amount: payment.amount,
            reference: payment.reference,
            createdAt: payment.createdAt || new Date().toISOString()
          }))
      };

      setTickets((current) => current.map((ticket) => (ticket.id === updated.id ? updatedTicketRow : ticket)));
      setEditTicketDraft(updated);
      setTicketActionMessage("Ticket modifie avec succes.");
      closeEditTicketModal();
    } catch (error) {
      setTicketActionMessage(error instanceof Error ? error.message : "Modification ticket impossible.");
    } finally {
      setEditTicketSaving(false);
    }
  }

  async function updateTicketMarker(action: "facture" | "detaxe", enabled: boolean) {
    if (!selectedTicket) return;
    setTicketActionLoading(action);
    setTicketActionMessage(null);
    try {
      const updated = await api<PosTicket>(`/pos/tickets/${selectedTicket.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ enabled })
      });
      setTickets((current) => current.map((ticket) => (ticket.id === updated.id ? updated : ticket)));
      setTicketActionMessage(
        action === "facture"
          ? enabled
            ? "Ticket marque comme facture."
            : "Marquage facture retire."
          : enabled
            ? "Ticket marque comme detaxe."
            : "Marquage detaxe retire."
      );
    } catch (error) {
      setTicketActionMessage(error instanceof Error ? error.message : "Action ticket impossible.");
    } finally {
      setTicketActionLoading("");
    }
  }

  async function printSelectedTicket() {
    if (!selectedTicket) return;

    setTicketActionLoading("print");
    setTicketActionMessage(null);

    try {
      const payload = await api<PosTicketReprintPayload>(`/pos/tickets/${selectedTicket.id}/reprint`, {
        method: "POST"
      });
      const ticket = payload.ticket;
      const popup = window.open("", "_blank", "width=360,height=900");
      const companyInfo = posCompany ?? (await api<{ company?: PosCompanyInfo }>("/pos/bootstrap")).company ?? null;
      if (!popup) {
        setTicketActionLoading("");
        setTicketActionMessage("Impossible d'ouvrir la fenetre d'impression.");
        return;
      }

      const barcodeSvg = buildCode39Svg(ticket.number);
      const getOrderReceiptParts = (item: PosTicketItemDetail) => {
        const rawName = String(item.productName || "").trim();
        let orderType = String(item.orderType || "").trim();
        let orderNumber = String(item.orderNumber || "").trim();
        const commandMatch = rawName.match(/Commande\s*:\s*([^-]+)\s*-\s*(.+)$/i);
        if (commandMatch) {
          orderNumber ||= commandMatch[1].trim();
          orderType ||= commandMatch[2].trim();
        }
        const depositMatch = rawName.match(/Acompte commande\s*N[Ãƒâ€šÃ‚Â°Ãƒâ€šÃ‚ÂºÃƒÆ’Ã¢â‚¬Å¡]*\s*([^-]+)\s*-\s*(.+)$/i);
        if (depositMatch) {
          orderNumber ||= depositMatch[1].trim();
          orderType ||= depositMatch[2].trim();
        }
        return {
          orderType: orderType || rawName,
          orderNumber
        };
      };
      const itemsHtml = ticket.items.length
        ? ticket.items.map((item) => {
            const orderParts = getOrderReceiptParts(item);
            const orderTotal = Number(item.orderTotal || 0);
            const depositAmount = Number(item.depositAmount || item.lineTotal || 0);
            const remainingAmount = Math.max(0, orderTotal - depositAmount);
            const isFullyPaidOrder = item.kind === "ORDER_DEPOSIT" && orderTotal > 0 && remainingAmount <= 0.009;
            return `
              <tr>
                <td style="padding-right:8px;">
                  ${item.kind === "ORDER_DEPOSIT"
                    ? `
                      ${isFullyPaidOrder
                        ? `<div style="font-size:10px;font-weight:600;line-height:1.15;">${sanitizeUiText(orderParts.orderType)} Cmd NÃ‚Â° : ${sanitizeUiText(orderParts.orderNumber || "-")}</div>`
                        : `
                          <div style="font-size:10px;font-weight:600;line-height:1.15;">Acompte commande NÃ‚Â° ${sanitizeUiText(orderParts.orderNumber || "-")}</div>
                          <div style="font-size:8px;color:#6c5c4f;margin-top:2px;line-height:1.1;">( Reste a payer : ${formatMad(remainingAmount)} )</div>
                        `}
                    `
                    : `
                      <div style="font-size:10px;font-weight:600;line-height:1.15;">${sanitizeUiText(item.productName)}</div>
                      ${item.reference ? `<div style="font-size:8px;color:#6c5c4f;margin-top:2px;line-height:1.1;">${sanitizeUiText(item.reference)}</div>` : ""}
                    `}
                  ${item.discountAmount > 0 ? `<div style="font-size:9px;color:#a05a36;margin-top:2px;line-height:1.15;">Remise ${formatMad(item.discountAmount)}</div>` : ""}
                </td>
                <td style="text-align:center;white-space:nowrap;font-size:10px;">${item.quantity}</td>
                <td style="text-align:right;white-space:nowrap;font-size:10px;">${formatMad(item.lineTotal)}</td>
              </tr>
            `;
          }).join("")
        : `<tr><td colspan="3" style="text-align:center;color:#6b5a4a;">Aucun article</td></tr>`;

      const paymentsSummary = ticket.payments.length
        ? ticket.payments
          .map((payment) => formatReceiptPaymentLabel(payment, { fallbackCash: ticket.payments.length === 1 && payment.method === "MIXED" && !payment.reference }))
          .join(" - ")
        : "AUCUN PAIEMENT";

      popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>${ticket.number}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, Helvetica, sans-serif;
              background: #fff;
              color: #111;
              width: 72mm;
              font-size: 11px;
              line-height: 1.28;
              font-weight: 500;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              text-rendering: geometricPrecision;
            }
            .ticket { width: 100%; }
            .center { text-align: center; }
            .title { font-size: 16px; font-weight: 800; margin: 2px 0; }
            .muted { color: #111; font-size: 10.5px; }
            .section { margin-top: 8px; padding-top: 8px; border-top: 1.4px dashed #111; }
            table { width: 100%; border-collapse: collapse; }
            th { text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.06em; color: #111; padding-bottom: 4px; text-align:left; font-weight: 800; }
            td { vertical-align: top; padding: 4px 0; }
            .totals td { padding: 2px 0; }
            .strong { font-weight: 800; }
            .grand-total { font-size: 15px; font-weight: 800; }
            svg { shape-rendering: crispEdges; }
            .duplicate-badge {
              display: inline-block;
              margin-top: 6px;
              padding: 3px 9px;
              border: 1px solid #111;
              border-radius: 999px;
              font-size: 9px;
              font-weight: 700;
              letter-spacing: 0.12em;
              text-transform: uppercase;
            }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="center">
              ${companyInfo?.logoUrl ? `<div style="margin-bottom:6px;"><img src="${companyInfo.logoUrl}" alt="Logo" style="max-width:52mm;max-height:18mm;object-fit:contain;" /></div>` : ""}
              <div class="title">${sanitizeUiText(companyInfo?.name || "Galerie des Tanneurs")}</div>
              <div class="strong">${sanitizeUiText(ticket.warehouse.name)}</div>
              <div class="muted">${formatTicketDate(ticket.createdAt)}</div>
              <div class="duplicate-badge">Duplicata - #${payload.reprintCount}</div>
            </div>

            <div class="section">
              <div class="center strong" style="font-size:16px;margin-bottom:8px;">Ticket N&deg; : ${ticket.number}</div>
              <div><span class="strong">Client :</span> ${sanitizeUiText(ticket.customer?.fullName || "Client comptoir")}</div>
              <div><span class="strong">Vendeur :</span> ${sanitizeUiText(ticket.sellerName || "Non renseigne")}</div>
            </div>

            <div class="section">
              <table>
                <thead>
                  <tr>
                    <th>Article</th>
                    <th style="text-align:center;">Qte</th>
                    <th style="text-align:right;">Montant</th>
                  </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
              </table>
            </div>

            <div class="section">
              <table class="totals">
                <tbody>
                  <tr><td class="grand-total">Total</td><td class="grand-total" style="text-align:right;">${formatMad(ticket.totalAmount)}</td></tr>
                </tbody>
              </table>
            </div>

            <div class="section">
              <div class="strong" style="margin-bottom:4px;">Paiements</div>
              <div style="font-size:9px;letter-spacing:0.03em;text-transform:uppercase;line-height:1.2;">${paymentsSummary}</div>
            </div>

            <div class="section center">
              <div style="text-align:left;font-size:9px;margin-bottom:8px;">${renderReceiptTextLines(companyInfo?.cgvTerms?.trim() || "") || renderReceiptTextLines("Aucune condition generale de vente configuree.")}</div>
              <div style="border-top:1.4px dashed #111;margin:8px 0 6px;"></div>
              <div style="margin-bottom:8px;">${renderReceiptTextLines(companyInfo?.ticketFooter?.trim() || "")}</div>
              <div style="margin-bottom:4px;">${barcodeSvg}</div>
            </div>

            <div class="section center">
              <div class="muted" style="margin-bottom:4px;">Merci pour votre visite</div>
              ${companyInfo?.address ? `<div class="muted">${sanitizeUiText(companyInfo.address)}</div>` : ""}
              ${companyInfo?.phone ? `<div class="muted">${sanitizeUiText(companyInfo.phone)}</div>` : ""}
              ${companyInfo?.email ? `<div class="muted">${sanitizeUiText(companyInfo.email)}</div>` : ""}
              ${companyInfo?.website ? `<div class="muted">${sanitizeUiText(companyInfo.website)}</div>` : ""}
            </div>
          </div>
          <script>
            window.onload = function () {
              document.body.innerHTML = document.body.innerHTML
                .replace(/N[^0-9A-Za-z<]{1,18} :/g, "N&deg; :")
                .replace(/N[^0-9A-Za-z<]{1,18} ([0-9])/g, "N&deg; $1");
              window.print();
              setTimeout(function () { window.close(); }, 250);
            };
          </script>
        </body>
      </html>
      `);

      popup.document.close();
      setTicketActionMessage(`Impression du ticket ${ticket.number} lancee.`);
    } catch (error) {
      setTicketActionMessage(error instanceof Error ? error.message : "Re-impression du ticket impossible.");
    } finally {
      setTicketActionLoading("");
    }
  }

  function printDetaxTicket(ticket: PosDetaxTicketRecord) {
    const popup = window.open("", "_blank", "width=360,height=920");
    if (!popup) {
      setTicketActionMessage("Impossible d'ouvrir la fenetre d'impression.");
      return;
    }

    const companyInfo = posCompany ?? { name: "Galerie des Tanneurs", logoUrl: "", address: "", phone: "", email: "", website: "", cgvTerms: "", ticketFooter: "" };
    const barcodeSvg = buildCode39Svg(ticket.number);
    const itemsHtml = ticket.items.length
      ? ticket.items.map((item) => `
          <tr>
            <td><div style="font-weight:800;">${sanitizeUiText(item.productName)}</div><div style="font-size:10.5px;color:#111;">${sanitizeUiText(item.reference)}</div></td>
            <td style="text-align:center;">${item.quantity}</td>
            <td style="text-align:right;">${formatMad(item.lineTotal)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="3" style="text-align:center;color:#6b5a4a;">Aucun article detaxable</td></tr>`;
    const sourceTickets = ticket.sourceTickets?.length
      ? ticket.sourceTickets
      : [{
          sourceTicketId: ticket.sourceTicketId,
          sourceTicketNumber: ticket.sourceTicketNumber,
          sourceTicketDate: ticket.sourceTicketDate,
          warehouseId: ticket.warehouseId,
          warehouseName: ticket.warehouseName,
          customerName: ticket.customerName,
          sellerName: ticket.sellerName
        }];
    const sourceTicketsHtml = sourceTickets.map((sourceTicket) => sanitizeUiText(sourceTicket.sourceTicketNumber)).join("<br />");

    popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>${ticket.number}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, Helvetica, sans-serif;
              background: #fff;
              color: #111;
              width: 72mm;
              font-size: 11px;
              line-height: 1.28;
              font-weight: 500;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              text-rendering: geometricPrecision;
            }
            .ticket { width: 100%; }
            .center { text-align: center; }
            .title { font-size: 16px; font-weight: 800; margin: 2px 0; }
            .muted { color: #111; font-size: 10.5px; }
            .section { margin-top: 8px; padding-top: 8px; border-top: 1.4px dashed #111; }
            table { width: 100%; border-collapse: collapse; }
            th { text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.06em; color: #111; padding-bottom: 4px; text-align:left; font-weight: 800; }
            td { vertical-align: top; padding: 4px 0; }
            .banner {
              border: 1px solid #111;
              padding: 4px 8px;
              display: inline-block;
              font-size: 12px;
              font-weight: 800;
              letter-spacing: 0.18em;
              margin-bottom: 6px;
            }
            .strong { font-weight: 800; }
            .grand-total { font-size: 15px; font-weight: 800; }
            svg { shape-rendering: crispEdges; }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="center">
              ${companyInfo?.logoUrl ? `<div style="margin-bottom:6px;"><img src="${companyInfo.logoUrl}" alt="Logo" style="max-width:52mm;max-height:18mm;object-fit:contain;" /></div>` : ""}
              <div class="title">${sanitizeUiText(companyInfo?.name || "Galerie des Tanneurs")}</div>
              <div class="strong">${sanitizeUiText(ticket.warehouseName)}</div>
              <div class="muted">${formatTicketDate(ticket.createdAt)}</div>
            </div>

            <div class="section">
              <div class="center strong" style="font-size:16px;margin-bottom:8px;">Ticket N&deg; : ${sanitizeUiText(ticket.number)}</div>
              <div><span class="strong">Ticket source :</span> ${sourceTicketsHtml}</div>
              <div><span class="strong">Client :</span> ${sanitizeUiText(ticket.customerName || "Client comptoir")}</div>
            </div>

            <div class="section">
              <table>
                <thead>
                  <tr>
                    <th>Article</th>
                    <th style="text-align:center;">Qte</th>
                    <th style="text-align:right;">Montant</th>
                  </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
              </table>
            </div>

            <div class="section">
              <table>
                <tbody>
                  <tr><td>Total HT</td><td style="text-align:right;">${formatMad(ticket.subtotal)}</td></tr>
                  <tr><td>TVA</td><td style="text-align:right;">${formatMad(ticket.taxAmount)}</td></tr>
                  <tr><td class="grand-total">Total TTC</td><td class="grand-total" style="text-align:right;">${formatMad(ticket.totalAmount)}</td></tr>
                </tbody>
              </table>
            </div>

            <div class="section center">
              <div style="text-align:left;font-size:9px;margin-bottom:8px;">${renderReceiptTextLines(companyInfo?.cgvTerms?.trim() || "") || renderReceiptTextLines("Aucune condition generale de vente configuree.")}</div>
              <div style="border-top:1.4px dashed #111;margin:8px 0 6px;"></div>
              <div style="margin-bottom:8px;">${renderReceiptTextLines(companyInfo?.ticketFooter?.trim() || "")}</div>
              <div style="margin-bottom:4px;">${barcodeSvg}</div>
            </div>

            <div class="section center">
              <div class="muted" style="margin-bottom:4px;">Merci pour votre visite</div>
              ${companyInfo?.address ? `<div class="muted">${sanitizeUiText(companyInfo.address)}</div>` : ""}
              ${companyInfo?.phone ? `<div class="muted">${sanitizeUiText(companyInfo.phone)}</div>` : ""}
              ${companyInfo?.email ? `<div class="muted">${sanitizeUiText(companyInfo.email)}</div>` : ""}
              ${companyInfo?.website ? `<div class="muted">${sanitizeUiText(companyInfo.website)}</div>` : ""}
            </div>
          </div>
          <script>
            window.onload = function () {
              document.body.innerHTML = document.body.innerHTML
                .replace(/N[^0-9A-Za-z<]{1,18} :/g, "N&deg; :")
                .replace(/N[^0-9A-Za-z<]{1,18} ([0-9])/g, "N&deg; $1");
              window.print();
              setTimeout(function () { window.close(); }, 250);
            };
          </script>
        </body>
      </html>
    `);

    popup.document.close();
    setTicketActionMessage(`Impression du ticket detaxe ${ticket.number} lancee.`);
  }

  const renderSidebarNavigation = (variant: "desktop" | "mobile") => (
    <nav className="mt-6 flex-1 space-y-3 overflow-y-auto pr-1">
      {navigationItems.filter((item) => canView(item, permissions)).map((item) => (
        item.children ? (
          <div key={item.label} className="space-y-2">
            <div>
              {(() => {
                const activeGroup = hasActiveChild(item, pathname);
                const openGroup = openMenus[item.label];
                return (
                  <button
                    type="button"
                    className={cn(
                      "app-menu-button flex w-full items-center gap-3 rounded-[24px] border px-4 py-2.5 text-left text-sm font-semibold transition",
                      activeGroup || openGroup
                        ? "app-menu-button-active border-orange-300/30 bg-gradient-to-r from-orange-300/25 to-orange-500/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
                        : "app-menu-button-idle border-white/10 bg-black/25 text-[#f3e8dc] hover:bg-white/5"
                    )}
                    onClick={() => setOpenMenus((current) => ({ ...current, [item.label]: !current[item.label] }))}
                  >
                    {item.icon ? <item.icon className="h-4 w-4 text-orange-200" /> : null}
                    <span className="flex-1">{item.label}</span>
                    {openGroup ? <ChevronDown className="h-4 w-4 text-orange-200" /> : <ChevronRight className="h-4 w-4 text-orange-200" />}
                  </button>
                );
              })()}
              {openMenus[item.label] ? (
                <div className="rounded-[22px] border border-white/10 bg-black/20 p-3">
                  <div className="space-y-1.5">
                    {item.children.filter((child) => canView(child, permissions)).map((child) => {
                      const active = pathname === child.to;
                      const Icon = child.icon ?? FileSpreadsheet;
                      return (
                        <NavLink
                          key={child.label}
                          to={child.to!}
                          onClick={() => variant === "mobile" && setMobileMenuOpen(false)}
                          className={cn(
                            "app-submenu-link flex items-center gap-2.5 rounded-2xl px-3 py-1.5 text-[12px] transition",
                            active
                              ? "app-submenu-link-active bg-gradient-to-r from-orange-300/20 to-orange-500/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
                              : "app-submenu-link-idle text-[#c9bbad] hover:bg-white/5 hover:text-white"
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {child.label}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : item.to ? (
          <NavLink
            key={item.label}
            to={item.to}
            onClick={() => variant === "mobile" && setMobileMenuOpen(false)}
            className={({ isActive }) =>
              cn(
                "app-menu-button flex items-center gap-3 rounded-[24px] border px-4 py-2.5 text-sm font-medium transition",
                isActive
                  ? "app-menu-button-active border-orange-300/30 bg-gradient-to-r from-orange-300/25 to-orange-500/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
                  : "app-menu-button-idle border-white/10 bg-black/25 text-[#c9bbad] hover:bg-white/5 hover:text-white"
              )
            }
          >
            {item.icon ? <item.icon className="h-4 w-4 text-orange-200" /> : null}
            {item.label}
          </NavLink>
        ) : null
      ))}
    </nav>
  );

  return (
    <div className="h-screen overflow-hidden bg-transparent">
      {inventoryNotifications.length ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[90] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-3">
          {inventoryNotifications.map((notification) => {
            const acceptActionId = `${notification.id}:ACCEPTED`;
            const rejectActionId = `${notification.id}:REJECTED`;
            const isActionLoading = inventoryNotificationActionId?.startsWith(`${notification.id}:`) ?? false;
            return (
            <div
              key={notification.id}
              className="pointer-events-auto rounded-[24px] border border-orange-300/25 bg-[#1a120d]/96 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-sm"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-orange-200" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-200/85">Transfert entrant</p>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {notification.productName}
                    {notification.variantLabel ? ` - ${notification.variantLabel}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-[#d7c8ba]">
                    {notification.quantity} unite(s) depuis {notification.fromWarehouseName}
                  </p>
                  <p className="mt-1 text-xs text-[#bba999]">{formatTicketDate(notification.createdAt)}</p>
                  <p className="mt-2 text-xs text-[#c9bbad]">Motif : {notification.reason}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="!h-9 !rounded-[16px] !bg-emerald-500 !px-3 !text-xs !font-bold !text-white shadow-[0_12px_28px_rgba(16,185,129,0.22)] hover:!bg-emerald-600"
                  disabled={isActionLoading}
                  onClick={() => void respondInventoryNotification(notification.id, "ACCEPTED")}
                >
                  {inventoryNotificationActionId === acceptActionId ? "Validation..." : "Valider"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-9 !rounded-[16px] !border-rose-300/25 !bg-rose-500/15 !px-3 !text-xs !font-bold !text-rose-100 hover:!border-rose-300/45 hover:!bg-rose-500/25"
                  disabled={isActionLoading}
                  onClick={() => void respondInventoryNotification(notification.id, "REJECTED")}
                >
                  {inventoryNotificationActionId === rejectActionId ? "Refus..." : "Refuser"}
                </Button>
              </div>
            </div>
          );
          })}
        </div>
      ) : null}
      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-[95] lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-black/65 backdrop-blur-[3px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-[min(88vw,360px)] flex-col overflow-hidden border-r border-orange-200/15 bg-[#17110d] p-4 shadow-[24px_0_80px_rgba(0,0,0,0.48)]">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-16 items-center justify-center overflow-hidden rounded-[18px] bg-gradient-to-br from-[#ffb15c] to-[#ff7a00] px-2.5 py-2">
                    <img
                      src="/logo-gdt.jpg"
                      alt="Logo GDT"
                      className="h-full w-full object-contain mix-blend-multiply contrast-125"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-orange-200/80">Galerie des Tanneurs</p>
                    <p className="mt-1 text-sm font-semibold text-white">Menu</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-white/10 p-2 text-[#eadfd4] transition hover:border-orange-300/35 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {renderSidebarNavigation("mobile")}

            <div className="mt-4 rounded-[22px] border border-white/10 bg-black/25 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#ccbcae]">Session</p>
                <p className="text-right text-[12px] font-semibold text-white">{user?.fullName ?? "Operateur"}</p>
              </div>
              <Button className="mt-3 w-full !h-9 !text-[12px]" variant="secondary" onClick={() => void logout()}>
                Deconnexion
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
      <div className={cn("mx-auto flex h-screen gap-6 px-4 py-4 md:px-6 lg:px-8", isPosRoute ? "max-w-none" : "max-w-[1700px]")}>
        {!isPosRoute ? (
          <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[284px] shrink-0 self-start lg:block">
            <div className="card-shell flex h-[calc(100vh-2rem)] flex-col overflow-hidden p-5">
              <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-[78px] items-center justify-center overflow-hidden rounded-[20px] bg-gradient-to-br from-[#ffb15c] to-[#ff7a00] px-3 py-2">
                    <img
                      src="/logo-gdt.jpg"
                      alt="Logo GDT"
                      className="h-full w-full object-contain mix-blend-multiply contrast-125"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Galerie des Tanneurs</p>
                  </div>
                </div>
                <div className="glass-line mt-4 h-px w-full" />
                <p className="mt-4 text-center text-sm text-[#c9bbad]">Gestion de Stock. Version 2026</p>
              </div>

              {renderSidebarNavigation("desktop")}

              <div className="mt-5 rounded-[22px] border border-white/10 bg-black/25 px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#ccbcae]">Session</p>
                  <p className="text-right text-[12px] font-semibold text-white">{user?.fullName ?? "Operateur"}</p>
                </div>
              <div className="mt-3">
                {canSeeInventoryNotifications ? (
                  <Button className="mb-2 flex w-full !h-9 items-center justify-between !px-3 !text-[12px]" variant="secondary" onClick={() => void openInventoryHistory()}>
                    <span>Notifications stock</span>
                    {inventoryNotifications.length ? (
                      <span className="inline-flex min-w-[22px] animate-pulse items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {inventoryNotifications.length}
                      </span>
                    ) : null}
                  </Button>
                ) : null}
                <Button className="w-full !h-9 !text-[12px]" variant="secondary" onClick={() => void logout()}>
                  Deconnexion
                </Button>
              </div>
            </div>
            </div>
          </aside>
        ) : null}

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className={cn("card-shell flex h-[calc(100vh-2rem)] flex-col overflow-hidden p-4 md:p-6 lg:p-7", isPosRoute ? "w-full" : "")}>
            <header className="mb-6 flex flex-col gap-4 rounded-[26px] border border-white/10 bg-black/20 p-4 md:flex-row md:items-center md:justify-between md:p-5">
              <div className="flex items-start justify-between gap-3 lg:block">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">GDT Suite</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">Galerie des Tanneurs</h2>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-2xl border border-orange-200/25 bg-orange-300/15 px-3.5 py-2 text-sm font-semibold text-orange-100 shadow-[0_12px_34px_rgba(0,0,0,0.22)] transition hover:border-orange-200/45 hover:bg-orange-300/25 lg:hidden"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                  Menu
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-[#d5c6b7]">
                {isPosRoute ? (
                  <>
                    <div className="flex min-h-[60px] min-w-[155px] flex-col justify-center rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-200/80">Boutique</p>
                      <p className="mt-0.5 font-semibold text-white">{defaultWarehouseName}</p>
                    </div>
                    <div className="flex min-h-[60px] min-w-[155px] flex-col justify-center rounded-[18px] border border-white/10 bg-white/5 px-4 py-2 text-center">
                      <p className="font-semibold text-white">{currentDateLabel}</p>
                      <p className="text-xs font-semibold text-orange-100">{currentTimeLabel}</p>
                    </div>
                    <button
                      type="button"
                      className="flex min-h-[60px] min-w-[155px] flex-col justify-center rounded-[18px] border border-white/10 bg-white/5 px-4 py-2 text-center transition hover:border-orange-300/30 hover:bg-white/10"
                      onClick={() => void openCashierSessionMenu()}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#cdbfaf]">Caissier</p>
                      <p className="mt-0.5 font-semibold text-white">{user?.fullName ?? "Utilisateur"}</p>
                    </button>
                    <button
                      type="button"
                      className="flex min-h-[60px] min-w-[170px] flex-col justify-center rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-2 text-center transition hover:border-orange-300/40 hover:bg-orange-300/15"
                      onClick={openTicketsModal}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-200/80">Tickets</p>
                      <p className="mt-0.5 font-semibold text-white">Gestion Tickets</p>
                    </button>
                  </>
                ) : (
                  <>
                    {canSeeInventoryNotifications ? (
                      <button
                        type="button"
                        className="relative rounded-full border border-orange-300/20 bg-orange-300/10 px-4 py-2 text-white transition hover:border-orange-300/40 hover:bg-orange-300/15"
                        onClick={() => void openInventoryHistory()}
                      >
                        Notifications stock
                        {inventoryNotifications.length ? (
                          <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[22px] animate-pulse items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {inventoryNotifications.length}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2">{user?.roles.join(" / ")}</div>
                  </>
                )}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <Outlet />
            </div>

            {isPosRoute && cashierSessionReminder && !cashierSessionMenuOpen ? (
              <div className="pointer-events-none fixed right-6 top-24 z-[71] flex max-w-[380px] justify-end">
                <button
                  type="button"
                  className="cashier-reminder-card pointer-events-auto flex w-full items-start gap-3 rounded-[22px] border border-orange-300/25 bg-[#1b130e]/95 px-4 py-3 text-left shadow-[0_22px_48px_rgba(0,0,0,0.35)] backdrop-blur"
                  onClick={() => void handleCashierSessionReminder()}
                >
                  <span className="cashier-reminder-dot mt-1 inline-flex h-3 w-3 shrink-0 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(74,222,128,0.18)]" />
                  <span className="min-w-0 flex-1">
                    <span className="cashier-reminder-kicker flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-200/80">
                      <Bell className="h-3.5 w-3.5" />
                      Notification caisse
                    </span>
                    <span className="cashier-reminder-title mt-1 block text-sm font-semibold text-white">{cashierSessionReminder.title}</span>
                    <span className="cashier-reminder-message mt-1 block text-xs leading-5 text-[#dbcab8]">{cashierSessionReminder.message}</span>
                    <span className="cashier-reminder-action mt-2 inline-flex rounded-full border border-orange-300/30 bg-orange-300/12 px-3 py-1 text-[11px] font-semibold text-orange-100">
                      {cashierSessionReminder.actionLabel}
                    </span>
                  </span>
                </button>
              </div>
            ) : null}

            {isPosRoute && cashierSessionMenuOpen ? (
              <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
                <div className={cn(
                  "max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl",
                  cashierSessionStep === "close" ? "max-w-[940px]" : cashierSessionStep === "open" ? "max-w-[760px]" : cashierSessionStep === "password" ? "max-w-[760px]" : "max-w-[420px]"
                )}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Session caissier</p>
                      <h2 className="mt-1 text-xl font-semibold text-white">{user?.fullName ?? "Caissier"}</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-[#eadfd4]"
                      onClick={() => setCashierSessionMenuOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {cashierSessionLoading ? (
                    <LoadingBlock label="Chargement de la session..." />
                  ) : (
                    <div className="space-y-3">
                      {cashierSessionMessage ? (
                        <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-3 py-2.5 text-sm text-[#f4e7dc]">
                          {cashierSessionMessage}
                        </div>
                      ) : null}
                      <div className="rounded-[20px] border border-white/10 bg-black/20 p-3 text-[13px] text-[#eadfd4]">
                        {currentCashSession ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[#baa999]">Caisse</span>
                              <strong className="text-white">{currentCashSession.register.name}</strong>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[#baa999]">Boutique</span>
                              <strong className="text-white">{currentCashSession.register.warehouseName}</strong>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[#baa999]">Heure</span>
                              <strong className="text-white">{formatTicketDate(currentCashSession.openedAt)}</strong>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-[#baa999]">Aucune session ouverte trouvee pour ce caissier.</p>
                        )}
                      </div>

                      {cashierSessionStep === "actions" ? (
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full !py-3 text-sm"
                            disabled={cashSessionActionLoading !== ""}
                            onClick={() => {
                              setCashSessionActionLoading("logout");
                              void logout();
                            }}
                          >
                            {cashSessionActionLoading === "logout" ? "Deconnexion..." : "Deconnexion"}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full !py-3 text-sm"
                            disabled={cashSessionActionLoading !== ""}
                            onClick={() => {
                              setCashierSessionMessage(null);
                              setCashierPasswordDraft({ currentCode: "", nextCode: "", confirmCode: "" });
                              setCashierPasswordTarget("currentCode");
                              setCashierSessionStep("password");
                            }}
                          >
                            Changer mot de passe
                          </Button>
                          {currentCashSession ? (
                            <Button
                              type="button"
                              className="w-full !py-3 text-sm"
                              disabled={cashSessionActionLoading === "close"}
                              onClick={() => setCashierSessionStep("close")}
                            >
                              Fermer session et deconnexion
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              className="w-full !py-3 text-sm"
                              disabled={cashSessionActionLoading === "open"}
                              onClick={async () => {
                                setCashierSessionMessage(null);
                                setOpeningCashMad("0");
                                setOpeningCashEur("0");
                                setOpeningCashUsd("0");
                                setOpeningCurrencyTarget("MAD");
                                await loadCashSessionSetup();
                                setCashierSessionStep("open");
                              }}
                            >
                              Ouvrir une nouvelle session
                            </Button>
                          )}
                        </div>
                      ) : null}

                      {cashierSessionStep === "password" ? (
                        <>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                            <div className="space-y-3">
                              <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                                <div className="mb-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Securite</p>
                                  <h3 className="mt-1 text-base font-semibold text-white">Changer le code confidentiel</h3>
                                </div>
                                <div className="grid gap-3">
                                  {[
                                    { key: "currentCode" as const, label: "Ancien code confidentiel", value: cashierPasswordDraft.currentCode },
                                    { key: "nextCode" as const, label: "Nouveau code confidentiel", value: cashierPasswordDraft.nextCode },
                                    { key: "confirmCode" as const, label: "Confirmer le nouveau code", value: cashierPasswordDraft.confirmCode }
                                  ].map((field) => (
                                    <div
                                      key={field.key}
                                      className={cn(
                                        "rounded-[18px] border p-3 transition",
                                        cashierPasswordTarget === field.key ? "border-orange-300/60 bg-orange-300/12" : "border-white/10 bg-white/5"
                                      )}
                                      onClick={() => setCashierPasswordTarget(field.key)}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">{field.label}</p>
                                        {cashierPasswordTarget === field.key ? <span className="rounded-full bg-orange-400 px-2 py-0.5 text-[10px] font-semibold text-black">Actif</span> : null}
                                      </div>
                                      <Input
                                        value={field.value}
                                        inputMode="numeric"
                                        type="password"
                                        onFocus={() => setCashierPasswordTarget(field.key)}
                                        onClick={() => setCashierPasswordTarget(field.key)}
                                        onChange={(event) => updateCashierPasswordField(field.key, event.target.value)}
                                        className="mt-2 !w-[160px] h-9 text-[13px] font-semibold"
                                        placeholder="0000"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Clavier numerique</p>
                              <div className="grid grid-cols-3 gap-1.5">
                                {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", ""]].flat().map((key, index) => (
                                  key ? (
                                    <button
                                      key={`${key}-${index}`}
                                      type="button"
                                      className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white active:bg-orange-300 active:text-black"
                                      onClick={() => appendCashierPasswordKey(key)}
                                    >
                                      {key}
                                    </button>
                                  ) : <div key={`empty-${index}`} />
                                ))}
                                <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-2.5 text-[11px] font-semibold text-rose-100" onClick={deleteCashierPasswordKey}>Effacer</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-[11px] font-semibold text-white" onClick={clearCashierPasswordKey}>Vider</button>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full !py-2.5 text-sm"
                              disabled={cashSessionActionLoading !== ""}
                              onClick={() => setCashierSessionStep("actions")}
                            >
                              Retour
                            </Button>
                            <Button
                              type="button"
                              className="w-full !py-2.5 text-sm"
                              disabled={cashSessionActionLoading !== ""}
                              onClick={() => void changeCashierPasswordCode()}
                            >
                              {cashSessionActionLoading === "open" ? "Validation..." : "Valider changement"}
                            </Button>
                          </div>
                        </>
                      ) : null}

                      {cashierSessionStep === "open" ? (
                        <>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                            <div className="space-y-3">
                              <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                                <div className="mb-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Nouvelle session</p>
                                  <h3 className="mt-1 text-base font-semibold text-white">Ouverture caisse</h3>
                                </div>
                                <div className="grid gap-2 md:grid-cols-3">
                                  {[
                                    { code: "MAD" as const, label: "MAD", value: openingCashMad },
                                    { code: "EUR" as const, label: "EUR", value: openingCashEur },
                                    { code: "USD" as const, label: "USD", value: openingCashUsd }
                                  ].map((currency) => (
                                    <div
                                      key={currency.code}
                                      className={`rounded-[16px] border p-3 transition ${openingCurrencyTarget === currency.code ? "border-orange-300/60 bg-orange-300/12" : "border-white/10 bg-white/5"}`}
                                      onClick={() => setOpeningCurrencyTarget(currency.code)}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">{currency.label}</p>
                                        {openingCurrencyTarget === currency.code ? <span className="rounded-full bg-orange-400 px-2 py-0.5 text-[10px] font-semibold text-black">Actif</span> : null}
                                      </div>
                                      <Input
                                        value={currency.value}
                                        inputMode="decimal"
                                        onFocus={() => setOpeningCurrencyTarget(currency.code)}
                                        onClick={() => setOpeningCurrencyTarget(currency.code)}
                                        onChange={(event) => {
                                          const nextValue = sanitizeCashClosingValue(event.target.value);
                                          if (currency.code === "MAD") setOpeningCashMad(nextValue);
                                          else if (currency.code === "EUR") setOpeningCashEur(nextValue);
                                          else setOpeningCashUsd(nextValue);
                                        }}
                                        className="mt-2 !w-[112px] h-8 text-[13px] font-semibold"
                                        placeholder="0.00"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                                <div className="mb-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Recapitulatif</p>
                                  <h3 className="mt-1 text-base font-semibold text-white">Fond d'ouverture</h3>
                                </div>
                                <div className="grid gap-2 text-[13px] text-[#eadfd4]">
                                  <div className="flex items-center justify-between gap-3"><span>MAD</span><strong className="text-white">{formatMad(Number(openingCashMad || 0))}</strong></div>
                                  <div className="flex items-center justify-between gap-3"><span>EUR</span><strong className="text-white">{formatForeignAmount(Number(openingCashEur || 0), "EUR")}</strong></div>
                                  <div className="flex items-center justify-between gap-3"><span>USD</span><strong className="text-white">{Number(openingCashUsd || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong></div>
                                  <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                                    <span className="font-medium text-[#cdbfaf]">Total MAD</span>
                                    <strong className="text-white">
                                      {formatMad(
                                        Number(openingCashMad || 0)
                                        + convertForeignToMad(Number(openingCashEur || 0), cashSessionCurrencies.find((currency) => currency.code.toUpperCase() === "EUR")?.rateFromMad)
                                        + convertForeignToMad(Number(openingCashUsd || 0), cashSessionCurrencies.find((currency) => currency.code.toUpperCase() === "USD")?.rateFromMad)
                                      )}
                                    </strong>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                              <div>
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Caisse</p>
                                <select
                                  value={cashOpeningRegisterId}
                                  onChange={(event) => setCashOpeningRegisterId(event.target.value)}
                                  className="input-base h-10 w-full text-sm"
                                >
                                  <option value="">Choisir une caisse</option>
                                  {cashSessionRegisters.map((register) => (
                                    <option key={register.id} value={register.id}>{register.name}</option>
                                  ))}
                                </select>
                              </div>
                              <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Clavier numerique</p>
                              <div className="grid grid-cols-3 gap-1.5">
                                {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "00"]].flat().map((key) => (
                                  <button
                                    key={key}
                                    type="button"
                                    className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white active:bg-orange-300 active:text-black"
                                    onClick={() => appendOpeningCurrencyKey(key)}
                                  >
                                    {key}
                                  </button>
                                ))}
                                <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-2.5 text-[11px] font-semibold text-rose-100" onClick={deleteOpeningCurrencyKey}>Effacer</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-[11px] font-semibold text-white" onClick={clearOpeningCurrencyKey}>Vider</button>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full !py-2.5 text-sm"
                              disabled={cashSessionActionLoading === "open"}
                              onClick={() => setCashierSessionStep("actions")}
                            >
                              Retour
                            </Button>
                            <Button
                              type="button"
                              className="w-full !py-2.5 text-sm"
                              disabled={cashSessionActionLoading === "open"}
                              onClick={() => void startNewCashSession()}
                            >
                              {cashSessionActionLoading === "open" ? "Ouverture..." : "Valider ouverture"}
                            </Button>
                          </div>
                        </>
                      ) : null}

                      {cashierSessionStep === "close" && currentCashSession ? (
                        <>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                            <div className="space-y-3">
                              <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Fond de caisse de cloture</p>
                                    <h3 className="mt-1 text-base font-semibold text-white">Saisie MAD / EUR</h3>
                                  </div>
                                  <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-[#eadfd4]">
                                    Cible: {cashClosingTarget}
                                  </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div
                                    className={`rounded-[18px] border p-3 transition ${cashClosingTarget === "MAD" ? "border-orange-300/60 bg-orange-300/12" : "border-white/10 bg-white/5"}`}
                                    onClick={() => setCashClosingTarget("MAD")}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Cloture MAD</p>
                                      {cashClosingTarget === "MAD" ? <span className="rounded-full bg-orange-400 px-2 py-0.5 text-[10px] font-semibold text-black">Actif</span> : null}
                                    </div>
                                    <Input
                                      value={cashClosingMad}
                                      inputMode="decimal"
                                      onFocus={() => setCashClosingTarget("MAD")}
                                      onClick={() => setCashClosingTarget("MAD")}
                                      onChange={(event) => updateCashClosingValue("MAD", event.target.value)}
                                      className="mt-2 !w-[128px] h-8 text-[13px] font-semibold"
                                      placeholder="0.00"
                                    />
                                  </div>
                                  <div
                                    className={`rounded-[18px] border p-3 transition ${cashClosingTarget === "EUR" ? "border-orange-300/60 bg-orange-300/12" : "border-white/10 bg-white/5"}`}
                                    onClick={() => setCashClosingTarget("EUR")}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Cloture EUR</p>
                                      {cashClosingTarget === "EUR" ? <span className="rounded-full bg-orange-400 px-2 py-0.5 text-[10px] font-semibold text-black">Actif</span> : null}
                                    </div>
                                    <Input
                                      value={cashClosingEur}
                                      inputMode="decimal"
                                      onFocus={() => setCashClosingTarget("EUR")}
                                      onClick={() => setCashClosingTarget("EUR")}
                                      onChange={(event) => updateCashClosingValue("EUR", event.target.value)}
                                      className="mt-2 !w-[128px] h-8 text-[13px] font-semibold"
                                      placeholder="0.00"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                                <div className="mb-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200/80">Recapitulatif</p>
                                  <h3 className="mt-1 text-base font-semibold text-white">Ouverture et cloture</h3>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="rounded-[16px] border border-white/10 bg-white/5 p-3 text-[13px] text-[#eadfd4]">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Ouverture MAD</span>
                                      <strong className="text-white">{formatMad(getOpeningBreakdownAmount("MAD")?.amountMad ?? currentCashSession.openingAmount)}</strong>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                      <span>Ouverture EUR</span>
                                      <strong className="text-white">{formatForeignAmount(getOpeningBreakdownAmount("EUR")?.amount ?? 0, "EUR")}</strong>
                                    </div>
                                  </div>
                                  <div className="rounded-[16px] border border-white/10 bg-white/5 p-3 text-[13px] text-[#eadfd4]">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Cloture MAD</span>
                                      <strong className="text-white">{formatMad(Number(cashClosingMad || 0))}</strong>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                      <span>Cloture EUR</span>
                                      <strong className="text-white">{formatForeignAmount(Number(cashClosingEur || 0), "EUR")}</strong>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Clavier numerique</p>
                              <div className="grid grid-cols-3 gap-1.5">
                                {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "00"]].flat().map((key) => (
                                  <button
                                    key={key}
                                    type="button"
                                    className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white active:bg-orange-300 active:text-black"
                                    onClick={() => appendCashClosingKey(key)}
                                  >
                                    {key}
                                  </button>
                                ))}
                                <button type="button" className="rounded-xl border border-rose-300/20 bg-rose-400/10 py-2.5 text-[11px] font-semibold text-rose-100" onClick={deleteCashClosingKey}>Effacer</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-[11px] font-semibold text-white" onClick={clearCashClosingKey}>Vider</button>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full !py-2.5 text-sm"
                              disabled={cashSessionActionLoading === "close"}
                              onClick={() => setCashierSessionStep("actions")}
                            >
                              Retour
                            </Button>
                            <Button
                              type="button"
                              className="w-full !py-2.5 text-sm"
                              disabled={cashSessionActionLoading === "close"}
                              onClick={() => void closeCashierSessionAndLogout()}
                            >
                              {cashSessionActionLoading === "close" ? "Fermeture..." : "Valider fermeture"}
                            </Button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {inventoryHistoryOpen ? (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                <div className="flex h-[calc(100vh-2rem)] w-full max-w-[780px] flex-col overflow-hidden rounded-[28px] border border-white/15 bg-[#17110d] shadow-2xl md:h-[720px]">
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4 md:px-6">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Stock / Boutique</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">Notifications</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-[#eadfd4]"
                      onClick={() => setInventoryHistoryOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
                    {inventoryHistoryLoading ? (
                      <LoadingBlock label="Chargement des notifications..." />
                    ) : inventoryHistory.length ? (
                      <div className="space-y-3">
                        {inventoryHistory.map((notification) => {
                          const status = notification.status ?? "PENDING";
                          const statusLabel = status === "ACCEPTED" ? "Valide" : status === "REJECTED" ? "Refuse" : "En attente";
                          const statusClass = status === "ACCEPTED"
                            ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                            : status === "REJECTED"
                              ? "border-rose-300/25 bg-rose-400/10 text-rose-100"
                              : "border-orange-300/25 bg-orange-300/10 text-orange-100";
                          const acceptActionId = `${notification.id}:ACCEPTED`;
                          const rejectActionId = `${notification.id}:REJECTED`;
                          const isActionLoading = inventoryNotificationActionId?.startsWith(`${notification.id}:`) ?? false;
                          return (
                          <div key={notification.id} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-white">
                                    {notification.productName}
                                    {notification.variantLabel ? ` - ${notification.variantLabel}` : ""}
                                  </p>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusClass}`}>
                                    {statusLabel}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm text-[#d7c8ba]">
                                  {notification.quantity} unite(s) depuis {notification.fromWarehouseName}
                                </p>
                                <p className="mt-1 text-xs text-[#bba999]">{formatTicketDate(notification.createdAt)}</p>
                                <p className="mt-2 text-xs text-[#c9bbad]">Motif : {notification.reason}</p>
                                {notification.respondedAt ? (
                                  <p className="mt-2 text-xs text-[#bba999]">
                                    Traite par {notification.respondedByName || "Session"} le {formatTicketDate(notification.respondedAt)}
                                  </p>
                                ) : null}
                              </div>
                              {status === "PENDING" ? (
                                <div className="grid min-w-[180px] grid-cols-2 gap-2">
                                  <Button
                                    className="!h-8 !rounded-[14px] !bg-emerald-500 !px-2 !text-[11px] !text-white hover:!bg-emerald-600"
                                    disabled={isActionLoading}
                                    onClick={() => void respondInventoryNotification(notification.id, "ACCEPTED")}
                                  >
                                    {inventoryNotificationActionId === acceptActionId ? "..." : "Valider"}
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    className="!h-8 !rounded-[14px] !border-rose-300/25 !bg-rose-500/15 !px-2 !text-[11px] !text-rose-100 hover:!bg-rose-500/25"
                                    disabled={isActionLoading}
                                    onClick={() => void respondInventoryNotification(notification.id, "REJECTED")}
                                  >
                                    {inventoryNotificationActionId === rejectActionId ? "..." : "Refuser"}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState title="Aucune notification" description="Les transferts entrants de ta boutique apparaitront ici." compact />
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {isPosRoute && ticketsModalOpen ? (
              <div className="fixed inset-0 z-50 bg-black/70 p-3 backdrop-blur-sm md:p-4">
                <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">POS / Tickets</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">Gestion Tickets</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-[#eadfd4]"
                      onClick={() => setTicketsModalOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_150px]">
                    <Input
                      value={ticketsQuery}
                      onChange={(event) => setTicketsQuery(event.target.value)}
                      placeholder="Recherche par ticket ou client..."
                    />
                    <Input type="date" value={ticketsDateFrom} onChange={(event) => setTicketsDateFrom(event.target.value)} />
                    <Input type="date" value={ticketsDateTo} onChange={(event) => setTicketsDateTo(event.target.value)} />
                    <Button className="!py-3" type="button" onClick={() => void loadTickets()}>
                      <span className="inline-flex items-center gap-2">
                        <Search className="h-4 w-4" />
                        Rechercher
                      </span>
                    </Button>
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-4 !py-2 text-sm"
                      onClick={() => {
                        setTicketsQuery("");
                        setTicketsDateFrom(todayIso);
                        setTicketsDateTo(todayIso);
                        void loadTickets({ query: "", dateFrom: todayIso, dateTo: todayIso });
                      }}
                    >
                      Tickets du jour
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-4 !py-2 text-sm"
                      onClick={() => {
                        const start = new Date(currentTime);
                        start.setDate(currentTime.getDate() - 6);
                        const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
                        setTicketsDateFrom(startIso);
                        setTicketsDateTo(todayIso);
                        void loadTickets({ query: ticketsQuery, dateFrom: startIso, dateTo: todayIso });
                      }}
                    >
                      7 derniers jours
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-4 !py-2 text-sm"
                      onClick={() => {
                        setTicketsDateFrom("");
                        setTicketsDateTo("");
                        void loadTickets({ query: ticketsQuery, dateFrom: "", dateTo: "" });
                      }}
                    >
                      Toute la periode
                    </Button>
                  </div>

                  <div className="mb-4 rounded-[22px] border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-200/75">Ticket selectionne</p>
                        {selectedTicket ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#eadfd4]">
                            <span className="font-semibold text-white">{selectedTicket.number}</span>
                            <span className="text-[#baa999]">{selectedTicket.customer?.fullName || "-"}</span>
                            <span className="text-[#baa999]">{formatTicketDate(selectedTicket.createdAt)}</span>
                            {selectedTicket.isInvoiced ? <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100">Facture</span> : null}
                            {selectedTicket.isDetaxed ? <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100">Detaxe</span> : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-[#baa999]">Aucun ticket selectionne.</p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          className="!px-4 !py-2.5 text-sm"
                          disabled={ticketActionLoading === "facture" || ticketActionLoading === "print"}
                          onClick={() => void openDetaxModal()}
                        >
                          Detaxe
                        </Button>
                        <Button
                          type="button"
                          className="!px-4 !py-2.5 text-sm"
                          variant={selectedTicket?.isInvoiced ? "secondary" : undefined}
                          disabled={!selectedTicket || ticketActionLoading === "detaxe" || ticketActionLoading === "print"}
                          onClick={() => void updateTicketMarker("facture", !selectedTicket?.isInvoiced)}
                        >
                          {ticketActionLoading === "facture" ? "Traitement..." : selectedTicket?.isInvoiced ? "Retirer facture" : "Facturer"}
                        </Button>
                        <Button
                          type="button"
                          className="!px-4 !py-2.5 text-sm"
                          variant="secondary"
                          disabled={!selectedTicket || !!ticketActionLoading}
                          onClick={printSelectedTicket}
                        >
                          <span className="inline-flex items-center gap-2">
                            <Printer className="h-4 w-4" />
                            Re-imprimer
                          </span>
                        </Button>
                        <Button
                          type="button"
                          className="!px-4 !py-2.5 text-sm"
                          variant="secondary"
                          disabled={!selectedTicket}
                          onClick={() => {
                            if (requiresManagerTicketApproval) {
                              requestTicketManagerApproval("edit");
                              return;
                            }
                            void openEditTicketModal();
                          }}
                        >
                          Modifier
                        </Button>
                        <Button
                          type="button"
                          className="!px-4 !py-2.5 text-sm"
                          variant="secondary"
                          disabled={!selectedTicket || !!ticketActionLoading}
                          onClick={() => {
                            if (requiresManagerTicketApproval) {
                              requestTicketManagerApproval("delete");
                              return;
                            }
                            void deleteSelectedTicket();
                          }}
                        >
                          Supprimer
                        </Button>
                        <Button
                          type="button"
                          className="!px-4 !py-2.5 text-sm"
                          variant="secondary"
                          disabled={!selectedTicket}
                          onClick={() => {
                            setSelectedTicketId(null);
                            setTicketActionMessage(null);
                          }}
                        >
                          Deselectionner
                        </Button>
                      </div>
                    </div>
                  </div>

                  {ticketActionMessage ? (
                    <div className="pointer-events-none absolute right-5 top-24 z-10 max-w-[520px] rounded-[18px] border border-orange-300/25 bg-[#4a2b14]/95 px-4 py-3 text-sm text-[#fff1e6] shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm">
                      {ticketActionMessage}
                    </div>
                  ) : null}

                  <div className="min-h-0 flex-1">
                    {ticketsLoading ? (
                      <div className="flex h-full items-center justify-center rounded-[22px] border border-white/10 bg-black/20">
                        <LoadingBlock label="Chargement des tickets..." />
                      </div>
                    ) : (
                    <div className="h-full overflow-auto rounded-[22px] border border-white/10 bg-black/20">
                      <table className="min-w-full text-sm text-[#eadfd4]">
                        <thead className="sticky top-0 bg-[#1f1712] text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">
                          <tr>
                            <th className="w-[74px] px-4 py-3 text-left">Choix</th>
                            <th className="px-4 py-3 text-left">Ticket</th>
                            <th className="px-4 py-3 text-left">Date</th>
                            <th className="px-4 py-3 text-left">Client</th>
                            <th className="px-4 py-3 text-left">Vendeur</th>
                            <th className="px-4 py-3 text-left">Articles</th>
                            <th className="px-4 py-3 text-right">Total</th>
                            <th className="px-4 py-3 text-left">Paiements</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tickets.map((ticket) => {
                            const selected = ticket.id === selectedTicketId;
                            return (
                              <tr
                                key={ticket.id}
                                className={cn("border-t border-white/10 align-top transition", selected ? "bg-orange-300/10" : "hover:bg-white/5")}
                                onClick={() => toggleTicketSelection(ticket.id)}
                              >
                                <td className="px-4 py-3">
                                  <label className="flex cursor-pointer items-center justify-center">
                                    <input
                                      type="checkbox"
                                      name="selected-ticket"
                                      className="h-4 w-4 accent-[#ff9f2f]"
                                      checked={selected}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={() => toggleTicketSelection(ticket.id)}
                                    />
                                  </label>
                                </td>
                                <td className="px-4 py-3 font-semibold text-white">
                                  <div>{ticket.number}</div>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {ticket.isInvoiced ? <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100">Facture</span> : null}
                                    {ticket.isDetaxed ? <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100">Detaxe</span> : null}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-xs leading-tight text-[#cdbfaf]">{formatTicketDate(ticket.createdAt)}</td>
                                <td className="px-4 py-3">{ticket.customer?.fullName || "-"}</td>
                                <td className="px-4 py-3">{ticket.sellerName || "-"}</td>
                                <td className="px-4 py-3 text-[#cdbfaf]">
                                  {ticket.items.length ? ticket.items.slice(0, 3).map((item) => `${item.productName} x${item.quantity}`).join(" / ") : "-"}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-white">{formatMad(ticket.totalAmount)}</td>
                                <td className="px-4 py-3 text-[#cdbfaf]">
                                  {ticket.payments.length
                                    ? ticket.payments.map((payment) => `${getPaymentDisplayLabel(payment, { fallbackCash: ticket.payments.length === 1 && payment.method === "MIXED" && !payment.reference })}${payment.reference ? ` - ${payment.reference}` : ""} (${formatMad(payment.amount)})`).join(" / ")
                                    : "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!tickets.length ? <div className="p-6 text-center text-sm text-[#baa999]">Aucun ticket trouve pour ces criteres.</div> : null}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {isPosRoute && detaxModalOpen ? (
              <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[#06131d]/86 px-3 py-4 backdrop-blur-md">
                <div className="flex h-[min(88vh,980px)] w-full max-w-[1600px] flex-col overflow-hidden rounded-[30px] border border-cyan-300/20 bg-[linear-gradient(160deg,rgba(6,19,29,0.98),rgba(11,27,38,0.98))] p-4 shadow-[0_32px_110px_rgba(0,0,0,0.5)] md:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="pos-detax-kicker text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/80">POS / Detaxe</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">Detaxe</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/15 bg-white/5 p-2 text-cyan-50"
                      onClick={() => {
                        setDetaxModalOpen(false);
                        setDetaxCreateModalOpen(false);
                      }}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_150px]">
                    <Input
                      value={detaxQuery}
                      onChange={(event) => setDetaxQuery(event.target.value)}
                      placeholder="Recherche ticket detaxe, ticket source ou client..."
                    />
                    <Input type="date" value={detaxDateFrom} onChange={(event) => setDetaxDateFrom(event.target.value)} />
                    <Input type="date" value={detaxDateTo} onChange={(event) => setDetaxDateTo(event.target.value)} />
                    <Button className="!py-3" type="button" onClick={() => void loadDetaxTickets()}>
                      <span className="inline-flex items-center gap-2">
                        <Search className="h-4 w-4" />
                        Rechercher
                      </span>
                    </Button>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="!px-4 !py-2 text-sm"
                        onClick={() => {
                          setDetaxQuery("");
                          setDetaxDateFrom(todayIso);
                          setDetaxDateTo(todayIso);
                          void loadDetaxTickets({ query: "", dateFrom: todayIso, dateTo: todayIso });
                        }}
                      >
                        Tickets du jour
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="!px-4 !py-2 text-sm"
                        onClick={() => {
                          const start = new Date(currentTime);
                          start.setDate(currentTime.getDate() - 6);
                          const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
                          setDetaxDateFrom(startIso);
                          setDetaxDateTo(todayIso);
                          void loadDetaxTickets({ query: detaxQuery, dateFrom: startIso, dateTo: todayIso });
                        }}
                      >
                        7 derniers jours
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="!px-4 !py-2 text-sm"
                        onClick={() => {
                          setDetaxDateFrom("");
                          setDetaxDateTo("");
                          void loadDetaxTickets({ query: detaxQuery, dateFrom: "", dateTo: "" });
                        }}
                      >
                        Toute la periode
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" className="!px-4 !py-2.5 text-sm" onClick={() => openNewDetaxModal(selectedTicket?.number ?? null)}>
                        Nouveau
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="!px-4 !py-2.5 text-sm"
                        disabled={!selectedDetaxTicket}
                        onClick={() => selectedDetaxTicket ? printDetaxTicket(selectedDetaxTicket) : undefined}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Printer className="h-4 w-4" />
                          Imprimer
                        </span>
                      </Button>
                    </div>
                  </div>

                  {ticketActionMessage ? (
                    <div className="pos-detax-toast mb-4 rounded-[18px] border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">
                      {ticketActionMessage}
                    </div>
                  ) : null}

                  <div className="mb-4 rounded-[22px] border border-cyan-300/15 bg-black/20 p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/75">Ticket detaxe selectionne</p>
                        {selectedDetaxTicket ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#eadfd4]">
                            <span className="font-semibold text-white">{selectedDetaxTicket.number}</span>
                            <span className="text-[#baa999]">Source {formatDetaxSourceSummary(selectedDetaxTicket.sourceTickets?.length ? selectedDetaxTicket.sourceTickets : [{ sourceTicketNumber: selectedDetaxTicket.sourceTicketNumber }])}</span>
                            <span className="text-[#baa999]">{selectedDetaxTicket.customerName || "Client comptoir"}</span>
                            <span className="text-[#baa999]">{formatTicketDate(selectedDetaxTicket.createdAt)}</span>
                            <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100">Detaxe</span>
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-[#baa999]">Aucun ticket detaxe selectionne.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
                    {detaxTicketsLoading ? (
                      <div className="flex h-full items-center justify-center rounded-[22px] border border-cyan-300/15 bg-black/20">
                        <LoadingBlock label="Chargement des tickets detaxe..." />
                      </div>
                    ) : (
                      <div className="h-full overflow-auto rounded-[22px] border border-cyan-300/15 bg-black/20">
                        <table className="min-w-full text-sm text-[#eadfd4]">
                          <thead className="pos-detax-table-head sticky top-0 bg-[#102433] text-xs uppercase tracking-[0.18em] text-cyan-100/80">
                            <tr>
                              <th className="w-[74px] px-4 py-3 text-left">Choix</th>
                              <th className="px-4 py-3 text-left">Detaxe</th>
                              <th className="px-4 py-3 text-left">Ticket source</th>
                              <th className="px-4 py-3 text-left">Date</th>
                              <th className="px-4 py-3 text-left">Client</th>
                              <th className="px-4 py-3 text-left">Boutique</th>
                              <th className="px-4 py-3 text-right">Articles</th>
                              <th className="px-4 py-3 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detaxTickets.map((ticket) => {
                              const selected = ticket.id === selectedDetaxTicketId;
                              return (
                                <tr
                                  key={ticket.id}
                                className={cn("border-t border-white/10 align-top transition", selected ? "bg-cyan-300/12" : "hover:bg-white/5")}
                                  onClick={() => setSelectedDetaxTicketId(ticket.id)}
                                >
                                  <td className="px-4 py-3">
                                    <label className="flex cursor-pointer items-center justify-center">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-[#ff9f2f]"
                                        checked={selected}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={() => setSelectedDetaxTicketId(ticket.id)}
                                      />
                                    </label>
                                  </td>
                                  <td className="px-4 py-3 font-semibold text-white">{ticket.number}</td>
                                  <td className="px-4 py-3 text-[#cdbfaf]">{formatDetaxSourceSummary(ticket.sourceTickets?.length ? ticket.sourceTickets : [{ sourceTicketNumber: ticket.sourceTicketNumber }])}</td>
                                  <td className="px-4 py-3 text-xs leading-tight text-[#cdbfaf]">{formatTicketDate(ticket.createdAt)}</td>
                                  <td className="px-4 py-3">{ticket.customerName || "Client comptoir"}</td>
                                  <td className="px-4 py-3">{ticket.warehouseName}</td>
                                  <td className="px-4 py-3 text-right text-[#cdbfaf]">{ticket.itemCount}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-white">{formatMad(ticket.totalAmount)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {!detaxTickets.length ? <div className="p-6 text-center text-sm text-[#baa999]">Aucun ticket detaxe trouve pour cette periode.</div> : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {isPosRoute && detaxCreateModalOpen ? (
              <div className="fixed inset-0 z-[65] flex items-center justify-center bg-[#071521]/90 px-3 py-4 backdrop-blur-md">
                <div className="relative flex h-[min(88vh,920px)] w-full max-w-[1440px] flex-col overflow-hidden rounded-[30px] border border-cyan-300/20 bg-[linear-gradient(160deg,rgba(7,21,33,0.98),rgba(8,30,43,0.98))] p-4 shadow-[0_32px_110px_rgba(0,0,0,0.56)] md:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="pos-detax-kicker text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/80">POS / Detaxe</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">Nouveau ticket detaxe</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/15 bg-white/5 p-2 text-cyan-50"
                      onClick={closeNewDetaxModal}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {ticketActionMessage ? (
                    <div className="pos-detax-toast pointer-events-none absolute right-5 top-20 z-10 max-w-[520px] rounded-[18px] border border-cyan-300/25 bg-[#103245]/95 px-4 py-3 text-sm text-cyan-50 shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm">
                      {ticketActionMessage}
                    </div>
                  ) : null}

                  {createdDetaxTicket ? (
                    <div className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-white/10 bg-black/20 p-5">
                      <div className="rounded-[22px] border border-emerald-300/20 bg-emerald-300/10 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/90">Ticket cree</p>
                        <h3 className="mt-2 text-2xl font-semibold text-white">{createdDetaxTicket.number}</h3>
                        <p className="mt-2 text-sm text-[#eadfd4]">
                          Source {formatDetaxSourceSummary(createdDetaxTicket.sourceTickets?.length ? createdDetaxTicket.sourceTickets : [{ sourceTicketNumber: createdDetaxTicket.sourceTicketNumber }])} - {createdDetaxTicket.customerName || "Client comptoir"}
                        </p>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-[#cdbfaf]">Boutique</p>
                          <p className="mt-2 text-sm font-semibold text-white">{createdDetaxTicket.warehouseName}</p>
                        </div>
                        <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-[#cdbfaf]">Articles detaxes</p>
                          <p className="mt-2 text-sm font-semibold text-white">{createdDetaxTicket.itemCount}</p>
                        </div>
                        <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-[#cdbfaf]">Total TTC</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatMad(createdDetaxTicket.totalAmount)}</p>
                        </div>
                      </div>
                      <div className="mt-auto flex flex-wrap justify-end gap-2 pt-5">
                        <Button type="button" variant="secondary" onClick={() => printDetaxTicket(createdDetaxTicket)}>
                          <span className="inline-flex items-center gap-2">
                            <Printer className="h-4 w-4" />
                            Imprimer ticket detaxe
                          </span>
                        </Button>
                        <Button type="button" variant="secondary" onClick={closeNewDetaxModal}>Fermer</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[340px_minmax(0,1fr)]">
                      <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-cyan-300/15 bg-black/20 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Ticket de caisse</p>
                        <input
                          ref={detaxLookupInputRef}
                          autoFocus
                          className="input-base mt-3 h-12 w-full text-base"
                          value={detaxLookupCode}
                          onChange={(event) => setDetaxLookupCode(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void previewDetaxSourceTicket();
                            }
                          }}
                          placeholder="Scanner ou saisir le numero complet"
                        />
                        <div className="mt-3 flex gap-2">
                          <Button type="button" className="flex-1 !py-3 text-sm" onClick={() => void previewDetaxSourceTicket()} disabled={detaxLookupLoading}>
                            {detaxLookupLoading ? "Recherche..." : "Ajouter ticket"}
                          </Button>
                          <Button type="button" variant="secondary" className="!px-4 !py-3 text-sm" onClick={clearDetaxLookupDigit}>
                            Vider
                          </Button>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-2">
                          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
                            <button
                              key={digit}
                              type="button"
                              className="rounded-[16px] border border-cyan-300/15 bg-white/5 py-2.5 text-[13px] font-semibold text-white transition hover:border-cyan-300/35 hover:bg-cyan-300/10"
                              onClick={() => appendDetaxLookupDigit(digit)}
                            >
                              {digit}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="col-span-2 rounded-[16px] border border-cyan-300/15 bg-white/5 py-2.5 text-[13px] font-semibold text-white transition hover:border-cyan-300/35 hover:bg-cyan-300/10"
                            onClick={deleteDetaxLookupDigit}
                          >
                            Effacer
                          </button>
                        </div>

                        <div className="pos-detax-loaded-tickets mt-4 min-h-0 flex-1 overflow-auto rounded-[20px] border border-cyan-300/15 bg-[#081722]/80 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/75">Tickets charges</p>
                          <div className="mt-3 space-y-2">
                            {detaxPreview?.sourceTickets?.length ? detaxPreview.sourceTickets.map((ticket) => (
                              <div key={ticket.sourceTicketId} className="rounded-[16px] border border-cyan-300/15 bg-white/[0.03] p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-white">{ticket.sourceTicketNumber}</p>
                                    <p className="mt-1 text-[11px] text-[#9db2c0]">{formatTicketDate(ticket.sourceTicketDate)}</p>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="!px-3 !py-1.5 text-[11px]"
                                    onClick={() => removeDetaxSourceTicket(ticket.sourceTicketId)}
                                  >
                                    Retirer
                                  </Button>
                                </div>
                              </div>
                            )) : (
                              <p className="text-sm text-[#89a3b6]">Aucun ticket charge.</p>
                            )}
                          </div>
                        </div>
                      </section>

                      <div className="flex min-h-0 flex-col gap-3">
                        <div className="flex justify-start">
                          <Button
                            type="button"
                            variant="secondary"
                            className="!px-4 !py-2 text-sm"
                            disabled={!detaxPreview}
                            onClick={() => setDetaxCustomerEditOpen((current) => !current)}
                          >
                            {detaxCustomerEditOpen ? "Masquer client" : "Modifier client"}
                          </Button>
                        </div>

                        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-cyan-300/15 bg-black/20 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Ticket source</p>
                            </div>
                          </div>

                          <div>
                            {detaxPreview ? (
                              <div className="mt-2 space-y-1 text-sm text-[#eadfd4]">
                                <p className="font-semibold text-white">{formatDetaxSourceSummary(detaxPreview.sourceTickets)}</p>
                                <p>{formatTicketDate(detaxPreview.sourceTicketDate)} - {detaxPreview.warehouseName}</p>
                                <p>{detaxPreview.sourceTickets.length} ticket(s) charge(s)</p>
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-[#baa999]">Scanne un ticket pour charger les articles detaxables.</p>
                            )}
                          </div>

                          {detaxCustomerEditOpen ? (
                            <div className="mt-3 rounded-[18px] border border-cyan-300/15 bg-white/5 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Client sur ticket detaxe</p>
                              <Input
                                className="mt-2 h-11"
                                value={detaxCustomerName}
                                onChange={(event) => setDetaxCustomerName(event.target.value)}
                                placeholder="Nom du client"
                              />
                            </div>
                          ) : null}

                          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                            <div className="rounded-[22px] border border-cyan-300/15 bg-[#0d1821]">
                              <div className="max-h-[340px] overflow-auto">
                                <table className="min-w-full text-sm text-[#eadfd4]">
                                  <thead className="pos-detax-table-head sticky top-0 bg-[#102433] text-xs uppercase tracking-[0.18em] text-cyan-100/80">
                                    <tr>
                                      <th className="px-4 py-3 text-left">Reference</th>
                                      <th className="px-4 py-3 text-left">Article</th>
                                      <th className="px-4 py-3 text-left">Ticket</th>
                                      <th className="px-4 py-3 text-center">Qte</th>
                                      <th className="px-4 py-3 text-right">Prix</th>
                                      <th className="px-4 py-3 text-right">Montant</th>
                                      <th className="px-4 py-3 text-right">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detaxDraftItems.map((item) => (
                                      <tr key={item.id} className="border-t border-white/10">
                                        <td className="px-4 py-3 text-[#cdbfaf]">{item.reference}</td>
                                        <td className="px-4 py-3 font-semibold text-white">{sanitizeUiText(item.productName)}</td>
                                        <td className="px-4 py-3 text-[11px] text-cyan-200/70">{item.sourceTicketNumber}</td>
                                        <td className="px-4 py-3 text-center">{item.quantity}</td>
                                        <td className="px-4 py-3 text-right">{formatMad(item.unitPriceTtc)}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-white">{formatMad(item.lineTotal)}</td>
                                        <td className="px-4 py-3 text-right">
                                          <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => removeDetaxDraftItem(item.id)}>
                                            Retirer
                                          </Button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {!detaxDraftItems.length ? <div className="p-6 text-center text-sm text-[#baa999]">Aucun article detaxable selectionne.</div> : null}
                            </div>

                            {detaxPreview?.skippedItems?.length ? (
                              <div className="mt-4 rounded-[22px] border border-white/10 bg-black/20 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Articles non detaxables</p>
                                    <p className="mt-1 text-xs text-[#9db2c0]">Affiches en gris pour comprendre pourquoi ils ne montent pas dans le ticket detaxe.</p>
                                  </div>
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                                    {detaxPreview.skippedItems.length} ligne(s)
                                  </span>
                                </div>
                                <div className="overflow-auto rounded-[18px] border border-white/10 bg-white/[0.03]">
                                  <table className="min-w-full text-sm text-[#c2ced6]">
                                    <thead className="bg-white/[0.04] text-[11px] uppercase tracking-[0.18em] text-white/55">
                                      <tr>
                                        <th className="px-4 py-3 text-left">Reference</th>
                                        <th className="px-4 py-3 text-left">Article</th>
                                        <th className="px-4 py-3 text-left">Ticket</th>
                                        <th className="px-4 py-3 text-center">Qte</th>
                                        <th className="px-4 py-3 text-right">Prix</th>
                                        <th className="px-4 py-3 text-left">Motif</th>
                                        <th className="px-4 py-3 text-right">Fiche</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detaxPreview.skippedItems.map((item) => (
                                        <tr key={item.id} className="border-t border-white/10 opacity-70">
                                          <td className="px-4 py-3">{item.reference}</td>
                                          <td className="px-4 py-3">{sanitizeUiText(item.productName)}</td>
                                          <td className="px-4 py-3 text-[11px] text-cyan-200/70">{item.sourceTicketNumber}</td>
                                          <td className="px-4 py-3 text-center">{item.quantity}</td>
                                          <td className="px-4 py-3 text-right">{formatMad(item.unitPriceTtc)}</td>
                                          <td className="px-4 py-3 text-[#9db2c0]">{item.reason}</td>
                                          <td className="px-4 py-3 text-right">
                                            <Button
                                              type="button"
                                              variant="secondary"
                                              className="!px-3 !py-2 text-[11px]"
                                              onClick={() => openProductDetailFromDetax(item.productId)}
                                            >
                                              Ouvrir
                                            </Button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-4 grid gap-2 md:grid-cols-4">
                            <div className="rounded-[14px] border border-cyan-300/15 bg-white/5 px-2.5 py-2">
                              <p className="text-[9px] uppercase tracking-[0.14em] text-[#cdbfaf]">Total HT</p>
                              <p className="mt-1 text-[11px] font-semibold text-white">
                                {formatMad(detaxDraftItems.reduce((sum, item) => sum + item.lineTotal / (1 + item.taxRate / 100), 0))}
                              </p>
                            </div>
                            <div className="rounded-[14px] border border-cyan-300/15 bg-white/5 px-2.5 py-2">
                              <p className="text-[9px] uppercase tracking-[0.14em] text-[#cdbfaf]">TVA</p>
                              <p className="mt-1 text-[11px] font-semibold text-white">
                                {formatMad(detaxDraftItems.reduce((sum, item) => sum + (item.lineTotal - item.lineTotal / (1 + item.taxRate / 100)), 0))}
                              </p>
                            </div>
                            <div className="rounded-[14px] border border-cyan-300/15 bg-white/5 px-2.5 py-2">
                              <p className="text-[9px] uppercase tracking-[0.14em] text-[#cdbfaf]">Total TTC</p>
                              <p className="mt-1 text-[11px] font-semibold text-white">
                                {formatMad(detaxDraftItems.reduce((sum, item) => sum + item.lineTotal, 0))}
                              </p>
                            </div>
                            <div className="rounded-[14px] border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-2">
                              <p className="text-[9px] uppercase tracking-[0.14em] text-emerald-100/80">Remboursement</p>
                              <p className="mt-1 text-[11px] font-semibold text-emerald-50">
                                {formatMad(detaxDraftItems.reduce((sum, item) => sum + item.lineTotal, 0) * 0.13)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={closeNewDetaxModal}>Annuler</Button>
                            <Button type="button" onClick={() => void saveDetaxTicket()} disabled={!detaxPreview || !detaxDraftItems.length || detaxSaving}>
                              {detaxSaving ? "Validation..." : "Valider ticket detaxe"}
                            </Button>
                          </div>
                      </section>
                    </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {isPosRoute && ticketManagerApprovalOpen ? (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
                <div className="w-full max-w-[520px] rounded-[28px] border border-white/15 bg-[#17110d] p-5 shadow-2xl">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Validation manager</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">
                        {ticketManagerApprovalAction === "delete" ? "Supprimer le ticket" : "Modifier le ticket"}
                      </h2>
                    </div>
                    <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={closeTicketManagerApproval}>
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  {selectedTicket ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <p className="text-sm font-semibold text-white">{selectedTicket.number}</p>
                      <p className="mt-1 text-xs text-[#c9b8aa]">{selectedTicket.customer?.fullName || "Client comptoir"} - {formatTicketDate(selectedTicket.createdAt)}</p>
                    </div>
                  ) : null}
                  <div className="mt-4 space-y-3">
                    <Input
                      autoFocus
                      className="h-12 text-base"
                      value={ticketManagerApprovalCode}
                      onChange={(event) => setTicketManagerApprovalCode(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void confirmTicketManagerApproval();
                        }
                      }}
                      placeholder="Scanner le badge manager"
                    />
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={closeTicketManagerApproval}>Annuler</Button>
                    <Button type="button" onClick={() => void confirmTicketManagerApproval()} disabled={!ticketManagerApprovalCode.trim() || ticketManagerApprovalLoading}>
                      {ticketManagerApprovalLoading ? "Validation..." : "Valider"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {isPosRoute && editTicketModalOpen ? (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm">
                <div className="relative w-full max-w-[1480px] rounded-[30px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-6">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">POS / Tickets</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">Modifier Ticket</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-[#eadfd4]"
                      onClick={closeEditTicketModal}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {editTicketLoading || !editTicketDraft ? (
                    <LoadingBlock label="Chargement du ticket..." />
                  ) : (
                    <>
                      {!editTicketDraft.editable ? (
                        <div className="mb-4 rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-3 text-sm text-[#f4e7dc]">
                          {editTicketDraft.editBlockedReason || "Modification indisponible pour ce ticket."}
                        </div>
                      ) : null}

                      {editCatalogModalOpen || editOrderModalOpen || editPaymentModalOpen ? (
                        <div className="mb-5 grid gap-4 xl:grid-cols-12">
                          {editCatalogModalOpen ? (
                            <section className="rounded-[24px] border border-white/15 bg-[#120e0b] p-4 shadow-xl xl:col-span-7 xl:p-5">
                              <div className="mb-4 flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Ticket / Articles</p>
                                  <h3 className="mt-1 text-xl font-semibold text-white">Ajouter un article</h3>
                                </div>
                                <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => setEditCatalogModalOpen(false)}>
                                  Fermer
                                </Button>
                              </div>

                              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
                                <Input
                                  value={editCatalogQuery}
                                  placeholder="Reference, article, code-barres ou prix"
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setEditCatalogQuery(nextValue);
                                    void loadEditCatalog(nextValue);
                                  }}
                                />
                                <Button type="button" variant="secondary" className="!py-3" onClick={() => void loadEditCatalog(editCatalogQuery)}>
                                  Rechercher
                                </Button>
                              </div>

                              <div className="mt-4 max-h-[360px] overflow-auto rounded-[22px] border border-white/10 bg-black/20">
                                <table className="min-w-full text-sm text-[#eadfd4]">
                                  <thead className="sticky top-0 bg-[#1f1712] text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">
                                    <tr>
                                      <th className="px-4 py-3 text-left">Reference</th>
                                      <th className="px-4 py-3 text-left">Article</th>
                                      <th className="px-4 py-3 text-right">Stock</th>
                                      <th className="px-4 py-3 text-right">Prix</th>
                                      <th className="px-4 py-3 text-right">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {editCatalogRows.map((row) => (
                                      <tr key={row.id} className="cursor-pointer border-t border-white/10 hover:bg-white/5" onDoubleClick={() => addCatalogRowToEditTicket(row)}>
                                        <td className="px-4 py-3 text-[#cdbfaf]">{row.reference}</td>
                                        <td className="px-4 py-3 font-semibold text-white">{row.name}</td>
                                        <td className="px-4 py-3 text-right text-[#cdbfaf]">{row.stockOnHand}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-white">{formatMad(row.salePriceTtc)}</td>
                                        <td className="px-4 py-3 text-right">
                                          <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => addCatalogRowToEditTicket(row)}>
                                            Ajouter
                                          </Button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {editCatalogLoading ? <div className="p-6 text-center text-sm text-[#baa999]">Chargement...</div> : null}
                                {!editCatalogLoading && !editCatalogRows.length ? <div className="p-6 text-center text-sm text-[#baa999]">Aucun article simple trouve.</div> : null}
                              </div>
                            </section>
                          ) : (
                            <div className="hidden xl:col-span-7 xl:block" />
                          )}

                          <div className="space-y-4 xl:col-span-5">
                            {editOrderModalOpen ? (
                              <section className="rounded-[24px] border border-white/15 bg-[#120e0b] p-4 shadow-xl">
                                <div className="mb-4 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Ticket / Commande</p>
                                    <h3 className="mt-1 text-xl font-semibold text-white">Ajouter une commande</h3>
                                  </div>
                                  <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => setEditOrderModalOpen(false)}>
                                    Fermer
                                  </Button>
                                </div>

                                <div className="mb-4 grid grid-cols-2 gap-2">
                                  {["Sac", "Vetement", "Chaussure", "Mobilier"].map((type) => (
                                    <button
                                      key={type}
                                      type="button"
                                      className={cn(
                                        "rounded-2xl border px-3 py-3 text-sm font-semibold transition",
                                        editOrderForm.type === type
                                          ? "border-orange-300/60 bg-orange-300 text-black"
                                          : "border-white/10 bg-black/25 text-[#eadccf] hover:border-orange-300/30"
                                      )}
                                      onClick={() => setEditOrderForm((current) => ({ ...current, type }))}
                                    >
                                      {type}
                                    </button>
                                  ))}
                                </div>

                                <div className="space-y-3">
                                  <label className="space-y-2">
                                    <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Numero de commande</span>
                                    <Input value={editOrderForm.number} onChange={(event) => setEditOrderForm((current) => ({ ...current, number: event.target.value }))} />
                                  </label>
                                  <label className="space-y-2">
                                    <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Total commande</span>
                                    <Input type="number" min={0} step="0.01" value={editOrderForm.totalAmount} onChange={(event) => setEditOrderForm((current) => ({ ...current, totalAmount: event.target.value }))} />
                                  </label>
                                  <label className="space-y-2">
                                    <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Montant acompte</span>
                                    <Input type="number" min={0} step="0.01" value={editOrderForm.depositAmount} onChange={(event) => setEditOrderForm((current) => ({ ...current, depositAmount: event.target.value }))} />
                                  </label>
                                </div>

                                <div className="mt-4 rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-3 py-2 text-sm text-[#eadfd4]">
                                  <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Reste a payer</p>
                                  <p className="mt-1 text-lg font-semibold text-white">{formatMad(editOrderRemaining)}</p>
                                </div>

                                <div className="mt-4 flex justify-end gap-2">
                                  <Button type="button" variant="secondary" onClick={() => setEditOrderModalOpen(false)}>
                                    Annuler
                                  </Button>
                                  <Button type="button" onClick={addOrderLineToEditTicket}>
                                    Ajouter
                                  </Button>
                                </div>
                              </section>
                            ) : null}

                            {editPaymentModalOpen ? (
                              <section className="rounded-[24px] border border-white/15 bg-[#120e0b] p-4 shadow-xl">
                                <div className="mb-4 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Ticket / Paiement</p>
                                    <h3 className="mt-1 text-xl font-semibold text-white">
                                      {editPaymentDraft.paymentId ? "Remplacer le paiement" : "Ajouter paiement"}
                                    </h3>
                                  </div>
                                  <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => setEditPaymentModalOpen(false)}>
                                    Fermer
                                  </Button>
                                </div>

                                <div className="mb-4 grid grid-cols-2 gap-2">
                                  {[
                                    { code: "CASH", label: "Espece" },
                                    { code: "CARD", label: "Carte bancaire" },
                                    { code: "TRANSFER", label: "Virement" },
                                    { code: "CHEQUE", label: "Cheque" }
                                  ].map((method) => (
                                    <button
                                      key={method.code}
                                      type="button"
                                      className={cn(
                                        "rounded-2xl border px-3 py-3 text-sm font-semibold transition",
                                        editPaymentDraft.method === method.code
                                          ? "border-orange-300/60 bg-orange-300 text-black"
                                          : "border-white/10 bg-black/25 text-[#eadccf] hover:border-orange-300/30"
                                      )}
                                      onClick={() => setEditPaymentDraft((current) => ({ ...current, method: method.code }))}
                                    >
                                      {method.label}
                                    </button>
                                  ))}
                                </div>

                                <div className="space-y-3">
                                  <label className="space-y-2">
                                    <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Montant</span>
                                    <Input
                                      type="number"
                                      min={0.01}
                                      step="0.01"
                                      value={editPaymentDraft.amount}
                                      onChange={(event) => setEditPaymentDraft((current) => ({ ...current, amount: event.target.value }))}
                                    />
                                  </label>
                                  <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-3 text-right">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Reste ticket</p>
                                    <p className="mt-1 text-lg font-semibold text-white">{formatMad(Math.max(0, editTicketBalanceGap))}</p>
                                  </div>
                                </div>

                                <div className="mt-4 flex justify-end gap-2">
                                  <Button type="button" variant="secondary" onClick={() => setEditPaymentModalOpen(false)}>
                                    Annuler
                                  </Button>
                                  <Button type="button" onClick={applyEditPaymentModal}>
                                    Valider
                                  </Button>
                                </div>
                              </section>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div className="mb-5 rounded-[24px] border border-orange-300/15 bg-gradient-to-r from-orange-300/10 via-transparent to-white/5 p-4 lg:p-5">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-200/80">Fiche Ticket</p>
                            <h3 className="mt-2 text-2xl font-semibold text-white">{editTicketDraft.number}</h3>
                            <p className="mt-2 text-sm text-[#baa999]">
                              {sanitizeUiText(editTicketDraft.customer?.fullName || "-")} ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ {formatTicketDate(editTicketDraft.createdAt)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#eadfd4]">
                              {editTicketDraft.items.length} ligne(s)
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#eadfd4]">
                              Total {formatMad(editTicketLinesTotal)}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#eadfd4]">
                              Paiements {formatMad(editTicketPaymentsTotal)}
                            </span>
                            {editTicketDraft.isInvoiced ? <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-100">Facture</span> : null}
                            {editTicketDraft.isDetaxed ? <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100">Detaxe</span> : null}
                          </div>
                        </div>
                      </div>

                      <div className="mb-4 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_420px] xl:items-start">
                        <section
                          className="min-w-0 rounded-[24px] border border-sky-300/20 bg-sky-300/5 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] xl:p-5"
                          style={{ minWidth: 0 }}
                        >
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-4">
                            <div className="min-w-0">
                              <h3 className="text-lg font-semibold text-white">Articles</h3>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-xs text-sky-50">
                                {editTicketDraft.items.length} ligne(s)
                              </span>
                              <Button
                                type="button"
                                variant="secondary"
                                className="pointer-events-auto relative z-[2] !px-3 !py-2 text-xs"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openEditCatalogModal();
                                }}
                              >
                                Ajouter un article
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                className="pointer-events-auto relative z-[2] !px-3 !py-2 text-xs"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openEditOrderModal();
                                }}
                              >
                                Ajouter une commande
                              </Button>
                            </div>
                          </div>

                          <div className="max-h-[58vh] space-y-3 overflow-y-auto rounded-[20px] border border-sky-300/15 bg-[#171d20] p-3">
                            {editTicketDraft.items.map((item) => (
                              <div key={item.id} className="rounded-[20px] border border-sky-300/15 bg-sky-300/5 p-3.5">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-white">{sanitizeUiText(item.productName)}</p>
                                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[#baa999]">
                                      {item.kind === "ORDER_DEPOSIT" ? `Commande ${item.orderNumber || "-"}` : item.reference}
                                    </p>
                                    {item.kind === "ORDER_DEPOSIT" ? (
                                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#d8cab9]">
                                        <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2.5 py-1">
                                          Total commande: {formatMad(Number(item.orderTotal || 0))}
                                        </span>
                                        <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2.5 py-1">
                                          {sanitizeUiText(`Acompte commande NÃƒâ€šÃ‚Â° ${item.orderNumber || "-"}:`)} {formatMad(Number(item.depositAmount || item.unitPriceTtc || 0))}
                                        </span>
                                      </div>
                                    ) : null}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="pointer-events-auto relative z-[2] !px-3 !py-2 text-xs"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      removeEditItem(item.id);
                                    }}
                                  >
                                    Retirer
                                  </Button>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1.5 text-xs font-semibold text-sky-50">
                                    {item.quantity} unite(s)
                                  </span>
                                  <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1.5 text-xs font-semibold text-sky-50">
                                    {formatMad(item.unitPriceTtc)}
                                  </span>
                                  <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1.5 text-xs font-semibold text-white">
                                    {formatMad(item.lineTotal)}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {!editTicketDraft.items.length ? (
                              <div className="rounded-[18px] border border-dashed border-sky-300/20 bg-sky-300/5 p-6 text-center text-sm text-[#baa999]">
                                Aucun article dans le ticket.
                              </div>
                            ) : null}
                          </div>
                        </section>

                        <aside className="space-y-4 xl:sticky xl:top-5">
                          <section className="rounded-[24px] border border-orange-300/20 bg-orange-300/5 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/8 pb-4">
                              <div>
                                <h3 className="text-lg font-semibold text-white">Paiements</h3>
                              </div>
                              <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1 text-xs text-orange-50">
                                {editTicketDraft.payments.length} ligne(s)
                              </span>
                            </div>

                            <div className="mb-4">
                              <Button
                                type="button"
                                variant="secondary"
                                className="pointer-events-auto relative z-[2] w-full !px-4 !py-2.5 text-sm"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openEditPaymentModal();
                                }}
                              >
                                Ajouter paiement
                              </Button>
                            </div>

                            <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
                              {editTicketDraft.payments.map((payment) => (
                                <div key={payment.id} className="rounded-[18px] border border-orange-300/15 bg-[#201a15] p-3.5">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-[11px] uppercase tracking-[0.14em] text-[#baa999]">Mode</div>
                                      <div className="mt-1 text-base font-semibold text-white">{getPaymentDisplayLabel(payment)}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-[11px] uppercase tracking-[0.14em] text-[#baa999]">Montant</div>
                                      <div className="mt-1 text-lg font-semibold text-white">{formatMad(payment.amount)}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex gap-2">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="pointer-events-auto relative z-[2] flex-1 !px-3 !py-2.5 text-xs"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openEditPaymentModal(payment);
                                      }}
                                    >
                                      Remplacer
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="pointer-events-auto relative z-[2] flex-1 !px-3 !py-2.5 text-xs"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        removeEditPayment(payment.id);
                                      }}
                                    >
                                      Retirer
                                    </Button>
                                  </div>
                                </div>
                              ))}
                              {!editTicketDraft.payments.length ? (
                                <div className="rounded-[18px] border border-dashed border-orange-300/20 bg-orange-300/5 p-6 text-center text-sm text-[#baa999]">
                                  Aucun paiement dans le ticket.
                                </div>
                              ) : null}
                            </div>
                          </section>

                          <section className="rounded-[24px] border border-orange-300/20 bg-orange-300/10 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-100/80">Recapitulatif</p>
                            <div className="mt-4 space-y-3 text-sm">
                              <div className="flex items-center justify-between gap-4 text-[#eadfd4]">
                                <span>Total lignes</span>
                                <span className="font-semibold text-white">{formatMad(editTicketDraft.items.reduce((sum, item) => sum + item.lineTotal, 0))}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4 text-[#eadfd4]">
                                <span>Total paiements</span>
                                <span className="font-semibold text-white">{formatMad(editTicketDraft.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0))}</span>
                              </div>
                              <div className="h-px bg-white/10" />
                              <div className="flex items-center justify-between gap-4 text-[#eadfd4]">
                                <span>Ecart</span>
                                <span className="font-semibold text-white">
                                  {formatMad(
                                    editTicketDraft.items.reduce((sum, item) => sum + item.lineTotal, 0) -
                                    editTicketDraft.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
                                  )}
                                </span>
                              </div>
                            </div>
                          </section>

                          <section className="rounded-[24px] border border-orange-300/20 bg-black/20 p-4">
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="secondary" className="flex-1 !px-4 !py-2.5" onClick={closeEditTicketModal}>
                                Fermer
                              </Button>
                              <Button
                                type="button"
                                className="flex-1 !px-4 !py-2.5"
                                disabled={editTicketSaving || !editTicketDraft.items.length || !editTicketDraft.payments.length}
                                onClick={() => void saveEditedTicket()}
                              >
                                {editTicketSaving ? "Enregistrement..." : "Enregistrer"}
                              </Button>
                            </div>
                          </section>
                        </aside>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {false ? (
              <div className="absolute inset-3 z-[90] flex items-center justify-center rounded-[24px] bg-black/80 px-3 py-4 backdrop-blur-sm">
                <div className="w-full max-w-[920px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Ticket / Articles</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">Ajouter un article</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-[#eadfd4]"
                      onClick={() => setEditCatalogModalOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                    <Input
                      value={editCatalogQuery}
                      placeholder="Reference, article, code-barres ou prix"
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setEditCatalogQuery(nextValue);
                        void loadEditCatalog(nextValue);
                      }}
                    />
                    <Button type="button" variant="secondary" className="!py-3" onClick={() => void loadEditCatalog(editCatalogQuery)}>
                      Rechercher
                    </Button>
                  </div>

                  <div className="mt-4 max-h-[460px] overflow-auto rounded-[22px] border border-white/10 bg-black/20">
                    <table className="min-w-full text-sm text-[#eadfd4]">
                      <thead className="sticky top-0 bg-[#1f1712] text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">
                        <tr>
                          <th className="px-4 py-3 text-left">Reference</th>
                          <th className="px-4 py-3 text-left">Article</th>
                          <th className="px-4 py-3 text-right">Stock</th>
                          <th className="px-4 py-3 text-right">Prix</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editCatalogRows.map((row) => (
                          <tr key={row.id} className="cursor-pointer border-t border-white/10 hover:bg-white/5" onDoubleClick={() => addCatalogRowToEditTicket(row)}>
                            <td className="px-4 py-3 text-[#cdbfaf]">{row.reference}</td>
                            <td className="px-4 py-3 font-semibold text-white">{row.name}</td>
                            <td className="px-4 py-3 text-right text-[#cdbfaf]">{row.stockOnHand}</td>
                            <td className="px-4 py-3 text-right font-semibold text-white">{formatMad(row.salePriceTtc)}</td>
                            <td className="px-4 py-3 text-right">
                              <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => addCatalogRowToEditTicket(row)}>
                                Ajouter
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editCatalogLoading ? <div className="p-6 text-center text-sm text-[#baa999]">Chargement...</div> : null}
                    {!editCatalogLoading && !editCatalogRows.length ? <div className="p-6 text-center text-sm text-[#baa999]">Aucun article simple trouve.</div> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {false ? (
              <div className="absolute inset-3 z-[90] flex items-center justify-center rounded-[24px] bg-black/80 px-3 py-4 backdrop-blur-sm">
                <div className="w-full max-w-[760px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Ticket / Commande</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">Ajouter une commande</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-[#eadfd4]"
                      onClick={() => setEditOrderModalOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {["Sac", "Vetement", "Chaussure", "Mobilier"].map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={cn(
                          "rounded-2xl border px-3 py-3 text-sm font-semibold transition",
                          editOrderForm.type === type
                            ? "border-orange-300/60 bg-orange-300 text-black"
                            : "border-white/10 bg-black/25 text-[#eadccf] hover:border-orange-300/30"
                        )}
                        onClick={() => setEditOrderForm((current) => ({ ...current, type }))}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Numero de commande</span>
                      <Input value={editOrderForm.number} onChange={(event) => setEditOrderForm((current) => ({ ...current, number: event.target.value }))} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Total commande</span>
                      <Input type="number" min={0} step="0.01" value={editOrderForm.totalAmount} onChange={(event) => setEditOrderForm((current) => ({ ...current, totalAmount: event.target.value }))} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Montant acompte</span>
                      <Input type="number" min={0} step="0.01" value={editOrderForm.depositAmount} onChange={(event) => setEditOrderForm((current) => ({ ...current, depositAmount: event.target.value }))} />
                    </label>
                  </div>

                  <div className="mt-4 w-full max-w-[230px] rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-3 py-2 text-sm text-[#eadfd4]">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Reste a payer</p>
                    <p className="mt-1 text-lg font-semibold text-white">{formatMad(editOrderRemaining)}</p>
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setEditOrderModalOpen(false)}>
                      Annuler
                    </Button>
                    <Button type="button" onClick={addOrderLineToEditTicket}>
                      Ajouter
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {false ? (
              <div className="absolute inset-3 z-[90] flex items-center justify-center rounded-[24px] bg-black/80 px-3 py-4 backdrop-blur-sm">
                <div className="w-full max-w-[760px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Ticket / Paiement</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">
                        {editPaymentDraft.paymentId ? "Remplacer le paiement" : "Ajouter paiement"}
                      </h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 p-2 text-[#eadfd4]"
                      onClick={() => setEditPaymentModalOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { code: "CASH", label: "Espece" },
                      { code: "CARD", label: "Carte bancaire" },
                      { code: "TRANSFER", label: "Virement" },
                      { code: "CHEQUE", label: "Cheque" }
                    ].map((method) => (
                      <button
                        key={method.code}
                        type="button"
                        className={cn(
                          "rounded-2xl border px-3 py-3 text-sm font-semibold transition",
                          editPaymentDraft.method === method.code
                            ? "border-orange-300/60 bg-orange-300 text-black"
                            : "border-white/10 bg-black/25 text-[#eadccf] hover:border-orange-300/30"
                        )}
                        onClick={() => setEditPaymentDraft((current) => ({ ...current, method: method.code }))}
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.14em] text-[#baa999]">Montant</span>
                      <Input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={editPaymentDraft.amount}
                        onChange={(event) => setEditPaymentDraft((current) => ({ ...current, amount: event.target.value }))}
                      />
                    </label>
                    <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-3 text-right">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Reste ticket</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatMad(Math.max(0, editTicketBalanceGap))}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setEditPaymentModalOpen(false)}>
                      Annuler
                    </Button>
                    <Button type="button" onClick={applyEditPaymentModal}>
                      Valider
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
