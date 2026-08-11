import { useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  CheckCircle2,
  ClipboardList,
  FileDown,
  FileSpreadsheet,
  Filter,
  PackageSearch,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck
} from "lucide-react";
import { api } from "../../lib/api";
import { cn, formatCurrency, formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select, Textarea } from "../../components/ui/primitives";

type LookupOption = { id: string; name: string };
type WarehouseOption = { id: string; name: string; code: string; type: string };
type InventoryMethod = "COMPLETE" | "CATEGORY" | "REFERENCE" | "TYPE" | "LOCATION" | "PARTIAL" | "CYCLE";
type InventoryStatus = "DRAFT" | "IN_PROGRESS" | "PENDING_VALIDATION" | "VALIDATED" | "CANCELLED";
type InventoryItemStatus = "PENDING" | "COUNTED" | "MATCHED" | "EXCESS" | "SHORTAGE";

type InventorySummary = {
  totalArticles: number;
  theoreticalTotal: number;
  countedTotal: number;
  positiveDifferenceQty: number;
  negativeDifferenceQty: number;
  positiveDifferencesCount: number;
  negativeDifferencesCount: number;
  differenceValueTotal: number;
  matchingItems: number;
  byCategory: Array<{ label: string; theoreticalQty: number; countedQty: number; differenceQty: number; differenceValue: number; itemsCount: number }>;
  byType: Array<{ label: string; theoreticalQty: number; countedQty: number; differenceQty: number; differenceValue: number; itemsCount: number }>;
  byLocation: Array<{ label: string; theoreticalQty: number; countedQty: number; differenceQty: number; differenceValue: number; itemsCount: number }>;
};

type InventoryRow = {
  id: string;
  reference: string;
  title: string;
  type: InventoryMethod;
  status: InventoryStatus;
  scope?: string | null;
  notes?: string | null;
  allowCashierCounting: boolean;
  startedAt: string;
  validatedAt?: string | null;
  createdAt: string;
  createdBy?: { id: string; fullName: string } | null;
  validatedBy?: { id: string; fullName: string } | null;
  summary: InventorySummary;
};

type InventoryListPayload = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  rows: InventoryRow[];
};

type InventoryItemRow = {
  id: string;
  inventoryId: string;
  productId: string;
  productVariantId?: string | null;
  warehouseId?: string | null;
  productReference: string;
  barcode?: string | null;
  productName: string;
  category?: string | null;
  type?: string | null;
  brand?: string | null;
  color?: string | null;
  size?: string | null;
  location?: string | null;
  theoreticalQty: number;
  countedQty?: number | null;
  differenceQty: number;
  unitCost?: number | null;
  differenceValue?: number | null;
  status: InventoryItemStatus;
  notes?: string | null;
};

type InventoryDetailPayload = {
  id: string;
  reference: string;
  title: string;
  type: InventoryMethod;
  status: InventoryStatus;
  scope?: string | null;
  notes?: string | null;
  allowCashierCounting: boolean;
  startedAt: string;
  validatedAt?: string | null;
  createdBy?: { id: string; fullName: string } | null;
  validatedBy?: { id: string; fullName: string } | null;
  summary: InventorySummary;
  logs: InventoryLogRow[];
};

type InventoryItemsPayload = {
  inventory: {
    id: string;
    reference: string;
    title: string;
    status: InventoryStatus;
    type: InventoryMethod;
    allowCashierCounting: boolean;
  };
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  summary: InventorySummary;
  rows: InventoryItemRow[];
};

type InventoryLogRow = {
  id: string;
  action: string;
  createdAt: string;
  ipAddress?: string | null;
  user?: { id: string; fullName: string; email?: string | null } | null;
  oldValue?: unknown;
  newValue?: unknown;
};

type InventoryReportPayload = {
  inventory: Omit<InventoryDetailPayload, "summary" | "logs">;
  summary: InventorySummary;
  compliantItems: InventoryItemRow[];
  differenceItems: InventoryItemRow[];
  logs: InventoryLogRow[];
};

type BootstrapPayload = {
  canManage: boolean;
  canValidate: boolean;
  methods: InventoryMethod[];
  statuses: InventoryStatus[];
  itemStatuses: InventoryItemStatus[];
  filters: {
    categories: LookupOption[];
    types: LookupOption[];
    brands: LookupOption[];
    colors: string[];
    sizes: string[];
    warehouses: WarehouseOption[];
  };
};

type InventoryFilters = {
  search: string;
  status: "" | InventoryStatus;
  type: "" | InventoryMethod;
  page: number;
};

type ItemFilters = {
  search: string;
  category: string;
  type: string;
  brand: string;
  color: string;
  size: string;
  warehouseId: string;
  status: "" | InventoryItemStatus;
  withDifferenceOnly: boolean;
  page: number;
};

type CreateInventoryForm = {
  title: string;
  type: InventoryMethod;
  scope: string;
  notes: string;
  allowCashierCounting: boolean;
  search: string;
  categoryId: string;
  typeId: string;
  brandId: string;
  color: string;
  size: string;
  warehouseId: string;
  status: "" | "ACTIVE" | "INACTIVE";
};

type LocalDraft = {
  countedQty: string;
  notes: string;
  saving: boolean;
};

function formatInventoryMethod(value: InventoryMethod) {
  switch (value) {
    case "COMPLETE":
      return "Inventaire complet";
    case "CATEGORY":
      return "Par categorie";
    case "REFERENCE":
      return "Par reference";
    case "TYPE":
      return "Par type";
    case "LOCATION":
      return "Par emplacement";
    case "PARTIAL":
      return "Partiel";
    case "CYCLE":
      return "Tournant";
    default:
      return value;
  }
}

function formatInventoryStatus(value: InventoryStatus) {
  switch (value) {
    case "DRAFT":
      return "Brouillon";
    case "IN_PROGRESS":
      return "En cours";
    case "PENDING_VALIDATION":
      return "En attente de validation";
    case "VALIDATED":
      return "Valide";
    case "CANCELLED":
      return "Annule";
    default:
      return value;
  }
}

function formatItemStatus(value: InventoryItemStatus) {
  switch (value) {
    case "PENDING":
      return "A compter";
    case "COUNTED":
      return "Compte";
    case "MATCHED":
      return "Conforme";
    case "EXCESS":
      return "Ecart +";
    case "SHORTAGE":
      return "Ecart -";
    default:
      return value;
  }
}

