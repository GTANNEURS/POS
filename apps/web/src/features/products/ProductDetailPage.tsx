import { useEffect, useMemo, useState } from "react";
import { ImageOff, Printer, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select } from "../../components/ui/primitives";
import { api } from "../../lib/api";
import { buildCode39Svg, canEncodeCode39, normalizeCode39Value } from "../../lib/code39";
import { formatCurrency, formatDateTime, formatNumber } from "../../lib/format";
import { useAuth } from "../../providers/AuthProvider";

type StockMovement = {
  id: string;
  type: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT" | "RETURN_IN" | "RETURN_OUT";
  quantity: number;
  beforeStock: number;
  afterStock: number;
  notes?: string | null;
  createdAt: string;
  warehouse?: { id: string; name: string } | null;
};

type ProductDetail = {
  id: string;
  reference: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  dimensions?: string | null;
  weight?: string | null;
  isTaxExempt: boolean;
  isCommissioned: boolean;
  sourcingMode: "BUY_RESELL" | "CONSIGNMENT" | "MANUFACTURED";
  purchasePriceHt: number;
  purchasePriceTtc: number;
  salePriceHt: number;
  salePriceTtc: number;
  taxRate: number;
  stockOnHand: number;
  minStock: number;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
  type?: { name: string } | null;
  category?: { name: string } | null;
  brand?: { name: string } | null;
  unit?: { name: string } | null;
  warehouse?: { name: string } | null;
  variants: Array<{
    id: string;
    label: string;
    size?: string | null;
    color?: string | null;
    colorReference?: string | null;
    reference?: string | null;
    barcode?: string | null;
    stockOnHand: number;
    locationBalances: Array<{ warehouseId: string; warehouseName?: string | null; quantity: number }>;
  }>;
  locationBalances: Array<{ warehouseId: string; warehouseName?: string | null; quantity: number }>;
  stockMovements: StockMovement[];
};

type LabelOption = {
  id: string;
  title: string;
  categoryLabel: string;
  subtitle: string;
  reference: string;
  barcode: string;
  priceLabel: string;
};

const movementLabels: Record<StockMovement["type"], string> = {
  IN: "Entree",
  OUT: "Sortie",
  ADJUSTMENT: "Ajustement",
  TRANSFER_IN: "Transfert entrant",
  TRANSFER_OUT: "Transfert sortant",
  RETURN_IN: "Retour entrant",
  RETURN_OUT: "Retour sortant"
};

const sourcingLabels: Record<ProductDetail["sourcingMode"], string> = {
  BUY_RESELL: "Achete / revendu",
  CONSIGNMENT: "Depot de vente",
  MANUFACTURED: "Fabrique"
};

function buildShortLabelReference(reference: string) {
  const normalized = String(reference ?? "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized.includes("-SIZ-")) {
    return normalized.split("-SIZ-")[0] ?? normalized;
  }
  return normalized;
}

