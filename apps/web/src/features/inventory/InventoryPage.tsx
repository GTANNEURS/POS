import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRightLeft, PackagePlus, X } from "lucide-react";
import { api } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, SectionCard, Select } from "../../components/ui/primitives";
import { useAuth } from "../../providers/AuthProvider";

type Product = { id: string; reference?: string | null; name: string; stockOnHand: number; minStock: number };
type Warehouse = { id: string; name: string; type?: string };
type Movement = {
  id: string;
  type: string;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  notes?: string | null;
  createdAt: string;
  product: { name: string };
  warehouse: { name: string };
};
type Alerts = { outOfStock: Product[]; lowStock: Product[] };
type ProductStockOverview = {
  id: string;
  name: string;
  reference?: string | null;
  stockOnHand: number;
  minStock: number;
  locations: Array<{ warehouseId: string; warehouseName: string; warehouseType?: string; quantity: number }>;
  variants: Array<{
    id: string;
    reference?: string | null;
    label?: string | null;
    color?: string | null;
    colorReference?: string | null;
    size?: string | null;
    stockOnHand: number;
    locations: Array<{ warehouseId: string; warehouseName: string; quantity: number }>;
  }>;
};
type BootstrapPayload = { products: Product[]; warehouses: Warehouse[]; overview: ProductStockOverview[] };
type NegativeStockRow = {
  key: string;
  productId: string;
  productName: string;
  reference?: string | null;
  warehouseId: string;
  warehouseName: string;
  warehouseType?: string;
  quantity: number;
  stockOnHand: number;
  minStock: number;
};

