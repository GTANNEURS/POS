import { useEffect, useMemo, useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { useLocation } from "react-router-dom";
import { api } from "../../lib/api";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { Badge, Button, EmptyState, LoadingBlock, PageHeader, SectionCard } from "../../components/ui/primitives";
import { useAuth } from "../../providers/AuthProvider";

type CommandView =
  | "non_validated"
  | "validated"
  | "sacs"
  | "vetements"
  | "chaussures"
  | "iraqi"
  | "mobiliers"
  | "verify";

type AtelierStatusGroup = "en_cours" | "retardees" | "annulees" | "en_stock" | "livrees";
type ValidatedViewMode = "paid" | "unpaid" | "recent";

type WarehouseOption = { id: string; name: string };
type SellerOption = { id: string; fullName: string; warehouseId?: string | null };
type LegacyOption = { id: number; name: string; store_id?: number | null };
type ProductOption = { id: string; name: string; reference: string; salePriceTtc: number };
type BootstrapData = {
  warehouses: WarehouseOption[];
  sellers: SellerOption[];
  products: ProductOption[];
  ateliers: Array<{ id: string; label: string }>;
  statuses: Array<{ id: string; label: string }>;
  legacy: {
    vendors: LegacyOption[];
    workshops: LegacyOption[];
    clients: LegacyOption[];
    stores: LegacyOption[];
  };
};

type PendingOrder = {
  orderNumber: string;
  orderType: string;
  warehouseId: string;
  warehouseName: string;
  sellerName: string | null;
  customerName: string | null;
  createdAt: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  saleIds: string[];
  ticketNumbers: string[];
  notes: string[];
  payments: Array<{ method: string; amount: number; reference?: string | null }>;
};

type LegacyOrder = {
  id: number;
  orderNumber: string;
  validationNumber?: string | null;
  clientName: string;
  vendorName: string;
  workshopName: string;
  storeName: string;
  commandType: string;
  totalAmount: number;
  paid: boolean;
  status: string;
  statusKey: string;
  deliveryDate?: string | null;
  createdAt: string;
  note?: string;
  itemsCount: number;
  statusHistory?: Array<{
    id: number;
    status: string;
    actorName: string;
    context: string;
    createdAt: string;
  }>;
  items?: Array<{
    id: number;
    reference: string;
    model: string;
    material: string;
    color: string;
    size: string;
    quantity: number;
    unitPrice: number;
    details: string;
  }>;
  atelierGroup?: AtelierStatusGroup;
};

type VerifyResultState = LegacyOrder | null;

type ValidatedOrder = PendingOrder & { legacy: LegacyOrder | null };

type ValidationItem = {
  id: string;
  productId?: string;
  reference: string;
  model: string;
  material: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  details: string;
};

type ValidationFormState = {
  sourceSaleId: string;
  sourceTicketNumber: string;
  orderNumber: string;
  orderType: string;
  sourceOrderTotal: number;
  sourcePaidAmount: number;
  sourceRemainingAmount: number;
  deliveryDate: string;
  workshopId: string;
  storeId: string;
  vendorId: string;
  clientId: string;
  paid: boolean;
  items: ValidationItem[];
};
type ValidationMode = "create" | "edit";

type ToastState = {
  message: string;
  tone: "success" | "danger" | "info";
} | null;
type ToastTone = NonNullable<ToastState>["tone"];
type NewCommandClientState = {
  name: string;
  phone: string;
  address: string;
  search: string;
};
type NewCommandArticleState = {
  productId: string;
  reference: string;
  model: string;
  materialAndColors: string;
  size: string;
  quantity: string;
  unitPrice: string;
  details: string;
  photoName: string;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatCommandDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split("-");
      return `${day}-${month}-${year}`;
    }
    return raw;
  }
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}-${month}-${year}`;
}

function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    rows: rows.slice(start, start + safePageSize),
    currentPage: safePage,
    totalPages
  };
}

function formatPaymentMethod(method: string) {
  const normalized = String(method || "").trim().toUpperCase().replace(/\s+/g, "_");
  switch (normalized) {
    case "CASH":
      return "Espece";
    case "CARD":
      return "Carte bancaire";
    case "TRANSFER":
      return "Virement";
    case "CHEQUE":
      return "Cheque";
    case "CREDIT":
      return "Compte client";
    case "VOUCHER":
      return "Bon achat";
    case "FOREIGN_CURRENCY":
      return "Devise";
    default:
      return normalized.replace(/_/g, " ");
  }
}

function buildPaymentSummary(payments: PendingOrder["payments"]) {
  if (!payments.length) return "Aucun paiement";
  return payments.map((payment) => formatPaymentMethod(payment.method)).join(" • ");
}

function mapOrderTypeToWorkshopId(orderType: string, options: BootstrapData | null) {
  if (!options) return "";
  const normalized = normalizeText(orderType);
  const workshop = options.legacy.workshops.find((entry) => {
    const name = normalizeText(entry.name);
    if (normalized.includes("sac")) return name.includes("sac");
    if (normalized.includes("vetement")) return name.includes("vetement");
    if (normalized.includes("chaussure")) return name.includes("chaussure");
    if (normalized.includes("mobilier") || normalized.includes("bois") || normalized.includes("iraqi")) return name.includes("bois");
    return false;
  });
  return workshop ? String(workshop.id) : "";
}

function buildNewItem(): ValidationItem {
  return {
    id: `item-${Date.now()}-${Math.round(Math.random() * 10000)}`,
    productId: "",
    reference: "",
    model: "",
    material: "",
    color: "",
    size: "",
    quantity: 1,
    unitPrice: 0,
    details: ""
  };
}

function defaultValidationForm(options: BootstrapData | null): ValidationFormState {
  return {
    sourceSaleId: "",
    sourceTicketNumber: "",
    orderNumber: "",
    orderType: "",
    sourceOrderTotal: 0,
    sourcePaidAmount: 0,
    sourceRemainingAmount: 0,
    deliveryDate: "",
    workshopId: "",
    storeId: options?.legacy.stores[0] ? String(options.legacy.stores[0].id) : "",
    vendorId: "",
    clientId: options?.legacy.clients[0] ? String(options.legacy.clients[0].id) : "",
    paid: false,
    items: []
  };
}

function defaultArticleDraft(): NewCommandArticleState {
  return {
    productId: "",
    reference: "",
    model: "",
    materialAndColors: "",
    size: "",
    quantity: "1",
    unitPrice: "0",
    details: "",
    photoName: ""
  };
}

export function SalesPage() {
  const { user, sessionScope } = useAuth();
  const location = useLocation();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CommandView>("non_validated");
  const [search, setSearch] = useState("");
  const [validatedViewMode, setValidatedViewMode] = useState<ValidatedViewMode>("paid");
  const [atelierStatusGroup, setAtelierStatusGroup] = useState<AtelierStatusGroup>("en_cours");
  const [recentValidatedAtelier, setRecentValidatedAtelier] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [validatedOrders, setValidatedOrders] = useState<ValidatedOrder[]>([]);
  const [legacyOrders, setLegacyOrders] = useState<LegacyOrder[]>([]);
  const [verifyOrderNumber, setVerifyOrderNumber] = useState("");
  const [verifyOrder, setVerifyOrder] = useState<VerifyResultState>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationForm, setValidationForm] = useState<ValidationFormState>(defaultValidationForm(null));
  const [validationMode, setValidationMode] = useState<ValidationMode>("create");
  const [editingLegacyOrderNumber, setEditingLegacyOrderNumber] = useState("");
  const [detailOrder, setDetailOrder] = useState<LegacyOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [newClient, setNewClient] = useState<NewCommandClientState>({ name: "", phone: "", address: "", search: "" });
  const [articlePickerOpen, setArticlePickerOpen] = useState(false);
  const [articleSearchModalOpen, setArticleSearchModalOpen] = useState(false);
  const [articleSearch, setArticleSearch] = useState("");
  const [articleDraft, setArticleDraft] = useState<NewCommandArticleState>(defaultArticleDraft());
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === "/commandes/non-validee") setView("non_validated");
    else if (pathname === "/commandes/validee") setView("validated");
    else if (pathname === "/commandes/sacs") setView("sacs");
    else if (pathname === "/commandes/vetements") setView("vetements");
    else if (pathname === "/commandes/chaussures") setView("chaussures");
    else if (pathname === "/commandes/iraqi") setView("iraqi");
    else if (pathname === "/commandes/mobiliers") setView("mobiliers");
    else if (pathname === "/commandes/verifier") setView("verify");
  }, [location.pathname]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadBootstrap() {
    const data = await api<BootstrapData>("/sales/command-center/bootstrap");
    setBootstrap(data);
    setValidationForm((current) => current.orderNumber || current.sourceSaleId ? current : defaultValidationForm(data));
  }

  async function loadCurrentView() {
    const querySuffix = `search=${encodeURIComponent(search)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
    if (view === "non_validated") {
      const data = await api<PendingOrder[]>(`/sales/command-center/non-validated?${querySuffix}`);
      setPendingOrders(data);
      return;
    }

    if (view === "validated") {
      const paidState = validatedViewMode === "recent" ? "all" : validatedViewMode;
      const data = await api<ValidatedOrder[]>(`/sales/command-center/validated?${querySuffix}&paidState=${paidState}`);
      setValidatedOrders(data);
      return;
    }

    const atelier = view === "verify" ? "" : view;
    const data = await api<LegacyOrder[]>(`/sales/command-center/legacy-orders?${querySuffix}&atelier=${encodeURIComponent(atelier)}`);
    setLegacyOrders(data);
  }

  async function loadPage() {
    setLoading(true);
    try {
      await loadBootstrap();
      await loadCurrentView();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!bootstrap) return;
    void loadCurrentView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, validatedViewMode, bootstrap]);

  useEffect(() => {
    setCurrentPage(1);
  }, [view, validatedViewMode, atelierStatusGroup, recentValidatedAtelier, dateFrom, dateTo]);

  const filteredLegacyOrders = useMemo(() => {
    if (view === "verify") return legacyOrders;
    return legacyOrders.filter((order) => order.atelierGroup === atelierStatusGroup);
  }, [legacyOrders, atelierStatusGroup, view]);
  const pageSize = 10;
  const pendingPage = useMemo(() => paginateRows(pendingOrders, currentPage, pageSize), [pendingOrders, currentPage]);
  const validatedPage = useMemo(() => paginateRows(validatedOrders, currentPage, pageSize), [validatedOrders, currentPage]);
  const legacyPage = useMemo(() => paginateRows(filteredLegacyOrders, currentPage, pageSize), [filteredLegacyOrders, currentPage]);
  const validatedRecentAteliers = useMemo(() => {
    const atelierNames = [
      ...(bootstrap?.legacy.workshops ?? []).map((workshop) => workshop.name),
      ...validatedOrders.map((order) => order.legacy?.workshopName || "")
    ]
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    return [...new Set(atelierNames)];
  }, [bootstrap, validatedOrders]);
  const recentValidatedOrders = useMemo(() => {
    if (!recentValidatedAtelier) return [] as ValidatedOrder[];
    const atelierRows = validatedOrders
      .filter((order) => normalizeText(order.legacy?.workshopName || "") === normalizeText(recentValidatedAtelier))
      .sort((left, right) => {
        const rightTime = toTimestamp(right.legacy?.createdAt || right.createdAt);
        const leftTime = toTimestamp(left.legacy?.createdAt || left.createdAt);
        return rightTime - leftTime;
      });
    if (atelierRows.length === 0) return [] as ValidatedOrder[];
    const latestValidationTime = toTimestamp(atelierRows[0].legacy?.createdAt || atelierRows[0].createdAt);
    return atelierRows.filter((order) => {
      const orderTime = toTimestamp(order.legacy?.createdAt || order.createdAt);
      return latestValidationTime - orderTime <= 60 * 60 * 1000;
    });
  }, [recentValidatedAtelier, validatedOrders]);
  const recentValidatedPage = useMemo(
    () => paginateRows(recentValidatedOrders, currentPage, pageSize),
    [recentValidatedOrders, currentPage]
  );

  const workshopOptions = bootstrap?.legacy.workshops ?? [];
  const storeOptions = bootstrap?.legacy.stores ?? [];
  const vendorOptions = useMemo(() => {
    if (!bootstrap) return [];
    const storeId = Number(validationForm.storeId || 0);
    return bootstrap.legacy.vendors.filter((vendor) => !storeId || Number(vendor.store_id || 0) === storeId);
  }, [bootstrap, validationForm.storeId]);
  const isPosSourcedCommand = Boolean(validationForm.sourceSaleId);
  const existingLegacyClients = useMemo(() => {
    const clients = bootstrap?.legacy.clients ?? [];
    const term = normalizeText(newClient.search);
    if (!term) return clients.slice(0, 8);
    return clients.filter((client) => normalizeText(client.name).includes(term)).slice(0, 12);
  }, [bootstrap, newClient.search]);
  const filteredProducts = useMemo(() => {
    const products = bootstrap?.products ?? [];
    const term = normalizeText(articleSearch);
    if (!term) return products.slice(0, 30);
    return products
      .filter((product) => normalizeText(`${product.reference} ${product.name}`).includes(term))
      .slice(0, 40);
  }, [articleSearch, bootstrap]);
  const validationItemsTotal = useMemo(
    () => validationForm.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [validationForm.items]
  );
  const sourceOrderGap = useMemo(
    () => Number((validationItemsTotal - validationForm.sourceOrderTotal).toFixed(2)),
    [validationItemsTotal, validationForm.sourceOrderTotal]
  );
  const paymentStatusLabel = useMemo(() => {
    if (!isPosSourcedCommand) return "Non payee";
    if (validationForm.sourceRemainingAmount <= 0.009) return "Payee";
    if (validationForm.sourcePaidAmount > 0) return "Partiellement payee";
    return "Non payee";
  }, [isPosSourcedCommand, validationForm.sourcePaidAmount, validationForm.sourceRemainingAmount]);
  const paymentStatusTone = paymentStatusLabel === "Payee"
    ? "success"
    : paymentStatusLabel === "Partiellement payee"
      ? "warning"
      : "neutral";
  const recentValidatedPrintDate = useMemo(() => {
    if (dateFrom && dateTo) return `${formatCommandDate(dateFrom)} au ${formatCommandDate(dateTo)}`;
    if (dateFrom) return `Depuis le ${formatCommandDate(dateFrom)}`;
    if (dateTo) return `Jusqu'au ${formatCommandDate(dateTo)}`;
    return formatCommandDate(new Date().toISOString());
  }, [dateFrom, dateTo]);

  function showToast(message: string, tone: ToastTone) {
    setToast({ message, tone });
  }

  function openValidationModal(source?: PendingOrder | null) {
    const base = defaultValidationForm(bootstrap);
    if (!source || !bootstrap) {
      setValidationMode("create");
      setEditingLegacyOrderNumber("");
      setValidationForm(base);
      setValidationModalOpen(true);
      return;
    }

    const matchedStore = bootstrap.legacy.stores.find((store) => normalizeText(store.name).includes(normalizeText(source.warehouseName))) ?? bootstrap.legacy.stores[0];
    const matchedClient = bootstrap.legacy.clients.find((client) => normalizeText(client.name) === normalizeText(source.customerName));
    const matchedVendor = bootstrap.legacy.vendors.find((vendor) => normalizeText(vendor.name) === normalizeText(source.sellerName));

    setValidationForm({
      sourceSaleId: source.saleIds[0] || "",
      sourceTicketNumber: source.ticketNumbers.join(" / "),
      orderNumber: source.orderNumber,
      orderType: source.orderType,
      sourceOrderTotal: source.totalAmount,
      sourcePaidAmount: source.paidAmount,
      sourceRemainingAmount: source.remainingAmount,
      deliveryDate: "",
      workshopId: mapOrderTypeToWorkshopId(source.orderType, bootstrap),
      storeId: matchedStore ? String(matchedStore.id) : base.storeId,
      vendorId: matchedVendor ? String(matchedVendor.id) : "",
      clientId: matchedClient ? String(matchedClient.id) : base.clientId,
      paid: source.remainingAmount <= 0.009,
      items: []
    });
    setValidationMode("create");
    setEditingLegacyOrderNumber("");
    setValidationModalOpen(true);
  }

  async function openValidatedEditModal(order: ValidatedOrder) {
    if (!bootstrap) return;
    try {
      const detail = await api<LegacyOrder>(`/sales/command-center/legacy-orders/${encodeURIComponent(order.orderNumber)}`);
      const matchedStore = bootstrap.legacy.stores.find((store) => normalizeText(store.name) === normalizeText(detail.storeName))
        ?? bootstrap.legacy.stores.find((store) => normalizeText(detail.storeName).includes(normalizeText(store.name)))
        ?? bootstrap.legacy.stores[0];
      const matchedClient = bootstrap.legacy.clients.find((client) => normalizeText(client.name) === normalizeText(detail.clientName));
      const matchedVendor = bootstrap.legacy.vendors.find((vendor) => normalizeText(vendor.name) === normalizeText(detail.vendorName));
      const matchedWorkshop = bootstrap.legacy.workshops.find((workshop) => normalizeText(workshop.name) === normalizeText(detail.workshopName))
        ?? bootstrap.legacy.workshops.find((workshop) => normalizeText(detail.workshopName).includes(normalizeText(workshop.name)));

      setValidationForm({
        sourceSaleId: "",
        sourceTicketNumber: order.ticketNumbers.join(" / "),
        orderNumber: detail.orderNumber,
        orderType: detail.commandType || order.orderType,
        sourceOrderTotal: order.totalAmount,
        sourcePaidAmount: order.paidAmount,
        sourceRemainingAmount: order.remainingAmount,
        deliveryDate: detail.deliveryDate || "",
        workshopId: matchedWorkshop ? String(matchedWorkshop.id) : mapOrderTypeToWorkshopId(detail.commandType || order.orderType, bootstrap),
        storeId: matchedStore ? String(matchedStore.id) : defaultValidationForm(bootstrap).storeId,
        vendorId: matchedVendor ? String(matchedVendor.id) : "",
        clientId: matchedClient ? String(matchedClient.id) : defaultValidationForm(bootstrap).clientId,
        paid: detail.paid,
        items: (detail.items ?? []).map((item) => ({
          id: `legacy-item-${item.id}`,
          reference: item.reference || "",
          model: item.model || "",
          material: item.material || "",
          color: item.color || "",
          size: item.size || "",
          quantity: Number(item.quantity || 1),
          unitPrice: Number(item.unitPrice || 0),
          details: item.details || ""
        }))
      });
      setValidationMode("edit");
      setEditingLegacyOrderNumber(detail.orderNumber);
      setValidationModalOpen(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erreur API", "danger");
    }
  }

  async function openDetail(orderNumber: string) {
    try {
      const detail = await api<LegacyOrder>(`/sales/command-center/legacy-orders/${encodeURIComponent(orderNumber)}`);
      setDetailOrder(detail);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossible d'ouvrir la commande.", "danger");
    }
  }

  async function searchVerifyOrder() {
    const normalized = verifyOrderNumber.trim();
    if (!normalized) {
      showToast("Numero de commande obligatoire.", "danger");
      return;
    }

    setVerifyLoading(true);
    try {
      const detail = await api<LegacyOrder>(`/sales/command-center/legacy-orders/${encodeURIComponent(normalized)}`);
      setVerifyOrder(detail);
    } catch (error) {
      setVerifyOrder(null);
      showToast(error instanceof Error ? error.message : "Impossible de verifier la commande.", "danger");
    } finally {
      setVerifyLoading(false);
    }
  }

  function resetVerifyOrder() {
    setVerifyOrderNumber("");
    setVerifyOrder(null);
  }

  async function submitValidation() {
    const normalizedOrderNumber = String(validationForm.orderNumber || editingLegacyOrderNumber || "").trim();
    const normalizedEditingTarget = String(editingLegacyOrderNumber || normalizedOrderNumber).trim();
    if (!normalizedOrderNumber) {
      showToast("Numero de commande obligatoire.", "danger");
      return;
    }

    const payload = {
      ...validationForm,
      orderNumber: normalizedOrderNumber,
      paid: paymentStatusLabel === "Payee",
      workshopId: Number(validationForm.workshopId),
      storeId: Number(validationForm.storeId),
      vendorId: Number(validationForm.vendorId),
      clientId: Number(validationForm.clientId),
      items: validationForm.items.map((item) => ({
        productId: item.productId || undefined,
        reference: item.reference,
        model: item.model,
        material: item.material,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        details: item.details
      }))
    };

    setSaving(true);
    try {
      await api(
        validationMode === "edit"
          ? `/sales/command-center/legacy-orders/${encodeURIComponent(normalizedEditingTarget)}`
          : "/sales/command-center/validate",
        {
        method: validationMode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      setValidationModalOpen(false);
      setValidationMode("create");
      setEditingLegacyOrderNumber("");
      showToast(
        validationMode === "edit"
          ? `Commande ${validationForm.orderNumber} mise a jour.`
          : `Commande ${validationForm.orderNumber} validee.`,
        "success"
      );
      await loadCurrentView();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erreur API", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function createCommandClient() {
    if (!newClient.name.trim()) {
      showToast("Nom client obligatoire.", "danger");
      return;
    }

    const duplicate = (bootstrap?.legacy.clients ?? []).find((client) => normalizeText(client.name) === normalizeText(newClient.name));
    if (duplicate) {
      setValidationForm((current) => ({ ...current, clientId: String(duplicate.id) }));
      setClientModalOpen(false);
      setNewClient({ name: "", phone: "", address: "", search: "" });
      showToast(`Client existant selectionne: ${duplicate.name}.`, "info");
      return;
    }

    setCreatingClient(true);
    try {
      const created = await api<{ legacyClientId: number; legacyClientName: string }>("/sales/command-center/customers", {
        method: "POST",
        body: JSON.stringify(newClient)
      });
      setValidationForm((current) => ({ ...current, clientId: String(created.legacyClientId) }));
      setClientModalOpen(false);
      setNewClient({ name: "", phone: "", address: "", search: "" });
      showToast(`Client ${created.legacyClientName} ajoute.`, "success");
      await loadBootstrap();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erreur API", "danger");
    } finally {
      setCreatingClient(false);
    }
  }

  function selectExistingLegacyClient(clientId: number, clientName: string) {
    setValidationForm((current) => ({ ...current, clientId: String(clientId) }));
    setClientModalOpen(false);
    setNewClient({ name: "", phone: "", address: "", search: "" });
    showToast(`Client selectionne: ${clientName}.`, "success");
  }

  function addProductToValidation(product: ProductOption) {
    setArticleDraft({
      productId: product.id,
      reference: product.reference || "",
      model: product.name,
      materialAndColors: "",
      size: "",
      quantity: "1",
      unitPrice: String(Number(product.salePriceTtc || 0)),
      details: "",
      photoName: ""
    });
    setArticleSearchModalOpen(false);
  }

  function runArticleReferenceSearch() {
    const term = normalizeText(articleDraft.reference || articleSearch);
    if (!term) {
      showToast("Saisis une reference ou un article.", "danger");
      return;
    }
    const matched = (bootstrap?.products ?? []).find((product) =>
      normalizeText(`${product.reference} ${product.name}`).includes(term)
    );
    if (!matched) {
      showToast("Aucun article trouve pour cette reference.", "danger");
      return;
    }
    addProductToValidation(matched);
  }

  function submitArticleDraft() {
    if (!articleDraft.model.trim()) {
      showToast("Choisis d'abord un article.", "danger");
      return;
    }

    const [material = "", color = ""] = articleDraft.materialAndColors
      .split("/")
      .map((value) => value.trim());

    setValidationForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          id: `item-${Date.now()}-${Math.round(Math.random() * 10000)}`,
          productId: articleDraft.productId,
          reference: articleDraft.reference.trim(),
          model: articleDraft.model.trim(),
          material,
          color,
          size: articleDraft.size.trim(),
          quantity: Math.max(1, Number(articleDraft.quantity || 1)),
          unitPrice: Math.max(0, Number(articleDraft.unitPrice || 0)),
          details: articleDraft.details.trim()
        }
      ]
    }));
    setArticleDraft(defaultArticleDraft());
    setArticleSearch("");
    setArticlePickerOpen(false);
  }

  async function updateLegacyStatus(orderNumber: string, status: string) {
    try {
      await api(`/sales/command-center/legacy-orders/${encodeURIComponent(orderNumber)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      showToast(`Commande ${orderNumber} mise a jour.`, "success");
      if (view === "verify" && verifyOrder?.orderNumber === orderNumber) {
        const refreshed = await api<LegacyOrder>(`/sales/command-center/legacy-orders/${encodeURIComponent(orderNumber)}`);
        setVerifyOrder(refreshed);
        return;
      }
      await loadCurrentView();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erreur API", "danger");
    }
  }

  useEffect(() => {
    if (validatedRecentAteliers.length === 0) {
      if (recentValidatedAtelier) setRecentValidatedAtelier("");
      return;
    }
    if (!recentValidatedAtelier || !validatedRecentAteliers.includes(recentValidatedAtelier)) {
      setRecentValidatedAtelier(validatedRecentAteliers[0]);
    }
  }, [recentValidatedAtelier, validatedRecentAteliers]);

  function printRecentValidatedOrders() {
    if (!recentValidatedAtelier || recentValidatedOrders.length === 0) {
      showToast("Aucune commande recente a imprimer pour cet atelier.", "info");
      return;
    }

    const printWindow = window.open("", "_blank", "width=980,height=720");
    if (!printWindow) {
      showToast("Impossible d'ouvrir la fenetre d'impression.", "danger");
      return;
    }

    const rowsHtml = recentValidatedOrders.map((row) => {
      const observation = row.legacy?.note?.trim() || row.notes.find((note) => String(note || "").trim()) || "-";
      return `
        <tr>
          <td>${escapeHtml(row.orderNumber)}</td>
          <td>${escapeHtml(row.sellerName || "-")}</td>
          <td>${escapeHtml(observation)}</td>
        </tr>
      `;
    }).join("");

    printWindow.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Commandes recentes - ${escapeHtml(recentValidatedAtelier)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #1a1a1a; }
            .header { margin-bottom: 18px; }
            .title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
            .meta { font-size: 14px; margin-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #d4d4d4; padding: 10px 12px; text-align: left; font-size: 14px; vertical-align: top; }
            th { background: #f5f5f5; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">Commandes recemment validees</div>
            <div class="meta"><strong>Atelier :</strong> ${escapeHtml(recentValidatedAtelier)}</div>
            <div class="meta"><strong>Date :</strong> ${escapeHtml(recentValidatedPrintDate)}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>N° Commande</th>
                <th>Vendeur</th>
                <th>Observation</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 150);
  }

  if (loading) {
    return <LoadingBlock label="Chargement des commandes..." />;
  }

  const toastTone = toast?.tone;
  const isAdminSession = Boolean(user?.roles.includes("admin"));
  const isWorkshopView = view === "sacs" || view === "vetements" || view === "chaussures" || view === "iraqi" || view === "mobiliers";
  return (
    <div className="space-y-4">
      {toast ? (
        <div className="fixed right-6 top-6 z-[70]">
          <div
            className={[
              "rounded-[18px] border px-4 py-3 text-sm shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur",
              toastTone === "success" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-50" : "",
              toastTone === "danger" ? "border-rose-400/30 bg-rose-500/15 text-rose-50" : "",
              toastTone === "info" ? "border-sky-400/30 bg-sky-500/15 text-sky-50" : ""
            ].join(" ")}
          >
            {toast.message}
          </div>
        </div>
      ) : null}

      <PageHeader eyebrow="POS / Commandes" title="" titleClassName="hidden" />

      {view === "verify" ? (
        <div className="space-y-5">
          <SectionCard title="" actions={null}>
            <div className="space-y-6">
              <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
                <h3 className="text-[22px] font-semibold text-orange-400">Recherche</h3>
                <div className="mt-6 flex flex-wrap items-end gap-4">
                  <Field label="Numero de commande" className="min-w-[240px] max-w-[260px]">
                    <input
                      value={verifyOrderNumber}
                      onChange={(event) => setVerifyOrderNumber(event.target.value.replace(/\D/g, ""))}
                      className="field-input !h-11 !rounded-[16px] !bg-black/25"
                      placeholder="Ex: 125818"
                    />
                  </Field>
                  <Button type="button" className="!h-11 !px-5" onClick={() => void searchVerifyOrder()} disabled={verifyLoading}>
                    {verifyLoading ? "Recherche..." : "Rechercher"}
                  </Button>
                  <Button type="button" variant="secondary" className="!h-11 !px-5 !bg-white/5 !text-white" onClick={resetVerifyOrder}>
                    Reinitialiser
                  </Button>
                </div>
              </div>

              {verifyOrder ? (
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
                  <div className="grid gap-4 xl:grid-cols-5 md:grid-cols-3 sm:grid-cols-2">
                    <InfoRow label="Statut" value={verifyOrder.status || "-"} compact />
                    <InfoRow label="Commande" value={verifyOrder.orderNumber || "-"} compact />
                    <InfoRow label="Client" value={verifyOrder.clientName || "-"} compact />
                    <InfoRow label="Vendeur" value={verifyOrder.vendorName || "-"} compact />
                    <InfoRow label="Magasin" value={verifyOrder.storeName || "-"} compact />
                  </div>

                  <div className="mt-5 overflow-hidden rounded-[22px] border border-white/10 bg-black/15">
                    <table className="min-w-full text-sm text-[#eadfd4]">
                      <thead className="bg-white/[0.04] text-[11px] font-semibold text-[#f0ddc9]">
                        <tr>
                          <th className="px-4 py-4 text-left">Reference</th>
                          <th className="px-4 py-4 text-left">Article</th>
                          <th className="px-4 py-4 text-left">Couleur</th>
                          <th className="px-4 py-4 text-left">Taille</th>
                          <th className="px-4 py-4 text-left">Quantite</th>
                          <th className="px-4 py-4 text-left">Prix unitaire</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(verifyOrder.items ?? []).map((item) => (
                          <tr key={item.id} className="border-t border-white/10">
                            <td className="px-4 py-4">{item.reference || "-"}</td>
                            <td className="px-4 py-4 text-white">{item.model || "-"}</td>
                            <td className="px-4 py-4">{item.color || "-"}</td>
                            <td className="px-4 py-4">{item.size || "-"}</td>
                            <td className="px-4 py-4">{item.quantity}</td>
                            <td className="px-4 py-4">{formatCurrency(item.unitPrice)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-white/10 bg-[#2a1f16]">
                          <td colSpan={5} className="px-4 py-4 font-semibold text-white">Total</td>
                          <td className="px-4 py-4 font-semibold text-white">{formatCurrency(verifyOrder.totalAmount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-5">
                    <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-5 py-4 text-right text-[15px] text-[#eadfd4]">
                      Date de livraison : <span className="font-semibold text-[#f4ddc7]">{formatCommandDate(verifyOrder.deliveryDate)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>
      ) : (
      <SectionCard
        title=""
        actions={(
          <div className="flex w-full justify-start">
            <div className="flex w-full max-w-[980px] flex-wrap items-center justify-start gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Recherche commande, ticket, client..."
                className="h-9 w-[270px] rounded-full border border-white/10 bg-black/20 px-4 text-[13px] text-white outline-none placeholder:text-[#a99684]"
              />
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-9 w-[150px] rounded-full border border-white/10 bg-black/20 px-4 text-[13px] text-white outline-none"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-9 w-[150px] rounded-full border border-white/10 bg-black/20 px-4 text-[13px] text-white outline-none"
              />
              <div className="flex items-center gap-2">
                <Button type="button" className="!h-9 !px-4 !text-[12px]" onClick={() => { setCurrentPage(1); void loadCurrentView(); }}>
                  Rechercher
                </Button>
                {view === "non_validated" && sessionScope !== "command_validation" ? (
                  <Button type="button" variant="secondary" className="!h-9 !px-4 !text-[12px] !bg-white/5 !text-white" onClick={() => openValidationModal(null)}>
                    Ajouter
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      >
        {view === "validated" ? (
          <div className="mb-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={validatedViewMode === "paid" ? "primary" : "secondary"}
                className={validatedViewMode === "paid" ? "!h-8 !px-3 !text-[12px]" : "!h-8 !px-3 !bg-white/5 !text-[12px] !text-white"}
                onClick={() => setValidatedViewMode("paid")}
              >
                Commandes payees
              </Button>
              <Button
                type="button"
                variant={validatedViewMode === "unpaid" ? "primary" : "secondary"}
                className={validatedViewMode === "unpaid" ? "!h-8 !px-3 !text-[12px]" : "!h-8 !px-3 !bg-white/5 !text-[12px] !text-white"}
                onClick={() => setValidatedViewMode("unpaid")}
              >
                Commandes non payees
              </Button>
              <Button
                type="button"
                variant={validatedViewMode === "recent" ? "primary" : "secondary"}
                className={validatedViewMode === "recent" ? "!h-8 !px-3 !text-[12px]" : "!h-8 !px-3 !bg-white/5 !text-[12px] !text-white"}
                onClick={() => setValidatedViewMode("recent")}
              >
                Commandes recemment validees
              </Button>
            </div>
            {validatedViewMode === "recent" ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-white/10 bg-black/10 px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  {validatedRecentAteliers.map((atelier) => (
                    <Button
                      key={atelier}
                      type="button"
                      variant={recentValidatedAtelier === atelier ? "primary" : "secondary"}
                      className={recentValidatedAtelier === atelier ? "!h-8 !px-3 !text-[12px]" : "!h-8 !px-3 !bg-white/5 !text-[12px] !text-white"}
                      onClick={() => setRecentValidatedAtelier(atelier)}
                    >
                      {atelier}
                    </Button>
                  ))}
                </div>
                <Button type="button" className="!h-8 !px-3 !text-[12px]" onClick={printRecentValidatedOrders}>
                  Imprimer le tableau
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {isWorkshopView ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              { id: "en_cours", label: "Commandes en cours" },
              { id: "retardees", label: "Commandes retardees" },
              { id: "annulees", label: "Commandes annulees" },
              { id: "en_stock", label: "Commandes en stock" },
              { id: "livrees", label: "Commandes livrees" }
            ].map((status) => (
              <Button
                key={status.id}
                type="button"
                variant={atelierStatusGroup === status.id ? "primary" : "secondary"}
                className={atelierStatusGroup === status.id ? "!h-8 !px-3 !text-[12px]" : "!h-8 !px-3 !bg-white/5 !text-[12px] !text-white"}
                onClick={() => setAtelierStatusGroup(status.id as AtelierStatusGroup)}
              >
                {status.label}
              </Button>
            ))}
          </div>
        ) : null}

        {view === "non_validated" ? (
          pendingOrders.length === 0 ? (
            <EmptyState title="Aucune commande non validee" description="Les commandes caisse a completer apparaitront ici." compact />
          ) : (
            <>
              <OrdersTable
                rows={pendingPage.rows}
                mode="pending"
                isAdminSession={isAdminSession}
                onPrimaryAction={(order) => openValidationModal(order)}
              />
              <PaginationControls currentPage={pendingPage.currentPage} totalPages={pendingPage.totalPages} onChange={setCurrentPage} />
            </>
          )
        ) : null}

        {view === "validated" ? (
          validatedViewMode === "recent" ? (
            recentValidatedOrders.length === 0 ? (
              <EmptyState title="Aucune commande recente" description="Les commandes recemment validees par atelier apparaitront ici." compact />
            ) : (
              <>
                <RecentValidatedOrdersTable rows={recentValidatedPage.rows} />
                <PaginationControls currentPage={recentValidatedPage.currentPage} totalPages={recentValidatedPage.totalPages} onChange={setCurrentPage} />
              </>
            )
          ) : validatedOrders.length === 0 ? (
            <EmptyState title="Aucune commande validee" description="Les commandes validees apparaitront ici." compact />
          ) : (
            <>
              <OrdersTable
                rows={validatedPage.rows}
                mode="validated"
                isAdminSession={isAdminSession}
                onPrimaryAction={(order) => {
                  if (isAdminSession) {
                    void openValidatedEditModal(order as ValidatedOrder);
                    return;
                  }
                  void openDetail(order.orderNumber);
                }}
              />
              <PaginationControls currentPage={validatedPage.currentPage} totalPages={validatedPage.totalPages} onChange={setCurrentPage} />
            </>
          )
        ) : null}

        {isWorkshopView ? (
          filteredLegacyOrders.length === 0 ? (
            <EmptyState title="Aucune commande" description="Aucune commande pour ce filtre." compact />
          ) : (
            <>
              <LegacyOrdersTable
                rows={legacyPage.rows}
                isVerifyView={false}
                onOpen={(orderNumber) => void openDetail(orderNumber)}
                onChangeStatus={(orderNumber, status) => void updateLegacyStatus(orderNumber, status)}
              />
              <PaginationControls currentPage={legacyPage.currentPage} totalPages={legacyPage.totalPages} onChange={setCurrentPage} />
            </>
          )
        ) : null}
      </SectionCard>
      )}

      {validationModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="flex h-[88vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-[28px] border border-orange-300/20 bg-[#16100b] shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-orange-200/70">Commande</p>
                <h3 className="text-2xl font-semibold text-white">Fiche commande</h3>
              </div>
              <Button type="button" variant="secondary" className="!h-10 !px-4 !bg-white/5 !text-white" onClick={() => setValidationModalOpen(false)}>
                Fermer
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[0.92fr_1.08fr]">
              <div className="min-h-0 overflow-y-auto border-r border-white/10 p-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Numero de commande">
                    <input
                      value={validationForm.orderNumber}
                      onChange={(event) => setValidationForm((current) => ({ ...current, orderNumber: event.target.value }))}
                      readOnly={isPosSourcedCommand}
                      className={isPosSourcedCommand ? "field-input field-input-locked" : "field-input"}
                    />
                  </Field>
                  <Field label="Date de livraison">
                    <input
                      type="date"
                      value={validationForm.deliveryDate}
                      onChange={(event) => setValidationForm((current) => ({ ...current, deliveryDate: event.target.value }))}
                      className="field-input"
                    />
                  </Field>
                  <Field label="Famille commande">
                    <input
                      value={validationForm.orderType}
                      onChange={(event) => setValidationForm((current) => ({ ...current, orderType: event.target.value }))}
                      readOnly={isPosSourcedCommand}
                      className={isPosSourcedCommand ? "field-input field-input-locked" : "field-input"}
                    />
                  </Field>
                  <Field label="Atelier">
                    <select
                      value={validationForm.workshopId}
                      onChange={(event) => setValidationForm((current) => ({ ...current, workshopId: event.target.value }))}
                      className="field-input"
                    >
                      <option value="">Choisir</option>
                      {workshopOptions.map((workshop) => (
                        <option key={workshop.id} value={String(workshop.id)}>{workshop.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Magasin">
                    <select
                      value={validationForm.storeId}
                      onChange={(event) => setValidationForm((current) => ({ ...current, storeId: event.target.value, vendorId: "" }))}
                      disabled={isPosSourcedCommand}
                      className={isPosSourcedCommand ? "field-input field-input-locked" : "field-input"}
                    >
                      <option value="">Choisir</option>
                      {storeOptions.map((store) => (
                        <option key={store.id} value={String(store.id)}>{store.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Vendeur">
                    <select
                      value={validationForm.vendorId}
                      onChange={(event) => setValidationForm((current) => ({ ...current, vendorId: event.target.value }))}
                      className="field-input"
                    >
                      <option value="">Choisir</option>
                      {vendorOptions.map((vendor) => (
                        <option key={vendor.id} value={String(vendor.id)}>{vendor.name}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Client</div>
                    <div className="grid grid-cols-[minmax(0,1.5fr)_auto] gap-2">
                      <select
                        value={validationForm.clientId}
                        onChange={(event) => setValidationForm((current) => ({ ...current, clientId: event.target.value }))}
                        className="field-input"
                      >
                        <option value="">Choisir</option>
                        {bootstrap?.legacy.clients.map((client) => (
                          <option key={client.id} value={String(client.id)}>{client.name}</option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="secondary"
                        className="!h-[42px] !w-[42px] !px-0 !bg-white/5 !text-white"
                        onClick={() => setClientModalOpen(true)}
                        title="Ajouter client"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="ml-auto max-w-[190px] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">
                      Statut paiement
                    </div>
                    <div className="ml-auto flex h-[42px] max-w-[190px] items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.04] px-3 text-center">
                      <Badge tone={paymentStatusTone}>{paymentStatusLabel}</Badge>
                    </div>
                  </div>
                  <Field label="Source caisse" className="md:col-span-2">
                    <input value={validationForm.sourceTicketNumber || "Ajout manuel"} readOnly className="field-input field-input-locked !text-[#d0c0b0]" />
                  </Field>
                  <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
                    <SummaryCard
                      label="Total de la commande"
                      value={formatCurrency(validationForm.sourceOrderTotal)}
                      hint=""
                    />
                    <SummaryCard
                      label="Ecart"
                      value={formatCurrency(sourceOrderGap)}
                      tone={Math.abs(sourceOrderGap) <= 0.009 ? "neutral" : sourceOrderGap > 0 ? "warning" : "danger"}
                      hint=""
                    />
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-col p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cdbfaf]">Articles</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="!h-9 !px-3 !bg-white/5 !text-[12px] !text-white"
                      onClick={() => setArticlePickerOpen(true)}
                    >
                      Ajouter article
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto rounded-[20px] border border-white/10 bg-black/15">
                  <table className="min-w-full text-sm text-[#eadfd4]">
                    <thead className="sticky top-0 bg-[#1f1712] text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">
                      <tr>
                        <th className="px-3 py-2 text-left">Reference</th>
                        <th className="px-3 py-2 text-left">Article</th>
                        <th className="px-3 py-2 text-right">Qte</th>
                        <th className="px-3 py-2 text-right">Prix</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validationForm.items.map((item) => (
                        <tr key={item.id} className="border-t border-white/10 align-top">
                          <td className="px-3 py-3 font-semibold text-white">{item.reference || "-"}</td>
                          <td className="px-3 py-3">
                            <div className="font-medium text-white">{item.model || "-"}</div>
                            <div className="mt-1 text-[11px] text-[#b9aa9c]">{[item.material, item.color, item.size].filter(Boolean).join(" • ") || "Article choisi depuis la liste"}</div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(event) => setValidationForm((current) => ({
                                ...current,
                                items: current.items.map((entry) => entry.id === item.id ? { ...entry, quantity: Number(event.target.value || 1) } : entry)
                              }))}
                              className="field-input ml-auto !h-9 !w-[64px] !rounded-[12px] !px-2 text-right"
                            />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <input
                              type="number"
                              min={0}
                              value={item.unitPrice}
                              onChange={(event) => setValidationForm((current) => ({
                                ...current,
                                items: current.items.map((entry) => entry.id === item.id ? { ...entry, unitPrice: Number(event.target.value || 0) } : entry)
                              }))}
                              className="field-input ml-auto !h-9 !w-[96px] !rounded-[12px] !px-2 text-right"
                            />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Button
                              type="button"
                              variant="secondary"
                              className="!h-8 !px-3 !bg-rose-500/10 !text-[12px] !text-rose-100"
                              onClick={() => setValidationForm((current) => ({
                                ...current,
                                items: current.items.filter((entry) => entry.id !== item.id)
                              }))}
                            >
                              Retirer
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {validationForm.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#b9aa9c]">
                            Aucun article ajoute.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
                  <div className="text-sm text-[#cdbfaf]">
                    Total commande :
                    <span className="ml-2 text-lg font-semibold text-white">
                      {formatCurrency(validationItemsTotal)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" className="!h-11 !px-4 !bg-white/5 !text-white" onClick={() => setValidationModalOpen(false)}>
                      Annuler
                    </Button>
                    <Button type="button" className="!h-11 !px-5" onClick={() => void submitValidation()} disabled={saving}>
                      {saving ? "Validation..." : "Valider"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {clientModalOpen ? (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-xl rounded-[26px] border border-orange-300/20 bg-[#16100b] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-200/70">Commande</p>
                <h3 className="text-2xl font-semibold text-white">Ajouter client</h3>
              </div>
              <Button type="button" variant="secondary" className="!h-10 !px-4 !bg-white/5 !text-white" onClick={() => setClientModalOpen(false)}>
                Fermer
              </Button>
            </div>
            <div className="mt-5 rounded-[20px] border border-white/10 bg-black/15 p-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Client existant</div>
              <input
                value={newClient.search}
                onChange={(event) => setNewClient((current) => ({ ...current, search: event.target.value }))}
                placeholder="Rechercher un client existant..."
                className="field-input"
              />
              <div className="mt-3 max-h-[180px] space-y-2 overflow-y-auto pr-1">
                {existingLegacyClients.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:bg-white/[0.05]"
                    onClick={() => selectExistingLegacyClient(client.id, client.name)}
                  >
                    <span className="text-sm text-white">{client.name}</span>
                    <span className="text-[11px] uppercase tracking-[0.16em] text-[#cdbfaf]">Choisir</span>
                  </button>
                ))}
                {existingLegacyClients.length === 0 ? (
                  <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-[#b9aa9c]">
                    Aucun client existant trouve.
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">Nouveau client</div>
              <Field label="Nom client">
                <input value={newClient.name} onChange={(event) => setNewClient((current) => ({ ...current, name: event.target.value }))} className="field-input" />
              </Field>
              <Field label="Telephone">
                <input value={newClient.phone} onChange={(event) => setNewClient((current) => ({ ...current, phone: event.target.value }))} className="field-input" />
              </Field>
              <Field label="Adresse">
                <input value={newClient.address} onChange={(event) => setNewClient((current) => ({ ...current, address: event.target.value }))} className="field-input" />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" className="!h-10 !px-4 !bg-white/5 !text-white" onClick={() => setClientModalOpen(false)}>
                Annuler
              </Button>
              <Button type="button" className="!h-10 !px-4" disabled={creatingClient} onClick={() => void createCommandClient()}>
                {creatingClient ? "Creation..." : "Ajouter client"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {articlePickerOpen ? (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-3xl rounded-[24px] border border-white/10 bg-[linear-gradient(135deg,rgba(39,39,39,0.97),rgba(28,20,13,0.97))] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-200/70">Commande</p>
                <h3 className="mt-1 text-[21px] font-semibold text-white">Ajouter un article</h3>
              </div>
              <button type="button" className="text-xl leading-none text-white/70 transition hover:text-white" onClick={() => setArticlePickerOpen(false)}>
                ×
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex min-h-[440px] flex-col">
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Reference</label>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input
                        tabIndex={1}
                        value={articleDraft.reference}
                        onChange={(event) => {
                          setArticleDraft((current) => ({ ...current, reference: event.target.value }));
                          setArticleSearch(event.target.value);
                        }}
                        placeholder="Reference"
                        className="h-10 rounded-[14px] border border-black/30 bg-[#171717] px-4 text-sm text-white outline-none"
                      />
                      <button
                        type="button"
                        tabIndex={10}
                        className="h-10 rounded-[14px] border border-white/10 bg-white/10 px-4 text-[13px] font-medium text-[#efe2d6] transition hover:bg-white/15"
                        onClick={() => {
                          setArticleSearch(articleDraft.reference);
                          setArticleSearchModalOpen(true);
                        }}
                      >
                        Rechercher
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Matiere & Couleurs</label>
                    <input
                      tabIndex={3}
                      value={articleDraft.materialAndColors}
                      onChange={(event) => setArticleDraft((current) => ({ ...current, materialAndColors: event.target.value }))}
                      placeholder="ex: Coton / Orange"
                      className="h-10 w-full rounded-[14px] border border-black/30 bg-[#171717] px-4 text-sm text-white outline-none placeholder:text-[#84776d]"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Quantite</label>
                    <input
                      type="number"
                      min={1}
                      tabIndex={5}
                      value={articleDraft.quantity}
                      onChange={(event) => setArticleDraft((current) => ({ ...current, quantity: event.target.value }))}
                      className="h-10 w-full rounded-[14px] border border-black/30 bg-[#171717] px-4 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <div className="mt-auto rounded-[16px] border border-white/10 bg-black/20 p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#cdbfaf]">Article choisi</div>
                  <div className="text-sm font-semibold text-white">{articleDraft.model || "Aucun article selectionne"}</div>
                  <div className="mt-1 text-xs text-[#b9aa9c]">
                    {articleDraft.reference || "-"}{articleDraft.unitPrice ? ` • ${formatCurrency(Number(articleDraft.unitPrice || 0))}` : ""}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Modele</label>
                  <input
                    tabIndex={2}
                    value={articleDraft.model}
                    onChange={(event) => setArticleDraft((current) => ({ ...current, model: event.target.value }))}
                    className="h-10 w-full rounded-[14px] border border-black/30 bg-[#171717] px-4 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Taille</label>
                  <input
                    tabIndex={4}
                    value={articleDraft.size}
                    onChange={(event) => setArticleDraft((current) => ({ ...current, size: event.target.value }))}
                    className="h-10 w-full rounded-[14px] border border-black/30 bg-[#171717] px-4 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Prix Unitaire (MAD)</label>
                  <input
                    type="number"
                    min={0}
                    tabIndex={6}
                    value={articleDraft.unitPrice}
                    onChange={(event) => setArticleDraft((current) => ({ ...current, unitPrice: event.target.value }))}
                    className="h-10 w-full rounded-[14px] border border-black/30 bg-[#171717] px-4 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Details</label>
                  <textarea
                    rows={2}
                    tabIndex={8}
                    value={articleDraft.details}
                    onChange={(event) => setArticleDraft((current) => ({ ...current, details: event.target.value }))}
                    className="min-h-[58px] w-full rounded-[14px] border border-black/30 bg-[#171717] px-4 py-3 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] text-[#d8c7b6]">Photo (optionnel)</label>
                  <div className="rounded-[14px] border border-black/30 bg-[#171717] px-3 py-3 text-white">
                    <input
                      type="file"
                      tabIndex={9}
                      onChange={(event) => setArticleDraft((current) => ({ ...current, photoName: event.target.files?.[0]?.name ?? "" }))}
                      className="w-full text-sm text-[#e7dccf] file:mr-3 file:rounded-[10px] file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-black"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                tabIndex={11}
                className="rounded-full border border-white/10 bg-[#171717] px-6 py-3 text-[15px] font-medium text-white transition hover:bg-white/5"
                onClick={() => setArticlePickerOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                tabIndex={7}
                className="rounded-full bg-[#ff8b1f] px-7 py-3 text-[15px] font-semibold text-white transition hover:bg-[#ff982f]"
                onClick={submitArticleDraft}
              >
                Ajouter
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {articleSearchModalOpen ? (
        <div className="fixed inset-0 z-[83] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#16100b] shadow-[0_26px_90px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-200/70">Commande</p>
                <h3 className="mt-1 text-[20px] font-semibold text-white">Rechercher un article</h3>
              </div>
              <button type="button" className="text-xl leading-none text-white/70 transition hover:text-white" onClick={() => setArticleSearchModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="p-5">
              <input
                value={articleSearch}
                onChange={(event) => setArticleSearch(event.target.value)}
                placeholder="Rechercher par reference ou article..."
                className="field-input"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              <div className="space-y-2">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.05]"
                    onClick={() => addProductToValidation(product)}
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{product.name}</div>
                      <div className="mt-1 text-xs text-[#cdbfaf]">{product.reference || "-"}</div>
                    </div>
                    <div className="text-sm font-semibold text-white">{formatCurrency(Number(product.salePriceTtc || 0))}</div>
                  </button>
                ))}
                {filteredProducts.length === 0 ? (
                  <div className="rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-[#b9aa9c]">
                    Aucun article trouve pour cette recherche.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailOrder ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-[#16100b] shadow-[0_26px_90px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cdbfaf]">Fiche commande</p>
                <h3 className="text-2xl font-semibold text-white">{detailOrder.orderNumber}</h3>
              </div>
              <Button type="button" variant="secondary" className="!h-10 !px-4 !bg-white/5 !text-white" onClick={() => setDetailOrder(null)}>
                Fermer
              </Button>
            </div>
            <div className="grid max-h-[calc(90vh-80px)] gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_1.2fr]">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <InfoRow label="Client" value={detailOrder.clientName || "-"} compact />
                <InfoRow label="Vendeur" value={detailOrder.vendorName || "-"} compact />
                <InfoRow label="Atelier" value={detailOrder.workshopName || "-"} compact />
                <InfoRow label="Boutique" value={detailOrder.storeName || "-"} compact />
                <InfoRow label="Type" value={detailOrder.commandType || "-"} compact />
                <InfoRow label="Statut" value={detailOrder.status || "-"} compact />
                <InfoRow label="Livraison" value={formatCommandDate(detailOrder.deliveryDate)} compact />
                <InfoRow label="Total" value={formatCurrency(detailOrder.totalAmount)} compact />
                <InfoRow label="Creee le" value={formatDateTime(detailOrder.createdAt)} compact />
              </div>
              <div className="space-y-3">
                <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#bda996]">Note</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-[#eadfd4]">{detailOrder.note || "-"}</div>
                </div>
                <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#bda996]">Historique des statuts</div>
                  <div className="mt-3 space-y-2">
                    {(detailOrder.statusHistory ?? []).length ? (
                      (detailOrder.statusHistory ?? []).map((entry) => (
                        <div key={entry.id} className="rounded-[14px] border border-white/10 bg-black/15 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">{entry.status || "-"}</div>
                            <div className="text-[11px] text-[#cdbfaf]">{formatDateTime(entry.createdAt)}</div>
                          </div>
                          <div className="mt-1 text-[12px] text-[#e6d7ca]">{entry.actorName || "Session non renseignee"}</div>
                          {entry.context ? <div className="mt-1 text-[11px] text-[#b9aa9c]">{entry.context}</div> : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[14px] border border-white/10 bg-black/15 px-3 py-4 text-sm text-[#b9aa9c]">
                        Aucun historique de statut disponible.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[20px] border border-white/10 bg-black/15">
                <table className="min-w-full text-sm text-[#eadfd4]">
                  <thead className="bg-[#1f1712] text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">
                    <tr>
                      <th className="px-3 py-2 text-left">Reference</th>
                      <th className="px-3 py-2 text-left">Article</th>
                      <th className="px-3 py-2 text-left">Infos</th>
                      <th className="px-3 py-2 text-right">Qte</th>
                      <th className="px-3 py-2 text-right">Prix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailOrder.items || []).map((item) => (
                      <tr key={item.id} className="border-t border-white/10 align-top">
                        <td className="px-3 py-3">{item.reference || "-"}</td>
                        <td className="px-3 py-3 font-medium text-white">{item.model || "-"}</td>
                        <td className="px-3 py-3 text-[12px] text-[#cdbfaf]">{[item.material, item.color, item.size, item.details].filter(Boolean).join(" • ") || "-"}</td>
                        <td className="px-3 py-3 text-right">{item.quantity}</td>
                        <td className="px-3 py-3 text-right">{formatCurrency(item.unitPrice * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .field-input {
          height: 42px;
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.1);
          background: rgba(255,255,255,.04);
          padding: 0 14px;
          color: #fff;
          outline: none;
        }
        .field-input-locked {
          background: rgba(255,255,255,.03);
          color: #d0c0b0;
          cursor: not-allowed;
        }
        .field-input-locked:disabled {
          opacity: 1;
        }
        textarea.field-input {
          height: auto;
          padding: 12px 14px;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
  className = ""
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`space-y-1.5 ${className}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdbfaf]">{label}</div>
      {children}
    </label>
  );
}

function InfoRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-[18px] border border-white/10 bg-white/[0.03] ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
      <div className={`${compact ? "text-[9px]" : "text-[11px]"} uppercase tracking-[0.18em] text-[#bda996]`}>{label}</div>
      <div className={`mt-1 font-medium text-white ${compact ? "text-[13px]" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = new Date(String(value)).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function escapeHtml(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "neutral"
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-300/20 bg-amber-500/10"
      : tone === "danger"
        ? "border-rose-300/20 bg-rose-500/10"
        : "border-white/10 bg-white/[0.03]";

  return (
    <div className={`rounded-[18px] border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-[#bda996]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
      {hint ? <div className="mt-1 text-[12px] text-[#cdbfaf]">{hint}</div> : null}
    </div>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  onChange
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        className="!h-8 !min-w-[36px] !px-2 !bg-white/5 !text-[12px] !text-white"
        onClick={() => onChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
      >
        {"<"}
      </Button>
      <div className="min-w-[84px] text-center text-[12px] text-[#cdbfaf]">
        {currentPage} / {totalPages}
      </div>
      <Button
        type="button"
        variant="secondary"
        className="!h-8 !min-w-[36px] !px-2 !bg-white/5 !text-[12px] !text-white"
        onClick={() => onChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
      >
        {">"}
      </Button>
    </div>
  );
}

function OrdersTable({
  rows,
  mode,
  isAdminSession,
  onPrimaryAction
}: {
  rows: Array<PendingOrder | ValidatedOrder>;
  mode: "pending" | "validated";
  isAdminSession: boolean;
  onPrimaryAction: (row: PendingOrder | ValidatedOrder) => void;
}) {
  return (
    <div className="overflow-auto rounded-[20px] border border-white/10 bg-black/15">
      <table className="min-w-full text-sm text-[#eadfd4]">
        <thead className="sticky top-0 bg-[#1f1712] text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">
          <tr>
            {mode === "validated" ? (
              <>
                <th className="px-3 py-2.5 text-left">N° Commande</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left">Vendeur</th>
              </>
            ) : (
              <>
                <th className="px-3 py-2.5 text-left">Commande</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left">Infos</th>
              </>
            )}
            <th className="px-3 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderNumber} className="border-t border-white/10 align-top hover:bg-white/[0.03]">
              {mode === "validated" ? (
                <>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-white">{row.orderNumber}</div>
                    <div className="mt-1 text-[11px] text-[#b9aa9c]">{formatDateTime(row.createdAt)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-orange-100">{row.orderType}</div>
                    <div className="mt-1"><Badge tone="success">Validee</Badge></div>
                  </td>
                  <td className="px-3 py-3 text-[12px] text-[#cdbfaf]">
                    <div className="text-white">{row.sellerName || "-"}</div>
                    <div className="mt-1">{row.warehouseName}</div>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-3">
                    <div className="text-[17px] font-semibold text-orange-100">{row.orderNumber}</div>
                    <div className="mt-1 text-[12px] font-medium text-white/90">{row.ticketNumbers.join(" / ")}</div>
                    <div className="mt-1 text-[11px] text-[#b9aa9c]">{formatDateTime(row.createdAt)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-[#f2e2d4]">{row.orderType}</div>
                    <div className="mt-1"><Badge tone="warning">A completer</Badge></div>
                  </td>
                  <td className="px-3 py-3 text-[12px] text-[#cdbfaf]">
                    <div>{row.warehouseName}</div>
                    <div className="mt-1">{row.customerName || "-"}</div>
                    <div className="mt-1">{row.sellerName || "-"}</div>
                  </td>
                </>
              )}
              <td className="px-3 py-3 text-right">
                <Button type="button" className="!h-9 !px-3 !text-[12px]" onClick={() => onPrimaryAction(row)}>
                  {mode === "pending" ? "Ouvrir fiche" : isAdminSession ? "Voir et modifier" : "Voir"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentValidatedOrdersTable({
  rows
}: {
  rows: ValidatedOrder[];
}) {
  return (
    <div className="overflow-auto rounded-[20px] border border-white/10 bg-black/15">
      <table className="min-w-full text-sm text-[#eadfd4]">
        <thead className="sticky top-0 bg-[#1f1712] text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">
          <tr>
            <th className="px-3 py-2.5 text-left">N° Commande</th>
            <th className="px-3 py-2.5 text-left">Vendeur</th>
            <th className="px-3 py-2.5 text-left">Observation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const observation = row.legacy?.note?.trim() || row.notes.find((note) => String(note || "").trim()) || "-";
            return (
              <tr key={`${row.orderNumber}-${row.createdAt}`} className="border-t border-white/10 align-top hover:bg-white/[0.03]">
                <td className="px-3 py-3">
                  <div className="font-semibold text-white">{row.orderNumber}</div>
                  <div className="mt-1 text-[11px] text-[#b9aa9c]">{formatDateTime(row.legacy?.createdAt || row.createdAt)}</div>
                </td>
                <td className="px-3 py-3 text-white">{row.sellerName || "-"}</td>
                <td className="px-3 py-3 text-[12px] text-[#d9c6b3]">{observation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LegacyOrdersTable({
  rows,
  isVerifyView,
  onOpen,
  onChangeStatus
}: {
  rows: LegacyOrder[];
  isVerifyView: boolean;
  onOpen: (orderNumber: string) => void;
  onChangeStatus: (orderNumber: string, status: string) => void;
}) {
  return (
    <div className="overflow-auto rounded-[20px] border border-white/10 bg-black/15">
      <table className="min-w-full text-sm text-[#eadfd4]">
        <thead className="sticky top-0 bg-[#1f1712] text-[10px] uppercase tracking-[0.18em] text-[#cdbfaf]">
          <tr>
            <th className="px-3 py-2.5 text-left">Commande</th>
            {isVerifyView ? <th className="px-3 py-2.5 text-left">Client</th> : null}
            <th className="px-3 py-2.5 text-left">Boutique</th>
            {isVerifyView ? <th className="px-3 py-2.5 text-left">Atelier</th> : null}
            <th className="px-3 py-2.5 text-left">Statut</th>
            <th className="px-3 py-2.5 text-right">Total</th>
            <th className="px-3 py-2.5 text-left">Livraison</th>
            <th className="px-3 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderNumber} className="border-t border-white/10 align-top hover:bg-white/[0.03]">
              <td className="px-3 py-3">
                <div className="font-semibold text-white">{row.orderNumber}</div>
                <div className="mt-1 text-[11px] text-[#b9aa9c]">{formatDateTime(row.createdAt)}</div>
                <div className="mt-1 text-[11px] text-[#d9c6b3]">{row.commandType}</div>
              </td>
              {isVerifyView ? <td className="px-3 py-3">{row.clientName || "-"}</td> : null}
              <td className="px-3 py-3">
                <div className="text-white">{row.vendorName || "-"}</div>
                <div className="mt-1 text-[12px] text-[#cdbfaf]">{row.storeName || "-"}</div>
              </td>
              {isVerifyView ? <td className="px-3 py-3">{row.workshopName || "-"}</td> : null}
              <td className="px-3 py-3">
                <div className="mb-2">
                  <Badge tone={row.statusKey === "annulee" ? "danger" : row.statusKey === "retardee" ? "warning" : row.statusKey === "livree" ? "success" : "neutral"}>
                    {row.status}
                  </Badge>
                </div>
                {!isVerifyView ? (
                  <select
                    defaultValue=""
                    className="h-9 rounded-full border border-white/10 bg-white/[0.05] px-3 text-[12px] text-white"
                    onChange={(event) => {
                      if (!event.target.value) return;
                      void onChangeStatus(row.orderNumber, event.target.value);
                      event.target.value = "";
                    }}
                  >
                    <option value="">Changer</option>
                    <option value="en_fabrication">En fabrication</option>
                    <option value="retardee">Retardee</option>
                    <option value="en_stock">En stock</option>
                    <option value="livree">Livree</option>
                    <option value="annulee">Annulee</option>
                  </select>
                ) : null}
              </td>
              <td className="px-3 py-3 text-right font-semibold text-white">{formatCurrency(row.totalAmount)}</td>
              <td className="px-3 py-3">{formatCommandDate(row.deliveryDate)}</td>
              <td className="px-3 py-3 text-right">
                <Button type="button" className="!h-9 !px-3 !text-[12px]" onClick={() => onOpen(row.orderNumber)}>
                  Ouvrir
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