export function ProductDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [item, setItem] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariantWarehouseId, setSelectedVariantWarehouseId] = useState<string | null>(null);
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [labelQuantity, setLabelQuantity] = useState("1");

  useEffect(() => {
    if (!id) {
      setError("Article introuvable.");
      setLoading(false);
      return;
    }

    api<ProductDetail>(`/products/${id}`)
      .then(setItem)
      .catch((err) => setError(err instanceof Error ? err.message : "Impossible de charger la fiche article."))
      .finally(() => setLoading(false));
  }, [id]);

  const initials = useMemo(() => {
    if (!item?.name) return "AR";
    return item.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "AR";
  }, [item?.name]);
  const isAdminSession = user?.roles.includes("admin") ?? false;
  const scopedWarehouseName = !isAdminSession ? (user?.defaultWarehouse?.name ?? item?.warehouse?.name ?? null) : null;
  const orderedLocationBalances = useMemo(() => {
    if (!item) return [];
    if (!user?.defaultWarehouse?.id) return item.locationBalances;
    const current = item.locationBalances.find((location) => location.warehouseId === user.defaultWarehouse?.id);
    const others = item.locationBalances.filter((location) => location.warehouseId !== user.defaultWarehouse?.id);
    return current ? [current, ...others] : item.locationBalances;
  }, [item, user?.defaultWarehouse?.id]);
  const variantMatrixWarehouses = useMemo(() => {
    if (!item) return [];
    if (!user?.defaultWarehouse?.id) return item.locationBalances;
    const current = item.locationBalances.find((location) => location.warehouseId === user.defaultWarehouse?.id);
    const others = item.locationBalances.filter((location) => location.warehouseId !== user.defaultWarehouse?.id);
    return current ? [current, ...others] : item.locationBalances;
  }, [item, user?.defaultWarehouse?.id]);
  const variantMatrixColors = useMemo(() => {
    if (!item) return [];
    const colorMap = new Map<string, { name: string; reference?: string | null }>();
    item.variants.forEach((variant) => {
      const name = variant.color?.trim() || "Sans couleur";
      if (!colorMap.has(name)) {
        colorMap.set(name, { name, reference: variant.colorReference?.trim() || null });
      }
    });
    return Array.from(colorMap.values());
  }, [item]);
  const variantMatrixSizes = useMemo(() => {
    if (!item) return [];
    return Array.from(new Set(item.variants.map((variant) => variant.size?.trim() || "Sans taille")));
  }, [item]);
  const activeVariantWarehouseId = useMemo(() => {
    if (!variantMatrixWarehouses.length) return null;
    if (selectedVariantWarehouseId && variantMatrixWarehouses.some((location) => location.warehouseId === selectedVariantWarehouseId)) {
      return selectedVariantWarehouseId;
    }
    return variantMatrixWarehouses[0]?.warehouseId ?? null;
  }, [selectedVariantWarehouseId, variantMatrixWarehouses]);
  const activeVariantWarehouse = useMemo(
    () => variantMatrixWarehouses.find((location) => location.warehouseId === activeVariantWarehouseId) ?? null,
    [activeVariantWarehouseId, variantMatrixWarehouses]
  );
  const selectedWarehouseVariantTotal = useMemo(() => {
    if (!item || !activeVariantWarehouseId) return 0;
    return item.variants.reduce(
      (sum, variant) => sum + (variant.locationBalances.find((location) => location.warehouseId === activeVariantWarehouseId)?.quantity ?? 0),
      0
    );
  }, [activeVariantWarehouseId, item]);
  const labelOptions = useMemo<LabelOption[]>(() => {
    if (!item) return [];

    const options: LabelOption[] = [];
    const articleBarcode = String(item.barcode ?? "").trim();
    if (articleBarcode) {
      options.push({
        id: `product:${item.id}`,
        title: item.name,
        categoryLabel: item.category?.name ?? "Sans categorie",
        subtitle: "",
        reference: buildShortLabelReference(item.reference),
        barcode: articleBarcode,
        priceLabel: formatCurrency(Number(item.salePriceTtc))
      });
    }

    item.variants.forEach((variant) => {
      const variantBarcode = String(variant.barcode ?? "").trim();
      if (!variantBarcode) return;
      const variantLine = [variant.color?.trim(), variant.size?.trim()].filter(Boolean).join(" - ") || variant.label;
      options.push({
        id: `variant:${variant.id}`,
        title: item.name,
        categoryLabel: item.category?.name ?? "Sans categorie",
        subtitle: variantLine,
        reference: buildShortLabelReference(String(variant.reference ?? item.reference)),
        barcode: variantBarcode,
        priceLabel: formatCurrency(Number(item.salePriceTtc))
      });
    });

    return options;
  }, [item]);
  const selectedLabelOption = useMemo(
    () => labelOptions.find((option) => option.id === selectedLabelId) ?? labelOptions[0] ?? null,
    [labelOptions, selectedLabelId]
  );
  const labelPreviewSvg = useMemo(() => {
    if (!selectedLabelOption) return "";
    return buildCode39Svg(selectedLabelOption.barcode, { height: 46, narrowBarWidth: 1.6, wideBarWidth: 4.2, quietZone: 10 });
  }, [selectedLabelOption]);

  useEffect(() => {
    if (!variantMatrixWarehouses.length) {
      setSelectedVariantWarehouseId(null);
      return;
    }

    setSelectedVariantWarehouseId((current) => {
      if (current && variantMatrixWarehouses.some((location) => location.warehouseId === current)) {
        return current;
      }
      return user?.defaultWarehouse?.id ?? variantMatrixWarehouses[0]?.warehouseId ?? null;
    });
  }, [user?.defaultWarehouse?.id, variantMatrixWarehouses]);

  useEffect(() => {
    if (!labelOptions.length) {
      setSelectedLabelId("");
      return;
    }

    setSelectedLabelId((current) => {
      if (current && labelOptions.some((option) => option.id === current)) {
        return current;
      }
      return labelOptions[0].id;
    });
  }, [labelOptions]);

  function getVariantMatrixQuantity(color: string, size: string, warehouseId: string | null) {
    if (!item || !warehouseId) return 0;
    return item.variants
      .filter((variant) => (variant.color?.trim() || "Sans couleur") === color && (variant.size?.trim() || "Sans taille") === size)
      .reduce(
        (sum, variant) => sum + (variant.locationBalances.find((location) => location.warehouseId === warehouseId)?.quantity ?? 0),
        0
      );
  }

  function printBarcodeLabels() {
    if (!selectedLabelOption) return;
    const copies = Math.max(1, Math.min(200, Number.parseInt(labelQuantity, 10) || 1));
    const encodedBarcode = normalizeCode39Value(selectedLabelOption.barcode);
    if (!canEncodeCode39(encodedBarcode)) {
      window.alert("Code-barres incompatible avec l'impression etiquette.");
      return;
    }

    const barcodeSvg = buildCode39Svg(encodedBarcode, { height: 62, narrowBarWidth: 1.8, wideBarWidth: 4.6, quietZone: 12 });
    const labelsMarkup = Array.from({ length: copies }, () => `
      <section class="label">
        <div class="title">${selectedLabelOption.title}</div>
        <div class="category">${selectedLabelOption.categoryLabel}</div>
        ${selectedLabelOption.subtitle ? `<div class="subtitle">${selectedLabelOption.subtitle}</div>` : ""}
        <div class="meta-row">
          <div class="reference">${selectedLabelOption.reference}</div>
          <div class="price">${selectedLabelOption.priceLabel}</div>
        </div>
        <div class="barcode-wrap">${barcodeSvg}</div>
        <div class="barcode-text">${encodedBarcode}</div>
      </section>
    `).join("");

    const popup = window.open("", "_blank", "width=900,height=720");
    if (!popup) return;

    popup.document.write(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Etiquettes code-barres - ${selectedLabelOption.reference}</title>
          <style>
            @page { size: 50mm 30mm; margin: 0; }
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; background: #ffffff; font-family: Arial, sans-serif; }
            body { display: block; }
            .label {
              width: 50mm;
              height: 30mm;
              padding: 2.2mm 2.2mm 1.8mm;
              page-break-after: always;
              overflow: hidden;
              display: flex;
              flex-direction: column;
              justify-content: flex-start;
              gap: 1mm;
            }
            .label:last-child { page-break-after: auto; }
            .title {
              font-size: 5.9pt;
              line-height: 1.05;
              font-weight: 500;
              color: #111111;
              max-height: 4.6mm;
              overflow: hidden;
            }
            .category {
              font-size: 7.3pt;
              line-height: 1.05;
              font-weight: 700;
              color: #111111;
              min-height: 3.4mm;
            }
            .subtitle {
              font-size: 6.1pt;
              line-height: 1.05;
              color: #111111;
              min-height: 2.6mm;
            }
            .meta-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 2mm;
            }
            .reference {
              font-size: 6.7pt;
              line-height: 1;
              font-weight: 700;
              letter-spacing: 0.03em;
              color: #111111;
            }
            .price {
              font-size: 6.7pt;
              line-height: 1;
              font-weight: 700;
              color: #111111;
              white-space: nowrap;
              text-align: right;
            }
            .barcode-wrap {
              display: flex;
              align-items: center;
              justify-content: center;
              width: 100%;
              height: 11.5mm;
              margin-top: 0.4mm;
            }
            .barcode-wrap svg {
              width: 100%;
              height: 100%;
              display: block;
            }
            .barcode-text {
              text-align: center;
              font-size: 7pt;
              line-height: 1;
              font-weight: 700;
              letter-spacing: 0.08em;
              color: #111111;
            }
          </style>
        </head>
        <body>
          ${labelsMarkup}
          <script>
            window.onload = function () {
              window.print();
              setTimeout(function () { window.close(); }, 220);
            };
          </script>
        </body>
      </html>
    `);
    popup.document.close();
  }

  if (loading) return <LoadingBlock label="Chargement de la fiche article..." />;
  if (error || !item) {
    return (
      <EmptyState
        title="Fiche article indisponible"
        description={error ?? "Impossible de trouver cet article."}
        action={<Link to="/gestion/produits" className="btn-secondary">Retour a la liste</Link>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Articles"
        title={item.name}
        titleClassName="!text-[1.28rem] md:!text-[1.4rem]"
        description={`Reference ${item.reference}${item.barcode ? ` - ${item.barcode}` : ""}`}
        actions={(
          <>
            <Button variant="secondary" className="!px-4 !py-2 !text-sm" onClick={() => setLabelModalOpen(true)} disabled={!labelOptions.length}>
              <span className="inline-flex items-center gap-2">
                <Printer className="h-4 w-4" />
                Imprimer etiquettes
              </span>
            </Button>
            <Link to="/gestion/produits" className="btn-secondary !px-4 !py-2 !text-sm">Retour a la liste</Link>
          </>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <SectionCard title="Photo article">
          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt={item.name} className="h-[360px] w-full object-cover" />
            ) : (
              <div className="flex h-[360px] flex-col items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,155,59,0.24),transparent_36%),linear-gradient(180deg,#18120e,#0f0b08)] text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-[28px] border border-white/10 bg-white/5 text-3xl font-semibold text-orange-100">
                  {initials}
                </div>
                <div className="mt-5 flex items-center gap-2 text-sm text-[#c8b9aa]">
                  <ImageOff className="h-4 w-4" />
                  Aucune photo disponible
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Fiche article">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Categorie</p>
              <p className="mt-2 text-base font-semibold text-white">{item.category?.name ?? "Sans categorie"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Marque</p>
              <p className="mt-2 text-base font-semibold text-white">{item.brand?.name ?? "Sans marque"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">{scopedWarehouseName ? `Stock ${scopedWarehouseName}` : "Stock global"}</p>
              <p className={item.stockOnHand < 0 ? "mt-2 text-base font-semibold text-rose-200" : "mt-2 text-base font-semibold text-white"}>{formatNumber(item.stockOnHand)} {item.unit?.name ?? "unites"}</p>
              <p className="mt-1 text-xs text-[#b9aa9b]">Minimum {formatNumber(item.minStock)}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Statut</p>
              <div className="mt-2">
                <Badge tone={item.status === "ACTIVE" ? (item.stockOnHand < 0 ? "danger" : item.stockOnHand <= item.minStock ? "warning" : "success") : "danger"}>
                  {item.status === "ACTIVE" ? (item.stockOnHand < 0 ? "Negatif" : "Actif") : "Inactif"}
                </Badge>
              </div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Prix vente TTC</p>
              <p className="mt-2 text-base font-semibold text-white">{formatCurrency(Number(item.salePriceTtc))}</p>
              <p className="mt-1 text-xs text-[#b9aa9b]">HT {formatCurrency(Number(item.salePriceHt))}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Prix achat TTC</p>
              <p className="mt-2 text-base font-semibold text-white">{formatCurrency(Number(item.purchasePriceTtc))}</p>
              <p className="mt-1 text-xs text-[#b9aa9b]">HT {formatCurrency(Number(item.purchasePriceHt))}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Type / depot</p>
              <p className="mt-2 text-base font-semibold text-white">{item.type?.name ?? "-"}</p>
              <p className="mt-1 text-xs text-[#b9aa9b]">{item.warehouse?.name ?? "Aucun depot"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">TVA / mise a jour</p>
              <p className="mt-2 text-base font-semibold text-white">{formatNumber(Number(item.taxRate))}%</p>
              <p className="mt-1 text-xs text-[#b9aa9b]">Maj {formatDateTime(item.updatedAt)}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Dimension</p>
              <p className="mt-2 text-base font-semibold text-white">{item.dimensions || "Non renseignee"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Poid</p>
              <p className="mt-2 text-base font-semibold text-white">{item.weight || "Non renseigne"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Detaxable</p>
              <p className="mt-2 text-base font-semibold text-white">{item.isTaxExempt ? "Oui" : "Non"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Commission</p>
              <p className="mt-2 text-base font-semibold text-white">{item.isCommissioned ? "Oui" : "Non"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Mode article</p>
              <p className="mt-2 text-base font-semibold text-white">{sourcingLabels[item.sourcingMode]}</p>
            </div>
          </div>

          <div className="mt-5 rounded-[22px] border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[#bdaa98]">Description</p>
            <p className="mt-2 text-sm leading-7 text-[#eadfd4]">{item.description || "Aucune description disponible."}</p>
          </div>
        </SectionCard>
      </div>

      <div className="space-y-6">
        <SectionCard title="Variantes">
          {item.variants.length === 0 ? (
            <EmptyState title="Aucune variante" description="Cet article n'a pas encore de variante definie." compact />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {variantMatrixWarehouses.map((location) => {
                  const isActive = location.warehouseId === activeVariantWarehouseId;
                  return (
                    <button
                      key={location.warehouseId}
                      type="button"
                      onClick={() => setSelectedVariantWarehouseId(location.warehouseId)}
                      className={isActive
                        ? "rounded-[22px] border border-orange-300/35 bg-orange-300/12 px-4 py-3 text-left"
                        : "rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-left transition hover:border-white/20 hover:bg-black/25"}
                    >
                      <div className="text-sm font-semibold text-white">{location.warehouseName || "Boutique"}</div>
                      <div className="mt-1 text-xs text-[#b9aa9b]">
                        {location.warehouseId === user?.defaultWarehouse?.id ? "Boutique courante" : "Autre boutique"}
                      </div>
                      <div className={location.quantity < 0
                        ? "mt-3 inline-flex rounded-full border border-rose-300/30 bg-rose-400/10 px-3 py-1 text-xs font-semibold text-rose-100"
                        : "mt-3 inline-flex rounded-full bg-white/8 px-3 py-1 text-xs font-semibold text-[#f3e7d8]"}
                      >
                        {formatNumber(location.quantity)} en stock
                      </div>
                    </button>
                  );
                })}
              </div>

              {activeVariantWarehouse ? (
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-300/75">Disponibilite variantes</p>
                      <h3 className="mt-1 text-base font-semibold text-white">{activeVariantWarehouse.warehouseName || "Boutique"}</h3>
                    </div>
                    <div className={selectedWarehouseVariantTotal < 0
                      ? "rounded-[18px] border border-rose-300/30 bg-rose-400/10 px-4 py-2 text-right"
                      : "rounded-[18px] border border-white/10 bg-white/5 px-4 py-2 text-right"}
                    >
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#b9aa9b]">Total boutique</p>
                      <p className={selectedWarehouseVariantTotal < 0 ? "mt-1 text-lg font-semibold text-rose-100" : "mt-1 text-lg font-semibold text-white"}>{formatNumber(selectedWarehouseVariantTotal)}</p>
                    </div>
                  </div>

                  <div className="overflow-auto rounded-[20px] border border-white/10">
                    <table className="w-full min-w-[620px] text-left text-sm">
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
                              const quantity = getVariantMatrixQuantity(color.name, size, activeVariantWarehouseId);
                              return (
                                <td key={`${color.name}-${size}`} className="px-4 py-3 text-center">
                                  <span className={quantity > 0
                                    ? "inline-flex min-w-[42px] items-center justify-center rounded-full bg-orange-300/14 px-2.5 py-1 text-xs font-semibold text-white"
                                    : quantity < 0
                                      ? "inline-flex min-w-[42px] items-center justify-center rounded-full border border-rose-300/30 bg-rose-400/10 px-2.5 py-1 text-xs font-semibold text-rose-100"
                                    : "text-[#7d6f63]"}
                                  >
                                    {formatNumber(quantity)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {item.variants.map((variant) => {
                      const locationQuantity = variant.locationBalances.find((location) => location.warehouseId === activeVariantWarehouseId)?.quantity ?? 0;
                      return (
                        <div key={variant.id} className="rounded-[20px] border border-white/10 bg-[#120e0c] px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{variant.label}</p>
                              <p className="mt-1 text-xs text-[#b9aa9b]">
                                {(variant.color?.trim() || "Sans couleur")} - {(variant.size?.trim() || "Sans taille")}
                              </p>
                            </div>
                            <Badge tone={locationQuantity > 0 ? "success" : locationQuantity < 0 ? "danger" : "danger"}>{formatNumber(locationQuantity)}</Badge>
                          </div>
                          <div className={variant.stockOnHand < 0 ? "mt-3 text-xs text-rose-200" : "mt-3 text-xs text-[#cdbfb1]"}>
                            Stock global variante : {formatNumber(variant.stockOnHand)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Stock par boutique">
          {orderedLocationBalances.length === 0 ? (
            <EmptyState title="Aucun stock" description="Aucun stock disponible pour cet article." compact />
          ) : (
            <div className="space-y-3">
              {orderedLocationBalances.map((location) => (
                <div key={location.warehouseId} className={`flex items-center justify-between rounded-[22px] border px-4 py-3 ${location.warehouseId === user?.defaultWarehouse?.id ? "border-orange-300/30 bg-orange-300/10" : "border-white/10 bg-black/20"}`}>
                  <div>
                    <p className="text-sm font-semibold text-white">{location.warehouseName || "Emplacement"}</p>
                    <p className="mt-1 text-xs text-[#b9aa9b]">{location.warehouseId === user?.defaultWarehouse?.id ? "Boutique courante" : "Autre boutique"}</p>
                  </div>
                  <Badge tone={location.quantity > 0 ? "success" : location.quantity < 0 ? "danger" : "danger"}>{formatNumber(location.quantity)}</Badge>
                </div>
              ))}
            </div>
            )}
          </SectionCard>

        <SectionCard title="Historique stock">
          {item.stockMovements.length === 0 ? (
            <EmptyState title="Aucun mouvement" description="Aucun mouvement de stock n'a encore ete enregistre pour cet article." compact />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mouvement</th>
                    <th>Emplacement</th>
                    <th>Quantite</th>
                    <th>Avant / apres</th>
                    <th>Note</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {item.stockMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{movementLabels[movement.type]}</td>
                      <td>{movement.warehouse?.name || "-"}</td>
                      <td>{formatNumber(movement.quantity)}</td>
                      <td>{formatNumber(movement.beforeStock)} / {formatNumber(movement.afterStock)}</td>
                      <td>{movement.notes || "-"}</td>
                      <td>{formatDateTime(movement.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </SectionCard>
      </div>
      {labelModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] rounded-[28px] border border-white/15 bg-[#17110d] p-4 shadow-2xl md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Imprimer Etiquettes</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Imprimer code-barres</h2>
              </div>
              <button type="button" className="rounded-full border border-white/10 p-2 text-[#eadfd4]" onClick={() => setLabelModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_130px]">
              <Field label="Article / variante">
                <Select value={selectedLabelId} onChange={(event) => setSelectedLabelId(event.target.value)}>
                  {labelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title} - {option.subtitle}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantite">
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={labelQuantity}
                  onChange={(event) => setLabelQuantity(event.target.value)}
                />
              </Field>
            </div>

            {selectedLabelOption ? (
              <div className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{selectedLabelOption.title}</p>
                    <p className="mt-1 text-xs text-[#cdbfb1]">{selectedLabelOption.subtitle}</p>
                  </div>
                  <Badge tone="warning">50 x 30 mm</Badge>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-white px-3 py-3">
                  <p className="truncate text-[7px] font-medium text-[#18120e]">{selectedLabelOption.title}</p>
                  <p className="mt-1 truncate text-[11px] font-semibold text-[#18120e]">{selectedLabelOption.categoryLabel}</p>
                  {selectedLabelOption.subtitle ? <p className="mt-1 truncate text-[9px] text-[#5c5147]">{selectedLabelOption.subtitle}</p> : null}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold tracking-[0.06em] text-[#18120e]">{selectedLabelOption.reference}</p>
                    <p className="whitespace-nowrap text-[10px] font-semibold text-[#18120e]">{selectedLabelOption.priceLabel}</p>
                  </div>
                  <div className="mt-2 h-[58px]" dangerouslySetInnerHTML={{ __html: labelPreviewSvg }} />
                  <p className="mt-1 text-center text-[11px] font-semibold tracking-[0.14em] text-[#18120e]">{normalizeCode39Value(selectedLabelOption.barcode)}</p>
                </div>
              </div>
            ) : (
              <EmptyState title="Aucune etiquette disponible" description="Ajoute un code-barres article ou variante pour lancer l'impression." compact />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setLabelModalOpen(false)}>Fermer</Button>
              <Button type="button" onClick={printBarcodeLabels} disabled={!selectedLabelOption}>Imprimer</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