export function InventoryPage() {
  const { user } = useAuth();
  const [movements, setMovements] = useState<Movement[]>([]);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [overview, setOverview] = useState<ProductStockOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"overview" | "negative" | "movements">("overview");
  const [adjustmentSearch, setAdjustmentSearch] = useState("");
  const [transferSearch, setTransferSearch] = useState("");
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [variantMatrixOpen, setVariantMatrixOpen] = useState(false);
  const [variantMatrixProductId, setVariantMatrixProductId] = useState<string | null>(null);
  const [variantMatrixWarehouseId, setVariantMatrixWarehouseId] = useState<string | null>(null);
  const [form, setForm] = useState({
    productId: "",
    variantId: "",
    warehouseId: "",
    quantity: "0",
    reason: "Ajustement inventaire"
  });
  const [transferForm, setTransferForm] = useState({
    productId: "",
    variantId: "",
    fromWarehouseId: "",
    quantity: "1",
    toWarehouseId: "",
    reason: "Transfert boutique"
  });

  async function load() {
    setLoading(true);
    const [movementList, alertList, bootstrap] = await Promise.all([
      api<Movement[]>("/inventory/movements"),
      api<Alerts>("/inventory/alerts"),
      api<BootstrapPayload>("/inventory/bootstrap")
    ]);

    setMovements(movementList);
    setAlerts(alertList);
    setProducts(bootstrap.products);
    setWarehouses(bootstrap.warehouses);
    setOverview(bootstrap.overview);
    setForm((current) => ({
      ...current,
      productId: current.productId || bootstrap.products[0]?.id || "",
      warehouseId: current.warehouseId || user?.defaultWarehouse?.id || bootstrap.warehouses[0]?.id || ""
    }));
    setTransferForm((current) => ({
      ...current,
      productId: current.productId || bootstrap.products[0]?.id || "",
      fromWarehouseId: current.fromWarehouseId || user?.defaultWarehouse?.id || bootstrap.warehouses[0]?.id || "",
      toWarehouseId: current.toWarehouseId || user?.defaultWarehouse?.id || bootstrap.warehouses[1]?.id || bootstrap.warehouses[0]?.id || ""
    }));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adjustmentBlocked) return;
    setSaving(true);
    await api("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({
        productId: form.productId,
        variantId: form.variantId || null,
        warehouseId: form.warehouseId,
        quantity: Number(form.quantity),
        reason: form.reason
      })
    });
    setSaving(false);
    setAdjustmentModalOpen(false);
    setForm((current) => ({ ...current, quantity: "0", reason: "Ajustement inventaire" }));
    await load();
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (transferBlocked) return;
    setSaving(true);
    await api("/inventory/transfers", {
      method: "POST",
      body: JSON.stringify({
        productId: transferForm.productId,
        variantId: transferForm.variantId || null,
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        quantity: Number(transferForm.quantity),
        reason: transferForm.reason
      })
    });
    setSaving(false);
    closeTransferModal();
    await load();
  }

  const stockSummary = useMemo(() => ({
    trackedProducts: overview.length,
    totalLowStock: alerts?.lowStock.length ?? 0,
    totalOutOfStock: alerts?.outOfStock.length ?? 0
  }), [alerts, overview.length]);

  const filteredOverview = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return overview;
    return overview.filter((item) =>
      item.name.toLowerCase().includes(query)
      || String(item.reference ?? "").toLowerCase().includes(query)
    );
  }, [overview, search]);

  const negativeRows = useMemo<NegativeStockRow[]>(
    () =>
      overview.flatMap((item) =>
        item.locations
          .filter((location) => location.quantity < 0)
          .map((location) => ({
            key: `${item.id}:${location.warehouseId}`,
            productId: item.id,
            productName: item.name,
            reference: item.reference,
            warehouseId: location.warehouseId,
            warehouseName: location.warehouseName,
            warehouseType: location.warehouseType,
            quantity: location.quantity,
            stockOnHand: item.stockOnHand,
            minStock: item.minStock
          }))
      ),
    [overview]
  );
  const filteredNegativeRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return negativeRows;
    return negativeRows.filter((row) =>
      row.productName.toLowerCase().includes(query)
      || String(row.reference ?? "").toLowerCase().includes(query)
      || row.warehouseName.toLowerCase().includes(query)
    );
  }, [negativeRows, search]);

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filteredOverview.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedOverview = useMemo(
    () => filteredOverview.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredOverview, currentPage]
  );

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const adjustmentProducts = useMemo(() => {
    const query = adjustmentSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      product.name.toLowerCase().includes(query)
      || String(product.reference ?? "").toLowerCase().includes(query)
    );
  }, [adjustmentSearch, products]);

  const transferProducts = useMemo(() => {
    const query = transferSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      product.name.toLowerCase().includes(query)
      || String(product.reference ?? "").toLowerCase().includes(query)
    );
  }, [products, transferSearch]);

  const selectedAdjustmentProduct = useMemo(
    () => overview.find((item) => item.id === form.productId),
    [form.productId, overview]
  );
  const selectedAdjustmentVariant = useMemo(
    () => selectedAdjustmentProduct?.variants.find((variant) => variant.id === form.variantId) ?? null,
    [form.variantId, selectedAdjustmentProduct]
  );
  const adjustmentCurrentQuantity = useMemo(
    () => selectedAdjustmentVariant
      ? selectedAdjustmentVariant.locations.find((location) => location.warehouseId === form.warehouseId)?.quantity ?? 0
      : selectedAdjustmentProduct?.locations.find((location) => location.warehouseId === form.warehouseId)?.quantity ?? 0,
    [form.warehouseId, selectedAdjustmentProduct, selectedAdjustmentVariant]
  );
  const adjustmentDelta = Number(form.quantity || 0);
  const adjustmentNextQuantity = adjustmentCurrentQuantity + adjustmentDelta;
  const adjustmentVariantRequired = (selectedAdjustmentProduct?.variants.length ?? 0) > 0 && !form.variantId;
  const adjustmentBlocked = adjustmentNextQuantity < 0 || adjustmentVariantRequired;

  const selectedTransferProduct = useMemo(
    () => overview.find((item) => item.id === transferForm.productId),
    [overview, transferForm.productId]
  );
  const selectedTransferVariant = useMemo(
    () => selectedTransferProduct?.variants.find((variant) => variant.id === transferForm.variantId) ?? null,
    [selectedTransferProduct, transferForm.variantId]
  );
  const transferVariantRequired = (selectedTransferProduct?.variants.length ?? 0) > 0 && !transferForm.variantId;
  const currentWarehouseId = user?.defaultWarehouse?.id ?? null;
  const orderedWarehouses = useMemo(() => {
    if (!currentWarehouseId) return warehouses;
    const currentWarehouse = warehouses.find((warehouse) => warehouse.id === currentWarehouseId);
    const otherWarehouses = warehouses.filter((warehouse) => warehouse.id !== currentWarehouseId);
    return currentWarehouse ? [currentWarehouse, ...otherWarehouses] : warehouses;
  }, [currentWarehouseId, warehouses]);
  const operationalWarehouses = useMemo(
    () => user?.roles.includes("admin") ? orderedWarehouses : orderedWarehouses.filter((warehouse) => warehouse.id === currentWarehouseId),
    [currentWarehouseId, orderedWarehouses, user?.roles]
  );
  const canAdjustStock = user?.roles.includes("admin") ?? false;
  const canTransferStock = (user?.permissions.includes("inventory_manage") ?? false) && orderedWarehouses.length > 1;
  const transferSourceWarehouses = useMemo(
    () => orderedWarehouses.filter((warehouse) => {
      if (!(user?.roles.includes("admin") ?? false) && warehouse.id !== currentWarehouseId) {
        return false;
      }
      return getWarehouseAvailableQuantity(selectedTransferProduct ?? null, selectedTransferVariant, warehouse.id) > 0;
    }),
    [currentWarehouseId, orderedWarehouses, selectedTransferProduct, selectedTransferVariant, user?.roles]
  );
  const transferSourceQuantity = useMemo(
    () => getWarehouseAvailableQuantity(selectedTransferProduct ?? null, selectedTransferVariant, transferForm.fromWarehouseId),
    [selectedTransferProduct, selectedTransferVariant, transferForm.fromWarehouseId]
  );
  const transferDestinationQuantity = useMemo(
    () => getWarehouseAvailableQuantity(selectedTransferProduct ?? null, selectedTransferVariant, transferForm.toWarehouseId),
    [selectedTransferProduct, selectedTransferVariant, transferForm.toWarehouseId]
  );
  const transferRequestedQuantity = Number(transferForm.quantity || 0);
  const transferDestinationWarehouses = useMemo(
    () => orderedWarehouses.filter((warehouse) => warehouse.id !== transferForm.fromWarehouseId),
    [orderedWarehouses, transferForm.fromWarehouseId]
  );
  const transferBlocked = !transferForm.productId
    || transferVariantRequired
    || !transferForm.fromWarehouseId
    || !transferForm.toWarehouseId
    || transferForm.fromWarehouseId === transferForm.toWarehouseId
    || transferRequestedQuantity <= 0
    || transferRequestedQuantity > transferSourceQuantity
    || !transferForm.reason.trim();
  const selectedVariantMatrixProduct = useMemo(
    () => overview.find((item) => item.id === variantMatrixProductId) ?? null,
    [overview, variantMatrixProductId]
  );
  const selectedVariantMatrixWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === variantMatrixWarehouseId) ?? null,
    [variantMatrixWarehouseId, warehouses]
  );
  const variantMatrixColors = useMemo(() => {
    const variants = selectedVariantMatrixProduct?.variants ?? [];
    const colorMap = new Map<string, { name: string; reference?: string | null }>();
    variants.forEach((variant) => {
      const name = variant.color?.trim() || "Sans couleur";
      if (!colorMap.has(name)) {
        colorMap.set(name, { name, reference: variant.colorReference?.trim() || null });
      }
    });
    return Array.from(colorMap.values());
  }, [selectedVariantMatrixProduct]);
  const variantMatrixSizes = useMemo(() => {
    const variants = selectedVariantMatrixProduct?.variants ?? [];
    return Array.from(new Set(variants.map((variant) => variant.size?.trim() || "Sans taille")));
  }, [selectedVariantMatrixProduct]);

  function openVariantMatrix(productId: string, warehouseId: string) {
    if (variantMatrixOpen && variantMatrixProductId === productId && variantMatrixWarehouseId === warehouseId) {
      setVariantMatrixOpen(false);
      setVariantMatrixProductId(null);
      setVariantMatrixWarehouseId(null);
      return;
    }

    setVariantMatrixProductId(productId);
    setVariantMatrixWarehouseId(warehouseId);
    setVariantMatrixOpen(true);
  }

  function getVariantQuantityForCell(color: string, size: string) {
    const variants = selectedVariantMatrixProduct?.variants ?? [];
    const warehouseId = variantMatrixWarehouseId;
    if (!warehouseId) return 0;
    return variants
      .filter((variant) => (variant.color?.trim() || "Sans couleur") === color && (variant.size?.trim() || "Sans taille") === size)
      .reduce((sum, variant) => sum + (variant.locations.find((location) => location.warehouseId === warehouseId)?.quantity ?? 0), 0);
  }

  function getVariantAvailableQuantity(
    variant: ProductStockOverview["variants"][number],
    warehouseId: string
  ) {
    return variant.locations.find((location) => location.warehouseId === warehouseId)?.quantity ?? 0;
  }

  function formatVariantDisplayLabel(variant: ProductStockOverview["variants"][number]) {
    const colorName = variant.color || "Sans couleur";
    const colorCode = variant.colorReference || variant.reference || "-";
    const sizeName = variant.size || "Sans taille";
    return `${colorName} (${colorCode}) - ${sizeName}`;
  }

  function getWarehouseAvailableQuantity(
    product: ProductStockOverview | null,
    variant: ProductStockOverview["variants"][number] | null,
    warehouseId: string
  ) {
    if (variant) {
      return variant.locations.find((location) => location.warehouseId === warehouseId)?.quantity ?? 0;
    }
    if (product) {
      return product.locations.find((location) => location.warehouseId === warehouseId)?.quantity ?? 0;
    }
    return 0;
  }

  function closeTransferModal() {
    if (saving) return;
    setTransferModalOpen(false);
    setTransferSearch("");
    setTransferForm({
      productId: transferProducts[0]?.id || products[0]?.id || "",
      variantId: "",
      fromWarehouseId: "",
      quantity: "1",
      toWarehouseId: "",
      reason: "Transfert boutique"
    });
  }

  function openTransferModal() {
    setTransferModalOpen(true);
    setTransferSearch("");
    setTransferForm({
      productId: transferProducts[0]?.id || products[0]?.id || "",
      variantId: "",
      fromWarehouseId: "",
      quantity: "1",
      toWarehouseId: "",
      reason: "Transfert boutique"
    });
  }

  useEffect(() => {
    if (!selectedAdjustmentProduct) return;
    if (!selectedAdjustmentProduct.variants.length) {
      if (form.variantId) {
        setForm((current) => ({ ...current, variantId: "" }));
      }
      return;
    }
    if (!selectedAdjustmentProduct.variants.some((variant) => variant.id === form.variantId)) {
      setForm((current) => ({ ...current, variantId: "" }));
    }
  }, [form.variantId, selectedAdjustmentProduct]);

  useEffect(() => {
    if (!selectedTransferProduct) return;
    if (!selectedTransferProduct.variants.length) {
      if (transferForm.variantId) {
        setTransferForm((current) => ({ ...current, variantId: "" }));
      }
      return;
    }
    if (!selectedTransferProduct.variants.some((variant) => variant.id === transferForm.variantId)) {
      setTransferForm((current) => ({ ...current, variantId: "" }));
    }
  }, [selectedTransferProduct, transferForm.variantId]);

  useEffect(() => {
    if (!selectedTransferProduct) return;
    const sourceStillAvailable = transferSourceWarehouses.some((warehouse) => warehouse.id === transferForm.fromWarehouseId);
    if (!sourceStillAvailable) {
      setTransferForm((current) => ({
        ...current,
        fromWarehouseId: transferSourceWarehouses[0]?.id || "",
        toWarehouseId: ""
      }));
    }
  }, [selectedTransferProduct, selectedTransferVariant, transferForm.fromWarehouseId, transferSourceWarehouses]);

  useEffect(() => {
    if (!transferForm.fromWarehouseId) return;
    const destinationStillAvailable = transferDestinationWarehouses.some((warehouse) => warehouse.id === transferForm.toWarehouseId);
    if (!destinationStillAvailable) {
      setTransferForm((current) => ({
        ...current,
        toWarehouseId: transferDestinationWarehouses[0]?.id || ""
      }));
    }
  }, [transferDestinationWarehouses, transferForm.fromWarehouseId, transferForm.toWarehouseId]);

  if (loading && !alerts) return <LoadingBlock label="Chargement du stock..." />;

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap justify-end gap-3">
          {canTransferStock ? (
            <Button variant="secondary" className="!h-9 !px-4 !text-[13px]" onClick={openTransferModal}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Transferer le stock
            </Button>
          ) : null}
          <Button className="!h-9 !px-4 !text-[13px]" onClick={() => setAdjustmentModalOpen(true)} disabled={!canAdjustStock}>
            <PackagePlus className="mr-2 h-4 w-4" />
            Nouvel ajustement
          </Button>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-3">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={activeTab === "overview" ? "rounded-full bg-[linear-gradient(135deg,#6d4723,#4a2f18)] px-5 py-2 text-sm font-semibold text-white" : "rounded-full border border-white/10 bg-black/20 px-5 py-2 text-sm font-medium text-[#d4c1b1]"}
            >
              Stock par emplacement
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("negative")}
              className={activeTab === "negative" ? "rounded-full bg-[linear-gradient(135deg,#6d4723,#4a2f18)] px-5 py-2 text-sm font-semibold text-white" : "rounded-full border border-white/10 bg-black/20 px-5 py-2 text-sm font-medium text-[#d4c1b1]"}
            >
              Stock negatif
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("movements")}
              className={activeTab === "movements" ? "rounded-full bg-[linear-gradient(135deg,#6d4723,#4a2f18)] px-5 py-2 text-sm font-semibold text-white" : "rounded-full border border-white/10 bg-black/20 px-5 py-2 text-sm font-medium text-[#d4c1b1]"}
            >
              Historique des mouvements
            </button>
          </div>
        </div>

        {activeTab === "overview" ? (
          <SectionCard
            title="Stock par emplacement"
            description={`${formatNumber(stockSummary.trackedProducts)} article(s) suivis, ${formatNumber(stockSummary.totalLowStock)} en alerte, ${formatNumber(stockSummary.totalOutOfStock)} en rupture.`}
            actions={
              <Input
                className="w-full min-w-[260px] md:w-[320px]"
                placeholder="Rechercher un article ou une reference..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            }
          >
            {filteredOverview.length === 0 ? (
              <EmptyState title="Aucun stock" description="Les stocks par boutique et entrepot apparaitront ici." compact />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Article</th>
                        <th>Stock global</th>
                        {orderedWarehouses.map((warehouse) => (
                          <th
                            key={warehouse.id}
                            className={warehouse.id === currentWarehouseId ? "bg-orange-300/10 text-orange-100" : undefined}
                          >
                            <div className="text-[8px] font-medium leading-tight">{warehouse.name}</div>
                            {warehouse.type === "WAREHOUSE" ? (
                              <div className="mt-1 text-[6px] uppercase tracking-[0.1em] text-[#b9aa9b]">Entrepot</div>
                            ) : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedOverview.map((item) => {
                        const isExpanded = variantMatrixOpen && variantMatrixProductId === item.id;
                        const expandedWarehouse = isExpanded
                          ? orderedWarehouses.find((warehouse) => warehouse.id === variantMatrixWarehouseId) ?? null
                          : null;

                        return (
                          <Fragment key={item.id}>
                            <tr>
                              <td>
                                <div className="font-medium text-white">{item.name}</div>
                                <div className="mt-1 text-xs text-[#baa999]">
                                  {item.reference || "Sans reference"}
                                </div>
                                <div className="mt-1 text-xs text-[#8f8073]">
                                  Min {formatNumber(item.minStock)}
                                </div>
                              </td>
                              <td>
                                <div className={item.stockOnHand < 0 ? "font-semibold text-rose-200" : "font-semibold text-white"}>{formatNumber(item.stockOnHand)}</div>
                                <div className="mt-1">
                                  <Badge tone={item.stockOnHand < 0 ? "danger" : item.stockOnHand === 0 ? "danger" : item.stockOnHand <= item.minStock ? "warning" : "success"}>
                                    {item.stockOnHand < 0 ? "Negatif" : item.stockOnHand === 0 ? "Rupture" : item.stockOnHand <= item.minStock ? "Faible" : "Disponible"}
                                  </Badge>
                                </div>
                              </td>
                              {orderedWarehouses.map((warehouse) => {
                                const location = item.locations.find((entry) => entry.warehouseId === warehouse.id);
                                const quantity = location?.quantity ?? 0;
                                const isActiveCell = isExpanded && variantMatrixWarehouseId === warehouse.id;
                                const isNegative = quantity < 0;
                                const isClickable = quantity !== 0;
                                return (
                                  <td key={warehouse.id} className={warehouse.id === currentWarehouseId ? "bg-orange-300/5" : undefined}>
                                    {isClickable ? (
                                      <button
                                        type="button"
                                        className={isActiveCell
                                          ? "inline-flex min-w-[42px] items-center justify-center rounded-full bg-[#ff9d2f] px-2.5 py-1 text-xs font-semibold text-[#1e1209] transition"
                                          : isNegative
                                            ? "inline-flex min-w-[42px] items-center justify-center rounded-full border border-rose-300/30 bg-rose-400/10 px-2.5 py-1 text-xs font-semibold text-rose-100 transition hover:border-rose-200/45 hover:text-rose-50"
                                            : "inline-flex min-w-[42px] items-center justify-center rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:border-[#ffb86b]/45 hover:text-orange-100"}
                                        onClick={() => openVariantMatrix(item.id, warehouse.id)}
                                      >
                                        {formatNumber(quantity)}
                                      </button>
                                    ) : (
                                      <span className="text-[#7d6f63]">{formatNumber(quantity)}</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                            {isExpanded && expandedWarehouse ? (
                              <tr className="bg-black/10">
                                <td colSpan={2 + orderedWarehouses.length} className="px-4 py-4">
                                  <div className="rounded-[24px] border border-white/10 bg-[#120e0c] p-4">
                                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-300/75">Detail variantes</p>
                                        <h3 className="mt-1 text-base font-semibold text-white">{item.name}</h3>
                                        <p className="mt-1 text-sm text-[#cdbfb1]">{expandedWarehouse.name}</p>
                                      </div>
                                      <button
                                        type="button"
                                        className="rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-medium text-[#e7d8c8] transition hover:border-white/20 hover:text-white"
                                        onClick={() => openVariantMatrix(item.id, expandedWarehouse.id)}
                                      >
                                        Fermer
                                      </button>
                                    </div>

                                    {item.variants.length ? (
                                      <div className="overflow-auto rounded-[20px] border border-white/10">
                                        <table className="w-full min-w-[520px] text-left text-sm">
                                          <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-[#d9c5b1]">
                                            <tr>
                                              <th className="px-4 py-3">Couleur</th>
                                              {variantMatrixSizes.map((size) => (
                                                <th key={size} className="px-4 py-3 text-center">{size}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-white/10">
                                            {variantMatrixColors.map((color) => (
                                              <tr key={color.name}>
                                                <td className="px-4 py-3 font-medium text-white">
                                                  <span className="inline-flex flex-wrap items-center gap-1">
                                                    {color.reference ? (
                                                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-200/80">
                                                        {color.reference}
                                                      </span>
                                                    ) : null}
                                                    {color.reference ? (
                                                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#cdbfb1]">-</span>
                                                    ) : null}
                                                    <span>{color.name}</span>
                                                  </span>
                                                </td>
                                                {variantMatrixSizes.map((size) => {
                                                  const quantity = getVariantQuantityForCell(color.name, size);
                                                  return (
                                                    <td key={`${color.name}-${size}`} className="px-4 py-3 text-center">
                                                      <span className={quantity > 0 ? "font-semibold text-white" : "text-[#7d6f63]"}>{formatNumber(quantity)}</span>
                                                    </td>
                                                  );
                                                })}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4 text-sm text-[#d8cabc]">
                                        Cet article n&apos;a pas de variantes. Stock direct disponible dans cette boutique : {formatNumber(
                                          item.locations.find((location) => location.warehouseId === expandedWarehouse.id)?.quantity ?? 0
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm text-[#cdbfb1] md:flex-row md:items-center md:justify-between">
                  <div>Page {currentPage} / {totalPages} - {formatNumber(filteredOverview.length)} article(s)</div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>Precedent</Button>
                    <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages}>Suivant</Button>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        ) : activeTab === "negative" ? (
          <SectionCard
            title="Stock negatif"
            description={`${formatNumber(filteredNegativeRows.length)} ligne(s) negative(s) detectee(s) par boutique.`}
            actions={
              <Input
                className="w-full min-w-[260px] md:w-[320px]"
                placeholder="Rechercher un article, une reference ou une boutique..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            }
          >
            {filteredNegativeRows.length === 0 ? (
              <EmptyState title="Aucun stock negatif" description="Les boutiques en stock negatif apparaitront ici." compact />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th>Reference</th>
                      <th>Boutique</th>
                      <th>Stock boutique</th>
                      <th>Stock global</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNegativeRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <div className="font-medium text-white">{row.productName}</div>
                          <div className="mt-1 text-xs text-[#8f8073]">Min {formatNumber(row.minStock)}</div>
                        </td>
                        <td>{row.reference || "Sans reference"}</td>
                        <td className={row.warehouseId === currentWarehouseId ? "text-orange-100" : undefined}>
                          <div>{row.warehouseName}</div>
                          {row.warehouseType === "WAREHOUSE" ? (
                            <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[#b9aa9b]">Entrepot</div>
                          ) : null}
                        </td>
                        <td>
                          <span className="inline-flex min-w-[52px] items-center justify-center rounded-full border border-rose-300/30 bg-rose-400/10 px-2.5 py-1 text-xs font-semibold text-rose-100">
                            {formatNumber(row.quantity)}
                          </span>
                        </td>
                        <td className={row.stockOnHand < 0 ? "font-semibold text-rose-200" : undefined}>{formatNumber(row.stockOnHand)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        ) : (
          <SectionCard title="Historique des mouvements">
            {movements.length === 0 ? (
              <EmptyState title="Aucun mouvement" description="Les operations de stock apparaitront ici des la premiere reception, vente ou transfert." compact />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th>Depot / boutique</th>
                      <th>Type</th>
                      <th>Qte</th>
                      <th>Avant / Apres</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.id}>
                        <td>
                          <div className="font-medium text-white">{movement.product.name}</div>
                          <div className="mt-1 text-xs text-[#baa999]">{movement.notes ?? "Sans note"}</div>
                        </td>
                        <td>{movement.warehouse.name}</td>
                        <td><Badge tone={movement.type === "OUT" || movement.type === "TRANSFER_OUT" ? "danger" : movement.type === "ADJUSTMENT" ? "warning" : "success"}>{movement.type}</Badge></td>
                        <td>{formatNumber(movement.quantity)}</td>
                        <td>{formatNumber(movement.beforeStock)}{" -> "}{formatNumber(movement.afterStock)}</td>
                        <td>{formatDateTime(movement.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}
      </div>

      {adjustmentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={() => !saving && setAdjustmentModalOpen(false)}>
          <div className="w-full max-w-[720px] rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Stock</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Ajustement de stock</h2>
              </div>
              <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={() => !saving && setAdjustmentModalOpen(false)} aria-label="Fermer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 px-5 py-5 md:px-6" onSubmit={submitAdjustment}>
              <Field label="Article">
                <div className="space-y-3">
                  <Input placeholder="Rechercher par reference ou article..." value={adjustmentSearch} onChange={(e) => setAdjustmentSearch(e.target.value)} />
                  <Select value={form.productId} onChange={(e) => setForm((current) => ({ ...current, productId: e.target.value, variantId: "" }))}>
                    {adjustmentProducts.map((product) => <option key={product.id} value={product.id}>{product.reference ? `${product.reference} - ` : ""}{product.name}</option>)}
                  </Select>
                </div>
              </Field>
              {selectedAdjustmentProduct?.variants.length ? (
                <Field label="Variante">
                  <div className="max-h-[220px] space-y-2 overflow-auto rounded-[20px] border border-white/10 bg-black/20 p-2">
                    {selectedAdjustmentProduct.variants.map((variant) => {
                      const available = getVariantAvailableQuantity(variant, form.warehouseId);
                      const isSelected = form.variantId === variant.id;
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, variantId: variant.id }))}
                          className={isSelected
                            ? "flex w-full items-center justify-between rounded-[18px] border border-orange-300/35 bg-orange-300/12 px-3 py-2.5 text-left"
                            : "flex w-full items-center justify-between rounded-[18px] border border-white/10 bg-[#120e0c] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-black/25"}
                        >
                          <span className="pr-3 text-sm font-medium text-white">{formatVariantDisplayLabel(variant)}</span>
                          <span className={available > 0
                            ? "inline-flex min-w-[34px] items-center justify-center rounded-full bg-orange-300/18 px-2.5 py-1 text-xs font-semibold text-white"
                            : "inline-flex min-w-[34px] items-center justify-center rounded-full bg-white/8 px-2.5 py-1 text-xs font-semibold text-[#b9aa9b]"}
                          >
                            {formatNumber(available)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Field>
              ) : null}
              <Field label="Depot / boutique">
                <Select value={form.warehouseId} onChange={(e) => setForm((current) => ({ ...current, warehouseId: e.target.value }))}>
                  {operationalWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </Select>
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Quantite actuelle</div>
                  <div className="mt-2 text-lg font-semibold text-white">{formatNumber(adjustmentCurrentQuantity)}</div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Quantite apres ajustement</div>
                  <div className={`mt-2 text-lg font-semibold ${adjustmentBlocked ? "text-rose-200" : "text-white"}`}>{formatNumber(adjustmentNextQuantity)}</div>
                </div>
              </div>
              <Field label="Quantite a ajuster (+ / -)">
                <Input type="number" value={form.quantity} onChange={(e) => setForm((current) => ({ ...current, quantity: e.target.value }))} />
              </Field>
              {adjustmentVariantRequired ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  Choisis la variante a ajuster pour cet article.
                </div>
              ) : null}
              {adjustmentNextQuantity < 0 ? (
                <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  Quantite insuffisante sur cet emplacement pour faire cet ajustement.
                </div>
              ) : null}
              <Field label="Motif">
                <Input value={form.reason} onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))} />
              </Field>

              <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
                <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={() => !saving && setAdjustmentModalOpen(false)}>Annuler</Button>
                <Button type="submit" className="!h-9 !px-3.5 !text-[12px]" disabled={adjustmentBlocked || saving}>{saving ? "Enregistrement..." : "Valider l'ajustement"}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {transferModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={closeTransferModal}>
          <div className="flex h-[calc(100vh-2rem)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)] md:h-[700px]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Stock</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Transfert entre entrepot et boutiques</h2>
              </div>
              <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={closeTransferModal} aria-label="Fermer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="flex min-h-0 flex-1 flex-col" onSubmit={submitTransfer}>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 md:px-6">
                <Field label="Article">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Input
                      placeholder="Rechercher par reference ou article..."
                      value={transferSearch}
                      onChange={(event) => setTransferSearch(event.target.value)}
                    />
                    <Select
                      value={transferForm.productId}
                      onChange={(event) => setTransferForm((current) => ({
                        ...current,
                        productId: event.target.value,
                        variantId: "",
                        fromWarehouseId: "",
                        toWarehouseId: "",
                        quantity: "1"
                      }))}
                    >
                      {transferProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.reference ? `${product.reference} - ` : ""}{product.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Field>

                {selectedTransferProduct?.variants.length ? (
                  <Field label="Variante">
                    <div className="max-h-[210px] space-y-2 overflow-auto rounded-[20px] border border-white/10 bg-black/20 p-2">
                      {selectedTransferProduct.variants.map((variant) => {
                        const totalAvailable = variant.locations.reduce((sum, location) => sum + location.quantity, 0);
                        const isSelected = transferForm.variantId === variant.id;
                        return (
                          <button
                            key={variant.id}
                            type="button"
                            onClick={() => setTransferForm((current) => ({
                              ...current,
                              variantId: variant.id,
                              fromWarehouseId: "",
                              toWarehouseId: "",
                              quantity: "1"
                            }))}
                            className={isSelected
                              ? "flex w-full items-center justify-between rounded-[18px] border border-[#ff9d2f] bg-[#ff9d2f] px-3 py-2.5 text-left shadow-[0_10px_30px_rgba(255,157,47,0.18)]"
                              : "flex w-full items-center justify-between rounded-[18px] border border-white/10 bg-[#120e0c] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-black/25"}
                          >
                            <span className={`pr-3 text-sm font-medium ${isSelected ? "text-[#1e1209]" : "text-white"}`}>{formatVariantDisplayLabel(variant)}</span>
                            <span className={isSelected
                              ? "inline-flex min-w-[34px] items-center justify-center rounded-full bg-[#1e1209]/10 px-2.5 py-1 text-xs font-semibold text-[#1e1209]"
                              : totalAvailable > 0
                                ? "inline-flex min-w-[34px] items-center justify-center rounded-full bg-orange-300/18 px-2.5 py-1 text-xs font-semibold text-white"
                                : "inline-flex min-w-[34px] items-center justify-center rounded-full bg-white/8 px-2.5 py-1 text-xs font-semibold text-[#b9aa9b]"}
                            >
                              {formatNumber(totalAvailable)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-[1.2fr_220px_1.2fr]">
                  <Field label="Source">
                    <div className="max-h-[230px] space-y-2 overflow-auto rounded-[20px] border border-white/10 bg-black/20 p-2">
                      {transferVariantRequired ? (
                        <div className="px-3 py-4 text-sm text-[#cdbfb1]">Choisis d&apos;abord la variante a transferer.</div>
                      ) : transferSourceWarehouses.map((warehouse) => {
                        const available = getWarehouseAvailableQuantity(selectedTransferProduct ?? null, selectedTransferVariant, warehouse.id);
                        const isSelected = transferForm.fromWarehouseId === warehouse.id;
                        return (
                          <button
                            key={warehouse.id}
                            type="button"
                            onClick={() => setTransferForm((current) => ({
                              ...current,
                              fromWarehouseId: warehouse.id,
                              toWarehouseId: current.toWarehouseId === warehouse.id ? "" : current.toWarehouseId
                            }))}
                            className={isSelected
                              ? "flex w-full items-center justify-between rounded-[18px] border border-[#ff9d2f] bg-[#ff9d2f] px-3 py-2.5 text-left shadow-[0_10px_30px_rgba(255,157,47,0.18)]"
                              : "flex w-full items-center justify-between rounded-[18px] border border-white/10 bg-[#120e0c] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-black/25"}
                          >
                            <span className={`pr-3 text-sm font-medium ${isSelected ? "text-[#1e1209]" : "text-white"}`}>{warehouse.name}</span>
                            <span className={isSelected
                              ? "inline-flex min-w-[36px] items-center justify-center rounded-full bg-[#1e1209]/10 px-2.5 py-1 text-xs font-semibold text-[#1e1209]"
                              : "inline-flex min-w-[36px] items-center justify-center rounded-full bg-orange-300/18 px-2.5 py-1 text-xs font-semibold text-white"}
                            >
                              {formatNumber(available)}
                            </span>
                          </button>
                        );
                      })}
                      {!transferVariantRequired && !transferSourceWarehouses.length ? (
                        <div className="px-3 py-4 text-sm text-[#cdbfb1]">Aucune boutique n&apos;a de stock pour cet article.</div>
                      ) : null}
                    </div>
                  </Field>

                  <Field label="Quantite">
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-3">
                      <Input
                        type="number"
                        min="1"
                        value={transferForm.quantity}
                        onChange={(event) => setTransferForm((current) => ({ ...current, quantity: event.target.value }))}
                      />
                      <div className="mt-3 rounded-[18px] border border-white/10 bg-white/[0.02] px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Dispo source</div>
                        <div className="mt-1 text-lg font-semibold text-white">{formatNumber(transferSourceQuantity)}</div>
                      </div>
                    </div>
                  </Field>

                  <Field label="Destination">
                    <div className="max-h-[230px] space-y-2 overflow-auto rounded-[20px] border border-white/10 bg-black/20 p-2">
                      {!transferForm.fromWarehouseId ? (
                        <div className="px-3 py-4 text-sm text-[#cdbfb1]">Choisis d&apos;abord la boutique source.</div>
                      ) : transferDestinationWarehouses.map((warehouse) => {
                        const available = getWarehouseAvailableQuantity(selectedTransferProduct ?? null, selectedTransferVariant, warehouse.id);
                        const isSelected = transferForm.toWarehouseId === warehouse.id;
                        return (
                          <button
                            key={warehouse.id}
                            type="button"
                            onClick={() => setTransferForm((current) => ({ ...current, toWarehouseId: warehouse.id }))}
                            className={isSelected
                              ? "flex w-full items-center justify-between rounded-[18px] border border-[#ff9d2f] bg-[#ff9d2f] px-3 py-2.5 text-left shadow-[0_10px_30px_rgba(255,157,47,0.18)]"
                              : "flex w-full items-center justify-between rounded-[18px] border border-white/10 bg-[#120e0c] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-black/25"}
                          >
                            <span className={`pr-3 text-sm font-medium ${isSelected ? "text-[#1e1209]" : "text-white"}`}>{warehouse.name}</span>
                            <span className={isSelected
                              ? "inline-flex min-w-[36px] items-center justify-center rounded-full bg-[#1e1209]/10 px-2.5 py-1 text-xs font-semibold text-[#1e1209]"
                              : available > 0
                                ? "inline-flex min-w-[36px] items-center justify-center rounded-full bg-orange-300/18 px-2.5 py-1 text-xs font-semibold text-white"
                                : "inline-flex min-w-[36px] items-center justify-center rounded-full bg-white/8 px-2.5 py-1 text-xs font-semibold text-[#b9aa9b]"}
                            >
                              {formatNumber(available)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>

                {selectedTransferProduct ? (
                  <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                    <div className="grid gap-3 text-sm text-[#d7c8ba] md:grid-cols-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Article</div>
                        <div className="mt-1 font-medium text-white">
                          {selectedTransferProduct.reference ? `${selectedTransferProduct.reference} - ` : ""}{selectedTransferProduct.name}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Variante</div>
                        <div className="mt-1 font-medium text-white">{selectedTransferVariant ? formatVariantDisplayLabel(selectedTransferVariant) : "Article simple"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Stock destination actuel</div>
                        <div className="mt-1 font-medium text-white">{formatNumber(transferDestinationQuantity)}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {transferVariantRequired ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    Choisis la variante de cet article avant de continuer.
                  </div>
                ) : null}
                {!transferSourceWarehouses.length && selectedTransferProduct ? (
                  <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    Cet article n&apos;est disponible dans aucune boutique source pour le moment.
                  </div>
                ) : null}
                {transferRequestedQuantity > transferSourceQuantity && transferForm.fromWarehouseId ? (
                  <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    La quantite a transferer depasse la quantite disponible dans la boutique source.
                  </div>
                ) : null}
                {transferForm.fromWarehouseId === transferForm.toWarehouseId && transferForm.fromWarehouseId ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    Choisis deux boutiques differentes pour finaliser le transfert.
                  </div>
                ) : null}

                <Field label="Motif">
                  <Input value={transferForm.reason} onChange={(e) => setTransferForm((current) => ({ ...current, reason: e.target.value }))} />
                </Field>

              </div>

              <div className="flex justify-end gap-3 border-t border-white/10 px-5 py-4 md:px-6">
                <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={closeTransferModal}>Annuler</Button>
                <Button type="submit" className="!h-9 !px-3.5 !text-[12px]" disabled={transferBlocked || saving}>{saving ? "Enregistrement..." : "Valider le transfert"}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

    </>
  );
}