function toneForInventoryStatus(value: InventoryStatus): "neutral" | "success" | "warning" | "danger" {
  switch (value) {
    case "VALIDATED":
      return "success";
    case "PENDING_VALIDATION":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

function toneForItemStatus(value: InventoryItemStatus): "neutral" | "success" | "warning" | "danger" {
  switch (value) {
    case "MATCHED":
      return "success";
    case "EXCESS":
      return "warning";
    case "SHORTAGE":
      return "danger";
    default:
      return "neutral";
  }
}

function buildInitialCreateForm(methods: InventoryMethod[]): CreateInventoryForm {
  return {
    title: "",
    type: methods[0] ?? "COMPLETE",
    scope: "",
    notes: "",
    allowCashierCounting: false,
    search: "",
    categoryId: "",
    typeId: "",
    brandId: "",
    color: "",
    size: "",
    warehouseId: "",
    status: "ACTIVE"
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanInventoryText(value?: string | null) {
  if (!value) return "-";
  return value
    .replaceAll("D�p�t", "Dépôt")
    .replaceAll("DÃ©pÃ´t", "Dépôt")
    .replaceAll("Boutiqu�", "Boutiqué")
    .replaceAll("Centr�l", "Central");
}

export function InventoryCountingPage({ countingOnly = false }: { countingOnly?: boolean }) {
  const { user } = useAuth();
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [inventories, setInventories] = useState<InventoryListPayload | null>(null);
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>("");
  const [selectedInventory, setSelectedInventory] = useState<InventoryDetailPayload | null>(null);
  const [itemsPayload, setItemsPayload] = useState<InventoryItemsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "warning" | "danger"; message: string } | null>(null);
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilters>({
    search: "",
    status: "",
    type: "",
    page: 1
  });
  const [itemFilters, setItemFilters] = useState<ItemFilters>({
    search: "",
    category: "",
    type: "",
    brand: "",
    color: "",
    size: "",
    warehouseId: "",
    status: "",
    withDifferenceOnly: false,
    page: 1
  });
  const [createForm, setCreateForm] = useState<CreateInventoryForm>(buildInitialCreateForm(["COMPLETE"]));
  const [localDrafts, setLocalDrafts] = useState<Record<string, LocalDraft>>({});
  const saveTimersRef = useRef<Record<string, number>>({});

  const canManage = bootstrap?.canManage ?? false;
  const canValidate = bootstrap?.canValidate ?? false;
  const canCountCurrentInventory = useMemo(() => {
    if (!selectedInventory) return false;
    if (canManage) return true;
    return selectedInventory.allowCashierCounting;
  }, [canManage, selectedInventory]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function loadBootstrap() {
    const data = await api<BootstrapPayload>("/inventories/bootstrap");
    setBootstrap(data);
    setCreateForm((current) => {
      if (current.title || current.scope || current.search || current.categoryId || current.typeId || current.brandId || current.color || current.size || current.warehouseId) {
        return current;
      }
      return buildInitialCreateForm(data.methods);
    });
    return data;
  }

  async function loadInventories(filters = inventoryFilters, withSpinner = true) {
    if (withSpinner) setListLoading(true);
    const params = new URLSearchParams({
      page: String(filters.page),
      perPage: "12"
    });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.status) params.set("status", filters.status);
    if (filters.type) params.set("type", filters.type);
    const data = await api<InventoryListPayload>(`/inventories?${params.toString()}`);
    setInventories(data);
    if (!selectedInventoryId && data.rows[0]) {
      setSelectedInventoryId(data.rows[0].id);
    } else if (selectedInventoryId && !data.rows.some((row) => row.id === selectedInventoryId) && data.rows[0]) {
      setSelectedInventoryId(data.rows[0].id);
    }
    if (withSpinner) setListLoading(false);
    return data;
  }

  async function loadInventoryDetail(inventoryId: string, withSpinner = true) {
    if (!inventoryId) {
      setSelectedInventory(null);
      return null;
    }
    if (withSpinner) setDetailLoading(true);
    const data = await api<InventoryDetailPayload>(`/inventories/${inventoryId}`);
    setSelectedInventory(data);
    if (withSpinner) setDetailLoading(false);
    return data;
  }

  async function loadInventoryItems(inventoryId: string, filters = itemFilters, withSpinner = true) {
    if (!inventoryId) {
      setItemsPayload(null);
      return null;
    }
    if (withSpinner) setDetailLoading(true);
    const params = new URLSearchParams({
      page: String(filters.page),
      perPage: countingOnly ? "18" : "25"
    });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.category) params.set("category", filters.category);
    if (filters.type) params.set("type", filters.type);
    if (filters.brand) params.set("brand", filters.brand);
    if (filters.color) params.set("color", filters.color);
    if (filters.size) params.set("size", filters.size);
    if (filters.warehouseId) params.set("warehouseId", filters.warehouseId);
    if (filters.status) params.set("status", filters.status);
    if (filters.withDifferenceOnly) params.set("withDifferenceOnly", "true");
    const data = await api<InventoryItemsPayload>(`/inventories/${inventoryId}/items?${params.toString()}`);
    setItemsPayload(data);
    if (withSpinner) setDetailLoading(false);
    return data;
  }

  async function refreshCurrentInventory(withSpinner = false) {
    if (!selectedInventoryId) return;
    await Promise.all([
      loadInventories(inventoryFilters, withSpinner),
      loadInventoryDetail(selectedInventoryId, withSpinner),
      loadInventoryItems(selectedInventoryId, itemFilters, withSpinner)
    ]);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const boot = await loadBootstrap();
        if (!mounted) return;
        await loadInventories(inventoryFilters, true);
        if (!mounted) return;
        if (!countingOnly && boot.filters.warehouses.length === 1) {
          setCreateForm((current) => ({ ...current, warehouseId: boot.filters.warehouses[0]?.id ?? "" }));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })().catch((error: unknown) => {
      console.error(error);
      if (mounted) {
        setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur inventaire" });
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedInventoryId) return;
    void Promise.all([
      loadInventoryDetail(selectedInventoryId, true),
      loadInventoryItems(selectedInventoryId, itemFilters, true)
    ]).catch((error: unknown) => {
      console.error(error);
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur inventaire" });
      setDetailLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInventoryId]);

  useEffect(() => {
    if (!bootstrap) return;
    void loadInventories(inventoryFilters, true).catch((error: unknown) => {
      console.error(error);
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur inventaire" });
      setListLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, inventoryFilters.page]);

  useEffect(() => {
    if (!selectedInventoryId) return;
    void loadInventoryItems(selectedInventoryId, itemFilters, true).catch((error: unknown) => {
      console.error(error);
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur inventaire" });
      setDetailLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInventoryId, itemFilters.page]);

  useEffect(() => {
    if (!bootstrap) return;
    const timeout = window.setTimeout(() => {
      void loadInventories({ ...inventoryFilters, page: 1 }, false).catch((error: unknown) => {
        console.error(error);
        setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur inventaire" });
      });
    }, 260);
    return () => window.clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, inventoryFilters.search, inventoryFilters.status, inventoryFilters.type]);

  useEffect(() => {
    if (!selectedInventoryId) return;
    const timeout = window.setTimeout(() => {
      void loadInventoryItems(selectedInventoryId, { ...itemFilters, page: 1 }, false).catch((error: unknown) => {
        console.error(error);
        setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur inventaire" });
      });
    }, 260);
    return () => window.clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedInventoryId,
    itemFilters.search,
    itemFilters.category,
    itemFilters.type,
    itemFilters.brand,
    itemFilters.color,
    itemFilters.size,
    itemFilters.warehouseId,
    itemFilters.status,
    itemFilters.withDifferenceOnly
  ]);

  function queueItemAutosave(itemId: string) {
    if (saveTimersRef.current[itemId]) {
      window.clearTimeout(saveTimersRef.current[itemId]);
    }

    saveTimersRef.current[itemId] = window.setTimeout(() => {
      void persistItemDraft(itemId);
    }, 650);
  }

  async function persistItemDraft(itemId: string) {
    if (!selectedInventoryId) return;
    const draft = localDrafts[itemId];
    const item = itemsPayload?.rows.find((row) => row.id === itemId);
    if (!draft || !item) return;

    setLocalDrafts((current) => ({
      ...current,
      [itemId]: {
        ...current[itemId],
        saving: true
      }
    }));

    try {
      const rawValue = draft.countedQty.trim();
      const countedQty = rawValue === "" ? null : Number(rawValue);
      if (rawValue !== "" && !Number.isFinite(countedQty)) {
        throw new Error("Quantite comptee invalide.");
      }

      await api<InventoryItemRow>(`/inventories/${selectedInventoryId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          countedQty,
          notes: draft.notes
        })
      });

      setToast({ tone: "success", message: `Ligne ${item.productReference} sauvegardee.` });
      await Promise.all([
        loadInventoryDetail(selectedInventoryId, false),
        loadInventoryItems(selectedInventoryId, itemFilters, false),
        loadInventories(inventoryFilters, false)
      ]);
      setLocalDrafts((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur de sauvegarde" });
      setLocalDrafts((current) => ({
        ...current,
        [itemId]: {
          ...current[itemId],
          saving: false
        }
      }));
    }
  }

  async function createInventory() {
    if (!bootstrap) return;
    setSaving(true);
    try {
      const created = await api<InventoryRow>("/inventories", {
        method: "POST",
        body: JSON.stringify({
          title: createForm.title,
          type: createForm.type,
          scope: createForm.scope,
          notes: createForm.notes,
          allowCashierCounting: createForm.allowCashierCounting,
          filters: {
            search: createForm.search || null,
            categoryId: createForm.categoryId || null,
            typeId: createForm.typeId || null,
            brandId: createForm.brandId || null,
            color: createForm.color || null,
            size: createForm.size || null,
            warehouseId: createForm.warehouseId || null,
            status: createForm.status || null
          }
        })
      });
      setCreateModalOpen(false);
      setCreateForm(buildInitialCreateForm(bootstrap.methods));
      setToast({ tone: "success", message: `Inventaire ${created.reference} cree.` });
      await loadInventories({ ...inventoryFilters, page: 1 }, false);
      setSelectedInventoryId(created.id);
      await Promise.all([
        loadInventoryDetail(created.id, false),
        loadInventoryItems(created.id, { ...itemFilters, page: 1 }, false)
      ]);
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur de creation" });
    } finally {
      setSaving(false);
    }
  }

  async function submitForValidation() {
    if (!selectedInventoryId) return;
    setSaving(true);
    try {
      await api(`/inventories/${selectedInventoryId}/submit`, { method: "POST" });
      setToast({ tone: "success", message: "Inventaire envoye pour validation." });
      await refreshCurrentInventory(false);
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur de validation" });
    } finally {
      setSaving(false);
    }
  }

  async function validateInventory() {
    if (!selectedInventoryId) return;
    const confirmed = window.confirm("Confirmer la validation finale de cet inventaire ? Le stock reel sera mis a jour apres cette action.");
    if (!confirmed) return;
    setSaving(true);
    try {
      await api(`/inventories/${selectedInventoryId}/validate`, {
        method: "POST",
        body: JSON.stringify({ confirmation: true })
      });
      setToast({ tone: "success", message: "Inventaire valide et stock mis a jour." });
      await refreshCurrentInventory(false);
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur de validation finale" });
    } finally {
      setSaving(false);
    }
  }

  async function cancelInventory() {
    if (!selectedInventoryId) return;
    const confirmed = window.confirm("Annuler cet inventaire ? Les brouillons de comptage seront conserves dans l'historique.");
    if (!confirmed) return;
    setSaving(true);
    try {
      await api(`/inventories/${selectedInventoryId}/cancel`, { method: "POST" });
      setToast({ tone: "warning", message: "Inventaire annule." });
      await refreshCurrentInventory(false);
    } catch (error) {
      setToast({ tone: "danger", message: error instanceof Error ? error.message : "Erreur d'annulation" });
    } finally {
      setSaving(false);
    }
  }

  async function fetchCurrentReport() {
    if (!selectedInventoryId) throw new Error("Aucun inventaire selectionne.");
    return api<InventoryReportPayload>(`/inventories/${selectedInventoryId}/report`);
  }

  async function printReport(mode: "full" | "simple" | "pdf") {
    const report = await fetchCurrentReport();
    const printWindow = window.open("", "_blank", "width=1180,height=900");
    if (!printWindow) {
      setToast({ tone: "danger", message: "Autorise l'ouverture de fenetre pour imprimer le rapport." });
      return;
    }

    const groupedRows = mode === "simple" ? report.differenceItems : [...report.differenceItems, ...report.compliantItems];
    const rowsHtml = groupedRows.map((item) => `
      <tr>
        <td>${escapeHtml(item.productReference)}</td>
        <td>${escapeHtml(item.productName)}</td>
        <td>${escapeHtml(item.location || "-")}</td>
        <td style="text-align:right;">${formatNumber(item.theoreticalQty)}</td>
        <td style="text-align:right;">${formatNumber(item.countedQty ?? 0)}</td>
        <td style="text-align:right;">${formatNumber(item.differenceQty)}</td>
        <td style="text-align:right;">${formatCurrency(Number(item.differenceValue ?? 0))}</td>
        <td>${escapeHtml(item.status === "MATCHED" ? "Conforme" : formatItemStatus(item.status))}</td>
      </tr>
    `).join("");

    const categoryRows = report.summary.byCategory.map((row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td style="text-align:right;">${formatNumber(row.theoreticalQty)}</td>
        <td style="text-align:right;">${formatNumber(row.countedQty)}</td>
        <td style="text-align:right;">${formatNumber(row.differenceQty)}</td>
        <td style="text-align:right;">${formatCurrency(row.differenceValue)}</td>
      </tr>
    `).join("");
    const typeRows = report.summary.byType.map((row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td style="text-align:right;">${formatNumber(row.theoreticalQty)}</td>
        <td style="text-align:right;">${formatNumber(row.countedQty)}</td>
        <td style="text-align:right;">${formatNumber(row.differenceQty)}</td>
        <td style="text-align:right;">${formatCurrency(row.differenceValue)}</td>
      </tr>
    `).join("");
    const locationRows = report.summary.byLocation.map((row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td style="text-align:right;">${formatNumber(row.theoreticalQty)}</td>
        <td style="text-align:right;">${formatNumber(row.countedQty)}</td>
        <td style="text-align:right;">${formatNumber(row.differenceQty)}</td>
        <td style="text-align:right;">${formatCurrency(row.differenceValue)}</td>
      </tr>
    `).join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>${escapeHtml(report.inventory.reference)} - Rapport inventaire</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 22px; color: #2e241d; background: #f8f4ef; }
            .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 16mm 15mm; box-sizing: border-box; }
            .eyebrow { font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: #9a6b36; }
            h1 { margin: 10px 0 6px; font-size: 28px; }
            h2 { margin: 22px 0 10px; font-size: 18px; }
            .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
            .card { border: 1px solid #d8c2ad; border-radius: 14px; padding: 10px 12px; background: #fbf7f2; }
            .label { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #8c6d52; }
            .value { margin-top: 6px; font-size: 16px; font-weight: 700; color: #2c1f16; }
            .summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { text-align: left; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #7f6146; background: #f5ece2; padding: 10px 8px; border-bottom: 1px solid #dbc9b7; }
            td { padding: 9px 8px; border-bottom: 1px solid #eee2d5; font-size: 13px; vertical-align: top; }
            .footer-note { margin-top: 22px; font-size: 12px; color: #7b6653; }
            @media print {
              body { background: white; padding: 0; }
              .sheet { margin: 0; padding: 14mm 12mm; box-shadow: none; }
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="eyebrow">Galerie des Tanneurs / Inventaire</div>
            <h1>Rapport d'inventaire</h1>
            <p>Reference : <strong>${escapeHtml(report.inventory.reference)}</strong> &nbsp;|&nbsp; Debut : <strong>${escapeHtml(formatDateTime(report.inventory.startedAt))}</strong> &nbsp;|&nbsp; Validation : <strong>${report.inventory.validatedAt ? escapeHtml(formatDateTime(report.inventory.validatedAt)) : "-"}</strong></p>
            <div class="meta">
              <div class="card"><div class="label">Responsable</div><div class="value">${escapeHtml(report.inventory.createdBy?.fullName || "-")}</div></div>
              <div class="card"><div class="label">Validateur</div><div class="value">${escapeHtml(report.inventory.validatedBy?.fullName || "-")}</div></div>
              <div class="card"><div class="label">Methode</div><div class="value">${escapeHtml(formatInventoryMethod(report.inventory.type))}</div></div>
              <div class="card"><div class="label">Perimetre</div><div class="value">${escapeHtml(report.inventory.scope || "-")}</div></div>
            </div>
            <div class="summary-grid">
              <div class="card"><div class="label">Articles controles</div><div class="value">${formatNumber(report.summary.totalArticles)}</div></div>
              <div class="card"><div class="label">Stock theorique</div><div class="value">${formatNumber(report.summary.theoreticalTotal)}</div></div>
              <div class="card"><div class="label">Stock compte</div><div class="value">${formatNumber(report.summary.countedTotal)}</div></div>
              <div class="card"><div class="label">Ecarts +</div><div class="value">${formatNumber(report.summary.positiveDifferenceQty)}</div></div>
              <div class="card"><div class="label">Ecarts -</div><div class="value">${formatNumber(report.summary.negativeDifferenceQty)}</div></div>
            </div>
            <div class="summary-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
              <div class="card"><div class="label">Valeur ecarts</div><div class="value">${formatCurrency(report.summary.differenceValueTotal)}</div></div>
              <div class="card"><div class="label">Articles conformes</div><div class="value">${formatNumber(report.summary.matchingItems)}</div></div>
              <div class="card"><div class="label">Ecarts positifs</div><div class="value">${formatNumber(report.summary.positiveDifferencesCount)}</div></div>
              <div class="card"><div class="label">Ecarts negatifs</div><div class="value">${formatNumber(report.summary.negativeDifferencesCount)}</div></div>
            </div>
            <h2>${mode === "simple" ? "Controle interne - Articles avec ecart" : "Lignes d'inventaire"}</h2>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Article</th>
                  <th>Emplacement</th>
                  <th style="text-align:right;">Theo.</th>
                  <th style="text-align:right;">Compte</th>
                  <th style="text-align:right;">Ecart</th>
                  <th style="text-align:right;">Valeur</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <h2>Detail par categorie</h2>
            <table>
              <thead>
                <tr>
                  <th>Categorie</th>
                  <th style="text-align:right;">Theo.</th>
                  <th style="text-align:right;">Compte</th>
                  <th style="text-align:right;">Ecart</th>
                  <th style="text-align:right;">Valeur</th>
                </tr>
              </thead>
              <tbody>${categoryRows}</tbody>
            </table>
            <h2>Detail par type</h2>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th style="text-align:right;">Theo.</th>
                  <th style="text-align:right;">Compte</th>
                  <th style="text-align:right;">Ecart</th>
                  <th style="text-align:right;">Valeur</th>
                </tr>
              </thead>
              <tbody>${typeRows}</tbody>
            </table>
            <h2>Detail par emplacement</h2>
            <table>
              <thead>
                <tr>
                  <th>Emplacement</th>
                  <th style="text-align:right;">Theo.</th>
                  <th style="text-align:right;">Compte</th>
                  <th style="text-align:right;">Ecart</th>
                  <th style="text-align:right;">Valeur</th>
                </tr>
              </thead>
              <tbody>${locationRows}</tbody>
            </table>
            <div class="footer-note">Rapport genere le ${escapeHtml(formatDateTime(new Date()))}.</div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    if (mode === "pdf") {
      setTimeout(() => printWindow.print(), 250);
      return;
    }
    setTimeout(() => printWindow.print(), 250);
  }

  async function exportExcel() {
    const report = await fetchCurrentReport();
    const lines = [
      ["Reference inventaire", report.inventory.reference],
      ["Titre", report.inventory.title],
      ["Date debut", formatDateTime(report.inventory.startedAt)],
      ["Date validation", report.inventory.validatedAt ? formatDateTime(report.inventory.validatedAt) : ""],
      ["Responsable", report.inventory.createdBy?.fullName ?? ""],
      ["Validateur", report.inventory.validatedBy?.fullName ?? ""],
      ["Type", formatInventoryMethod(report.inventory.type)],
      ["Perimetre", report.inventory.scope ?? ""],
      [],
      ["Articles controles", report.summary.totalArticles],
      ["Stock theorique total", report.summary.theoreticalTotal],
      ["Stock compte total", report.summary.countedTotal],
      ["Ecarts positifs", report.summary.positiveDifferenceQty],
      ["Ecarts negatifs", report.summary.negativeDifferenceQty],
      ["Valeur totale des ecarts", report.summary.differenceValueTotal],
      []
    ];

    const detailHeader = ["Reference", "Code-barres", "Article", "Categorie", "Type", "Marque", "Couleur", "Taille", "Emplacement", "Theo", "Compte", "Ecart", "Valeur ecart", "Statut"];
    const detailRows = [...report.differenceItems, ...report.compliantItems].map((item) => [
      item.productReference,
      item.barcode ?? "",
      item.productName,
      item.category ?? "",
      item.type ?? "",
      item.brand ?? "",
      item.color ?? "",
      item.size ?? "",
      item.location ?? "",
      item.theoreticalQty,
      item.countedQty ?? "",
      item.differenceQty,
      Number(item.differenceValue ?? 0),
      formatItemStatus(item.status)
    ]);

    const csvContent = [...lines, detailHeader, ...detailRows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll("\"", "\"\"")}"`).join(";"))
      .join("\n");

    const blob = new Blob([`\ufeff${csvContent}`], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.inventory.reference}-rapport-inventaire.xls`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  if (loading) {
    return <LoadingBlock label="Chargement de l'espace inventaire..." />;
  }

  const inventoryCards = inventories?.rows ?? [];
  const selectedRow = inventoryCards.find((row) => row.id === selectedInventoryId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={countingOnly ? "Stock / Saisie autorisee" : "Stock / Inventaire"}
        title={countingOnly ? "Comptage inventaire" : ""}
        titleClassName={countingOnly ? "md:text-[2rem]" : "md:text-[2.2rem]"}
        description={
          countingOnly
            ? "Saisie rapide des quantites comptees sur les inventaires autorises, avec enregistrement automatique."
            : undefined
        }
        actions={!countingOnly && canManage ? (
          <Button className="!px-4 !py-2.5 text-sm" onClick={() => setCreateModalOpen(true)}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Nouvel inventaire
          </Button>
        ) : undefined}
      />

      {toast ? (
        <div className={cn(
          "fixed right-6 top-6 z-40 max-w-md rounded-[22px] border px-4 py-3 shadow-[0_22px_60px_rgba(0,0,0,0.28)]",
          toast.tone === "success" ? "border-emerald-300/25 bg-emerald-500/15 text-emerald-50" : toast.tone === "warning" ? "border-orange-300/25 bg-orange-400/15 text-orange-50" : "border-rose-300/25 bg-rose-500/15 text-rose-50"
        )}>
          <div className="flex items-start gap-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{toast.message}</span>
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        <SectionCard
          title={countingOnly ? "Inventaires autorises" : "Sessions d'inventaire"}
          description={countingOnly ? "Le caissier ne peut saisir que les inventaires actives et autorises." : "Retrouve, filtre et reprends rapidement un inventaire en brouillon, en cours ou en attente de validation."}
        >
          <div className="space-y-4">
            <div className={cn("grid gap-3", countingOnly ? "lg:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(180px,1fr))]" : "xl:grid-cols-[minmax(0,1.5fr)_220px_220px_auto] xl:items-end")}>
              <Input
                placeholder="Recherche reference, titre ou perimetre..."
                value={inventoryFilters.search}
                onChange={(event) => setInventoryFilters((current) => ({ ...current, search: event.target.value, page: 1 }))}
              />
              <Select
                value={inventoryFilters.status}
                onChange={(event) => setInventoryFilters((current) => ({ ...current, status: event.target.value as InventoryFilters["status"], page: 1 }))}
              >
                <option value="">Tous statuts</option>
                {bootstrap?.statuses.map((status) => (
                  <option key={status} value={status}>{formatInventoryStatus(status)}</option>
                ))}
              </Select>
              <Select
                value={inventoryFilters.type}
                onChange={(event) => setInventoryFilters((current) => ({ ...current, type: event.target.value as InventoryFilters["type"], page: 1 }))}
              >
                <option value="">Toutes methodes</option>
                {bootstrap?.methods.map((method) => (
                  <option key={method} value={method}>{formatInventoryMethod(method)}</option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <Button
                  variant="secondary"
                  className="!px-3 !py-2 text-xs"
                  onClick={() => void loadInventories({ ...inventoryFilters, page: 1 }, true)}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Actualiser
                </Button>
                <Button
                  variant="secondary"
                  className="!px-3 !py-2 text-xs"
                  onClick={() => setInventoryFilters({ search: "", status: "", type: "", page: 1 })}
                >
                  Reinitialiser
                </Button>
              </div>
            </div>

            <div className="grid gap-3">
              {listLoading ? (
                <LoadingBlock label="Chargement des inventaires..." />
              ) : inventoryCards.length ? (
                inventoryCards.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setSelectedInventoryId(row.id);
                      setItemFilters((current) => ({ ...current, page: 1 }));
                    }}
                    className={cn(
                      "w-full rounded-[24px] border p-5 text-left transition",
                      selectedInventoryId === row.id ? "border-orange-300/35 bg-[linear-gradient(180deg,rgba(255,171,89,0.16),rgba(255,171,89,0.05))]" : "border-white/10 bg-black/15 hover:border-white/20 hover:bg-black/20"
                    )}
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-300/75">{row.reference}</div>
                          <Badge tone={toneForInventoryStatus(row.status)}>{formatInventoryStatus(row.status)}</Badge>
                          <Badge>{formatInventoryMethod(row.type)}</Badge>
                          {row.allowCashierCounting ? <Badge tone="warning">Saisie caissier</Badge> : null}
                        </div>
                        <h3 className="mt-3 text-[1.4rem] font-semibold leading-tight text-white">{row.title}</h3>
                        <p className="mt-2 text-sm text-[#d8cabd]">{row.scope || "Sans perimetre detaille"}</p>
                      </div>
                      <div className="grid gap-3 rounded-[20px] border border-white/8 bg-black/20 p-4 text-sm text-[#dccfbe] sm:grid-cols-2 xl:min-w-[440px] xl:grid-cols-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[#cdbfb1]">Debut</div>
                          <div className="mt-1.5 font-semibold text-white">{formatDateTime(row.startedAt)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[#cdbfb1]">Articles</div>
                          <div className="mt-1.5 font-semibold text-white">{formatNumber(row.summary.totalArticles)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[#cdbfb1]">Valeur ecarts</div>
                          <div className={cn("mt-1.5 font-semibold", row.summary.differenceValueTotal === 0 ? "text-white" : row.summary.differenceValueTotal > 0 ? "text-emerald-100" : "text-rose-100")}>{formatCurrency(row.summary.differenceValueTotal)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[#cdbfb1]">Responsable</div>
                          <div className="mt-1.5 font-semibold text-white">{row.createdBy?.fullName || "-"}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[#cdbfb1]">Ecarts + / -</div>
                          <div className="mt-1.5 font-semibold text-white">{formatNumber(row.summary.positiveDifferenceQty)} / {formatNumber(Math.abs(row.summary.negativeDifferenceQty))}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[#cdbfb1]">Validation</div>
                          <div className="mt-1.5 font-semibold text-white">{row.validatedAt ? formatDate(row.validatedAt) : "En attente"}</div>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <EmptyState
                  compact
                  title={countingOnly ? "Aucun inventaire autorise" : "Aucun inventaire"}
                  description={countingOnly ? "Aucun inventaire n'est encore ouvert avec saisie caissier activee." : "Cree une premiere session pour demarrer le comptage du magasin."}
                />
              )}
            </div>

            {inventories && inventories.totalPages > 1 ? (
              <div className="flex items-center justify-between rounded-[18px] border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#d7c8ba]">
                <Button
                  variant="secondary"
                  className="!h-8 !px-3 !text-xs"
                  disabled={inventoryFilters.page <= 1}
                  onClick={() => setInventoryFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
                >
                  {"<"}
                </Button>
                <span>Page {inventories.page} / {inventories.totalPages}</span>
                <Button
                  variant="secondary"
                  className="!h-8 !px-3 !text-xs"
                  disabled={inventoryFilters.page >= inventories.totalPages}
                  onClick={() => setInventoryFilters((current) => ({ ...current, page: Math.min(inventories.totalPages, current.page + 1) }))}
                >
                  {">"}
                </Button>
              </div>
            ) : null}
          </div>
        </SectionCard>

        <div className="space-y-6">
          {detailLoading && !selectedInventory ? <LoadingBlock label="Chargement du comptage..." /> : selectedInventory && itemsPayload ? (
            <>
              <SectionCard
                title=""
                description={undefined}
                actions={(
                  <div className="flex w-full flex-wrap justify-end gap-2">
                    <Button variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => void refreshCurrentInventory(true)}>
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                      Actualiser
                    </Button>
                    {!countingOnly ? (
                      <>
                        <Button variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => void printReport("full")}>
                          <Printer className="mr-2 h-3.5 w-3.5" />
                          Imprimer rapport
                        </Button>
                        <Button variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => void printReport("pdf")}>
                          <FileDown className="mr-2 h-3.5 w-3.5" />
                          Export PDF
                        </Button>
                        <Button variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => void exportExcel()}>
                          <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                          Export Excel
                        </Button>
                        <Button variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => void printReport("simple")}>
                          <PackageSearch className="mr-2 h-3.5 w-3.5" />
                          Controle interne
                        </Button>
                      </>
                    ) : null}
                    {canManage && selectedInventory.status !== "VALIDATED" && selectedInventory.status !== "CANCELLED" ? (
                      <Button className="!px-3 !py-2 text-xs" onClick={() => void submitForValidation()} disabled={saving}>
                        <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                        Envoyer validation
                      </Button>
                    ) : null}
                    {canValidate && selectedInventory.status === "PENDING_VALIDATION" ? (
                      <Button className="!px-3 !py-2 text-xs" onClick={() => void validateInventory()} disabled={saving}>
                        <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                        Valider final
                      </Button>
                    ) : null}
                    {canManage && selectedInventory.status !== "VALIDATED" && selectedInventory.status !== "CANCELLED" ? (
                      <Button variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => void cancelInventory()} disabled={saving}>
                        Annuler
                      </Button>
                    ) : null}
                  </div>
                )}
              >
                <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-[1.05rem] font-semibold text-white">{selectedInventory.title}</h3>
                  <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#cdbfb1]">Reference {selectedInventory.reference}</span>
                </div>
                <div className="grid gap-4 xl:grid-cols-[1.2fr_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneForInventoryStatus(selectedInventory.status)}>{formatInventoryStatus(selectedInventory.status)}</Badge>
                      <Badge>{formatInventoryMethod(selectedInventory.type)}</Badge>
                      {selectedInventory.allowCashierCounting ? <Badge tone="warning">Saisie caissier activee</Badge> : null}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[18px] border border-sky-300/20 bg-gradient-to-br from-sky-300/12 via-sky-400/8 to-transparent px-4 py-3">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#d3c6b9]">Theorique</p>
                        <div className="mt-1.5 text-[1.02rem] font-semibold leading-none text-white">{formatNumber(selectedInventory.summary.theoreticalTotal)}</div>
                      </div>
                      <div className="rounded-[18px] border border-orange-300/20 bg-gradient-to-br from-orange-300/12 via-orange-400/8 to-transparent px-4 py-3">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#d3c6b9]">Compte</p>
                        <div className="mt-1.5 text-[1.02rem] font-semibold leading-none text-white">{formatNumber(selectedInventory.summary.countedTotal)}</div>
                      </div>
                      <div className="rounded-[18px] border border-rose-300/20 bg-gradient-to-br from-rose-300/12 via-rose-400/8 to-transparent px-4 py-3">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#d3c6b9]">Ecarts</p>
                        <div className="mt-1.5 text-[1.02rem] font-semibold leading-none text-white">{formatNumber(selectedInventory.summary.positiveDifferenceQty + selectedInventory.summary.negativeDifferenceQty)}</div>
                      </div>
                      <div className={cn(
                        "rounded-[18px] border bg-gradient-to-br px-4 py-3",
                        selectedInventory.summary.differenceValueTotal === 0
                          ? "border-sky-300/20 from-sky-300/12 via-sky-400/8 to-transparent"
                          : selectedInventory.summary.differenceValueTotal > 0
                            ? "border-emerald-300/20 from-emerald-300/12 via-emerald-400/8 to-transparent"
                            : "border-rose-300/20 from-rose-300/12 via-rose-400/8 to-transparent"
                      )}>
                        <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-[#d3c6b9]">Valeur ecarts</p>
                        <div className="mt-1 text-[0.88rem] font-semibold leading-none text-white">{formatCurrency(selectedInventory.summary.differenceValueTotal)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-[26px] border border-white/10 bg-black/15 p-4 md:grid-cols-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[#cdbfb1]">Perimetre</div>
                      <div className="mt-2 text-sm font-medium text-white">{selectedInventory.scope || "Sans perimetre detaille"}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[#cdbfb1]">Debut</div>
                      <div className="mt-2 text-sm font-medium text-white">{formatDateTime(selectedInventory.startedAt)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[#cdbfb1]">Responsable</div>
                      <div className="mt-2 text-sm font-medium text-white">{selectedInventory.createdBy?.fullName || "-"}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[#cdbfb1]">Validation</div>
                      <div className="mt-2 text-sm font-medium text-white">{selectedInventory.validatedAt ? `${formatDateTime(selectedInventory.validatedAt)} - ${selectedInventory.validatedBy?.fullName || "-"}` : "En attente"}</div>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title={countingOnly ? "Saisie des quantites" : "Lignes d'inventaire"}
                description={countingOnly ? "Le comptage se sauvegarde automatiquement quelques instants apres la saisie." : undefined}
                actions={(
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral"><Barcode className="mr-1 h-3 w-3" />Scanner code-barres</Badge>
                    <Badge tone="neutral"><Save className="mr-1 h-3 w-3" />Brouillon auto</Badge>
                  </div>
                )}
              >
                <div className="grid gap-3">
                  <Input
                    placeholder="Recherche reference, code-barres ou article..."
                    value={itemFilters.search}
                    onChange={(event) => setItemFilters((current) => ({ ...current, search: event.target.value, page: 1 }))}
                  />
                  <div className="grid gap-3 xl:grid-cols-[repeat(5,minmax(120px,1fr))_160px]">
                    <Select value={itemFilters.category} onChange={(event) => setItemFilters((current) => ({ ...current, category: event.target.value, page: 1 }))}>
                      <option value="">Categorie</option>
                      {bootstrap?.filters.categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                    </Select>
                    <Select value={itemFilters.type} onChange={(event) => setItemFilters((current) => ({ ...current, type: event.target.value, page: 1 }))}>
                      <option value="">Type</option>
                      {bootstrap?.filters.types.map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}
                    </Select>
                    <Select value={itemFilters.color} onChange={(event) => setItemFilters((current) => ({ ...current, color: event.target.value, page: 1 }))}>
                      <option value="">Couleur</option>
                      {bootstrap?.filters.colors.map((color) => <option key={color} value={color}>{color}</option>)}
                    </Select>
                    <Select value={itemFilters.size} onChange={(event) => setItemFilters((current) => ({ ...current, size: event.target.value, page: 1 }))}>
                      <option value="">Taille</option>
                      {bootstrap?.filters.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                    </Select>
                    <Select value={itemFilters.warehouseId} onChange={(event) => setItemFilters((current) => ({ ...current, warehouseId: event.target.value, page: 1 }))}>
                      <option value="">Emplacement</option>
                      {bootstrap?.filters.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{cleanInventoryText(warehouse.name)}</option>)}
                    </Select>
                    <Select value={itemFilters.status} onChange={(event) => setItemFilters((current) => ({ ...current, status: event.target.value as ItemFilters["status"], page: 1 }))}>
                      <option value="">Statut</option>
                      {bootstrap?.itemStatuses.map((status) => <option key={status} value={status}>{formatItemStatus(status)}</option>)}
                    </Select>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button className="!px-3 !py-2 text-xs" onClick={() => void loadInventoryItems(selectedInventoryId, { ...itemFilters, page: 1 }, true)}>
                    <Filter className="mr-2 h-3.5 w-3.5" />
                    Rechercher
                  </Button>
                  <Button
                    variant={itemFilters.withDifferenceOnly ? "primary" : "secondary"}
                    className="!px-3 !py-2 text-xs"
                    onClick={() => setItemFilters((current) => ({ ...current, withDifferenceOnly: !current.withDifferenceOnly, page: 1 }))}
                  >
                    Ecarts uniquement
                  </Button>
                  <Button
                    variant="secondary"
                    className="!px-3 !py-2 text-xs"
                    onClick={() => setItemFilters({
                      search: "",
                      category: "",
                      type: "",
                      brand: "",
                      color: "",
                      size: "",
                      warehouseId: "",
                      status: "",
                      withDifferenceOnly: false,
                      page: 1
                    })}
                  >
                    Reinitialiser
                  </Button>
                </div>

                <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
                  <div className="overflow-x-auto">
                    <table className="min-w-[1180px] w-full text-sm text-[#eadfd3]">
                      <thead className="bg-[#251a13] text-[11px] uppercase tracking-[0.22em] text-[#d9c7b4]">
                        <tr>
                          <th className="px-4 py-3 text-left">Reference</th>
                          <th className="px-4 py-3 text-left">Article</th>
                          <th className="px-4 py-3 text-left">Categorie</th>
                          <th className="px-4 py-3 text-left">Couleur / Taille</th>
                          <th className="px-4 py-3 text-left">Emplacement</th>
                          <th className="px-4 py-3 text-right">Theo.</th>
                          <th className="px-4 py-3 text-right">Compte</th>
                          <th className="px-4 py-3 text-right">Ecart</th>
                          <th className="px-4 py-3 text-right">Valeur</th>
                          <th className="px-4 py-3 text-left">Notes</th>
                          <th className="px-4 py-3 text-left">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsPayload.rows.map((item) => {
                          const localDraft = localDrafts[item.id];
                          const countedValue = localDraft ? localDraft.countedQty : item.countedQty == null ? "" : String(item.countedQty);
                          const notesValue = localDraft ? localDraft.notes : item.notes ?? "";
                          const differenceTone = item.differenceQty === 0 ? "text-white" : item.differenceQty > 0 ? "text-emerald-100" : "text-rose-100";
                          return (
                            <tr key={item.id} className="border-t border-white/6 align-top">
                              <td className="px-4 py-3">
                                <div className="font-semibold text-white">{item.productReference}</div>
                                <div className="mt-1 text-xs text-[#bba999]">{item.barcode || "-"}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-white">{item.productName}</div>
                                <div className="mt-1 text-xs text-[#bba999]">{item.brand || "-"}</div>
                              </td>
                              <td className="px-4 py-3">{item.category || "-"}</td>
                              <td className="px-4 py-3">
                                <div>{item.color || "-"}</div>
                                <div className="mt-1 text-xs text-[#bba999]">{item.size || "-"}</div>
                              </td>
                              <td className="px-4 py-3">{cleanInventoryText(item.location)}</td>
                              <td className="px-4 py-3 text-right font-semibold text-white">{formatNumber(item.theoreticalQty)}</td>
                              <td className="px-4 py-3">
                                <Input
                                  type="number"
                                  value={countedValue}
                                  disabled={!canCountCurrentInventory || selectedInventory.status === "VALIDATED" || selectedInventory.status === "CANCELLED"}
                                  className="!h-9 !min-w-[82px] !w-[82px] text-right"
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setLocalDrafts((current) => ({
                                      ...current,
                                      [item.id]: {
                                        countedQty: value,
                                        notes: current[item.id]?.notes ?? item.notes ?? "",
                                        saving: false
                                      }
                                    }));
                                    queueItemAutosave(item.id);
                                  }}
                                  onBlur={() => void persistItemDraft(item.id)}
                                />
                              </td>
                              <td className={cn("px-4 py-3 text-right font-semibold", differenceTone)}>
                                {formatNumber(item.differenceQty)}
                              </td>
                              <td className={cn("px-4 py-3 text-right font-semibold", differenceTone)}>
                                {formatCurrency(Number(item.differenceValue ?? 0))}
                              </td>
                              <td className="px-4 py-3">
                                <Textarea
                                  value={notesValue}
                                  disabled={!canCountCurrentInventory || selectedInventory.status === "VALIDATED" || selectedInventory.status === "CANCELLED"}
                                  className="min-h-[56px] text-sm"
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setLocalDrafts((current) => ({
                                      ...current,
                                      [item.id]: {
                                        countedQty: current[item.id]?.countedQty ?? (item.countedQty == null ? "" : String(item.countedQty)),
                                        notes: value,
                                        saving: false
                                      }
                                    }));
                                    queueItemAutosave(item.id);
                                  }}
                                  onBlur={() => void persistItemDraft(item.id)}
                                />
                                {localDraft?.saving ? <div className="mt-1 text-[11px] text-orange-200">Sauvegarde...</div> : null}
                              </td>
                              <td className="px-4 py-3">
                                <Badge tone={toneForItemStatus(item.status)}>{formatItemStatus(item.status)}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {itemsPayload.totalPages > 1 ? (
                  <div className="mt-4 flex items-center justify-between rounded-[18px] border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#d7c8ba]">
                    <Button
                      variant="secondary"
                      className="!h-8 !px-3 !text-xs"
                      disabled={itemFilters.page <= 1}
                      onClick={() => setItemFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
                    >
                      {"<"}
                    </Button>
                    <span>Page {itemsPayload.page} / {itemsPayload.totalPages}</span>
                    <Button
                      variant="secondary"
                      className="!h-8 !px-3 !text-xs"
                      disabled={itemFilters.page >= itemsPayload.totalPages}
                      onClick={() => setItemFilters((current) => ({ ...current, page: Math.min(itemsPayload.totalPages, current.page + 1) }))}
                    >
                      {">"}
                    </Button>
                  </div>
                ) : null}
              </SectionCard>

              {!countingOnly ? (
                <SectionCard title="Historique des modifications" description="Chaque saisie, envoi ou validation conserve l'utilisateur, l'heure et l'adresse IP.">
                  <div className="space-y-3">
                    {selectedInventory.logs.length ? selectedInventory.logs.map((log) => (
                      <div key={log.id} className="rounded-[18px] border border-white/10 bg-black/15 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{log.user?.fullName || "Systeme"} - {log.action}</div>
                            <div className="mt-1 text-xs text-[#bdaea0]">{formatDateTime(log.createdAt)}{log.ipAddress ? ` • ${log.ipAddress}` : ""}</div>
                          </div>
                          <Badge>{log.user?.email || "Trace interne"}</Badge>
                        </div>
                      </div>
                    )) : (
                      <EmptyState compact title="Aucun log" description="Les modifications d'inventaire apparaitront ici au fil du comptage." />
                    )}
                  </div>
                </SectionCard>
              ) : null}
            </>
          ) : (
            <EmptyState
              title={countingOnly ? "Aucun inventaire a compter" : "Selectionne un inventaire"}
              description={countingOnly ? "Dès qu'un responsable autorise un inventaire avec saisie caissier, il apparaitra ici." : "Choisis une session d'inventaire a gauche ou cree un nouveau controle pour commencer."}
            />
          )}
        </div>
      </div>

      {!countingOnly && createModalOpen && bootstrap ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={() => !saving && setCreateModalOpen(false)}>
          <div className="inventory-create-modal flex h-[calc(100vh-2rem)] w-full max-w-[1100px] flex-col overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#18120e,#100b08)] shadow-[0_32px_90px_rgba(0,0,0,0.55)] md:h-[760px]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="inventory-create-header flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <p className="inventory-create-kicker text-xs font-semibold uppercase tracking-[0.28em] text-orange-300/75">Inventaire</p>
                <h2 className="inventory-create-title mt-1 text-2xl font-semibold text-white">Nouvelle session de comptage</h2>
              </div>
              <Button variant="secondary" className="!h-10 !px-4" onClick={() => !saving && setCreateModalOpen(false)}>
                Fermer
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-5 xl:grid-cols-[1.1fr_minmax(0,1.35fr)]">
                <div className="space-y-4">
                  <Field label="Titre de l'inventaire">
                    <Input value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} placeholder="Ex. Inventaire tournant sacs Gueliz" />
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Methode">
                      <Select value={createForm.type} onChange={(event) => setCreateForm((current) => ({ ...current, type: event.target.value as InventoryMethod }))}>
                        {bootstrap.methods.map((method) => <option key={method} value={method}>{formatInventoryMethod(method)}</option>)}
                      </Select>
                    </Field>
                    <Field label="Perimetre affiche">
                      <Input value={createForm.scope} onChange={(event) => setCreateForm((current) => ({ ...current, scope: event.target.value }))} placeholder="Ex. Boutique Gueliz / Sacs cuir" />
                    </Field>
                  </div>
                  <Field label="Notes internes">
                    <Textarea value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[120px]" placeholder="Consignes de comptage, plages horaires, remarques..." />
                  </Field>
                  <label className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <input
                      type="checkbox"
                      checked={createForm.allowCashierCounting}
                      onChange={(event) => setCreateForm((current) => ({ ...current, allowCashierCounting: event.target.checked }))}
                    />
                    Autoriser la saisie quantites par un caissier
                  </label>
                </div>

                <div className="inventory-create-filter-panel space-y-4 rounded-[28px] border border-white/10 bg-black/15 p-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/70">Filtres de preparation</div>
                    <h3 className="mt-2 text-lg font-semibold text-white">Selection des lignes a controler</h3>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Reference / code-barres / article">
                      <Input value={createForm.search} onChange={(event) => setCreateForm((current) => ({ ...current, search: event.target.value }))} placeholder="Recherche rapide..." />
                    </Field>
                    <Field label="Emplacement">
                      <Select value={createForm.warehouseId} onChange={(event) => setCreateForm((current) => ({ ...current, warehouseId: event.target.value }))}>
                        <option value="">Tous les emplacements</option>
                        {bootstrap.filters.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Categorie">
                      <Select value={createForm.categoryId} onChange={(event) => setCreateForm((current) => ({ ...current, categoryId: event.target.value }))}>
                        <option value="">Toutes categories</option>
                        {bootstrap.filters.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Type article">
                      <Select value={createForm.typeId} onChange={(event) => setCreateForm((current) => ({ ...current, typeId: event.target.value }))}>
                        <option value="">Tous types</option>
                        {bootstrap.filters.types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Marque">
                      <Select value={createForm.brandId} onChange={(event) => setCreateForm((current) => ({ ...current, brandId: event.target.value }))}>
                        <option value="">Toutes marques</option>
                        {bootstrap.filters.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Statut article">
                      <Select value={createForm.status} onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as CreateInventoryForm["status"] }))}>
                        <option value="ACTIVE">Actifs</option>
                        <option value="INACTIVE">Inactifs</option>
                      </Select>
                    </Field>
                    <Field label="Couleur">
                      <Select value={createForm.color} onChange={(event) => setCreateForm((current) => ({ ...current, color: event.target.value }))}>
                        <option value="">Toutes couleurs</option>
                        {bootstrap.filters.colors.map((color) => <option key={color} value={color}>{color}</option>)}
                      </Select>
                    </Field>
                    <Field label="Taille">
                      <Select value={createForm.size} onChange={(event) => setCreateForm((current) => ({ ...current, size: event.target.value }))}>
                        <option value="">Toutes tailles</option>
                        {bootstrap.filters.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                      </Select>
                    </Field>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
              <Button variant="secondary" className="!px-4 !py-2.5" onClick={() => !saving && setCreateModalOpen(false)}>Annuler</Button>
              <Button className="!px-4 !py-2.5" onClick={() => void createInventory()} disabled={saving || !createForm.title.trim()}>
                {saving ? "Creation..." : "Creer l'inventaire"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
