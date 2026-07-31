import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Search, Trash2, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { formatCurrency, formatDate, formatNumber } from "../../lib/format";
import { buildPurchaseDocumentsHtml, normalizeCompanySettings } from "./print";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select } from "../../components/ui/primitives";

type PurchaseStatus = "DRAFT" | "ORDERED" | "RECEIVED" | "INVOICED" | "CANCELLED";

type Purchase = {
  id: string;
  number: string;
  status: PurchaseStatus;
  totalAmount: number;
  amountDue: number;
  subtotal?: number;
  taxAmount?: number;
  createdAt: string;
  orderedAt?: string | null;
  receivedAt?: string | null;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string };
  createdBy?: { id: string; fullName: string; email: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    unitCostHt?: number;
    unitCostTtc: number;
    taxRate?: number;
    product: { id: string; name: string };
  }>;
};

type Supplier = { id: string; name: string };
type Product = { id: string; reference: string; barcode?: string | null; name: string; purchasePriceHt: number; purchasePriceTtc: number; taxRate: number };
type Warehouse = { id: string; name: string; type?: string };
type BootstrapPayload = { suppliers: Supplier[]; products: Product[]; warehouses: Warehouse[]; companySettings: Record<string, string> };

type OrderLine = {
  productId: string;
  productName: string;
  quantity: string;
  unitCostHt: string;
  unitCostTtc: string;
  taxRate: string;
};

type PurchaseForm = {
  number: string;
  supplierId: string;
  warehouseId: string;
  status: "DRAFT" | "ORDERED" | "CANCELLED";
  lines: OrderLine[];
};

const blankLine = (): OrderLine => ({
  productId: "",
  productName: "",
  quantity: "1",
  unitCostHt: "0",
  unitCostTtc: "0",
  taxRate: "20"
});

function statusTone(status: PurchaseStatus) {
  if (status === "RECEIVED" || status === "INVOICED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

function statusLabel(status: PurchaseStatus) {
  if (status === "DRAFT") return "Brouillon";
  if (status === "ORDERED") return "BC";
  if (status === "RECEIVED") return "BR";
  if (status === "INVOICED") return "Facturee";
  return "Annulee";
}

function purchaseToForm(purchase: Purchase): PurchaseForm {
  return {
    number: purchase.number,
    supplierId: purchase.supplier.id,
    warehouseId: purchase.warehouse.id,
    status: purchase.status === "RECEIVED" || purchase.status === "INVOICED" ? "ORDERED" : purchase.status,
    lines: purchase.items.map((item) => ({
      productId: item.product.id,
      productName: item.product.name,
      quantity: String(item.quantity),
      unitCostHt: String(item.unitCostHt ?? 0),
      unitCostTtc: String(item.unitCostTtc),
      taxRate: String(item.taxRate ?? 20)
    }))
  };
}

function PurchaseModal({
  open,
  title,
  form,
  suppliers,
  products,
  warehouses,
  saving,
  error,
  onClose,
  onSubmit,
  onChange,
  onLineChange,
  onLinePriceChange,
  onLineTaxRateChange,
  onAddLine,
  onRemoveLine,
  onProductPick
}: {
  open: boolean;
  title: string;
  form: PurchaseForm;
  suppliers: Supplier[];
  products: Product[];
  warehouses: Warehouse[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: <K extends keyof PurchaseForm>(key: K, value: PurchaseForm[K]) => void;
  onLineChange: (index: number, patch: Partial<OrderLine>) => void;
  onLinePriceChange: (index: number, source: "ht" | "ttc", rawValue: string) => void;
  onLineTaxRateChange: (index: number, rawValue: string) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onProductPick: (index: number, product: Product) => void;
}) {
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setPickerIndex(null);
      setPickerSearch("");
    }
  }, [open]);

  if (!open) return null;

    const filteredProducts = products.filter((product) => {
    const query = pickerSearch.trim().toLowerCase();
    if (!query) return true;

    const terms = [
      product.reference,
      product.name,
      product.barcode ?? "",
      String(product.purchasePriceHt ?? ""),
      String(product.purchasePriceTtc ?? "")
    ].join(" ").toLowerCase();

    return terms.includes(query);
  });
  const totals = form.lines.reduce((acc, line) => {
    const quantity = Number(line.quantity || 0) || 0;
    const unitHt = Number(line.unitCostHt || 0) || 0;
    const unitTtc = Number(line.unitCostTtc || 0) || 0;
    acc.totalHt += unitHt * quantity;
    acc.totalTtc += unitTtc * quantity;
    return acc;
  }, { totalHt: 0, totalTtc: 0 });
  const taxAmount = totals.totalTtc - totals.totalHt;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="h-[88vh] w-[1180px] max-w-[1180px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Achats</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="h-[calc(88vh-82px)] space-y-4 overflow-y-auto bg-black/[0.18] px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Numero"><Input value={form.number} onChange={(event) => onChange("number", event.target.value)} /></Field>
            <Field label="Fournisseur"><Select value={form.supplierId} onChange={(event) => onChange("supplierId", event.target.value)}><option value="">Choisir</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</Select></Field>
            <Field label="Depot / magasin"><Select value={form.warehouseId} onChange={(event) => onChange("warehouseId", event.target.value)}><option value="">Choisir</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</Select></Field>
            <Field label="Statut"><Select value={form.status} onChange={(event) => onChange("status", event.target.value as PurchaseForm["status"])}><option value="DRAFT">Brouillon</option><option value="ORDERED">Commande</option><option value="CANCELLED">Annulee</option></Select></Field>
          </div>

          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/15">
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed text-sm text-[#eadfd5]">
                <thead className="bg-white/[0.04] text-left text-[12px] uppercase tracking-[0.16em] text-[#ccbcae]">
                  <tr>
                    <th className="w-[34%] px-3 py-3">Article</th>
                    <th className="w-[9%] px-3 py-3">Qte</th>
                    <th className="w-[12%] px-3 py-3">Achat HT</th>
                    <th className="w-[12%] px-3 py-3">Achat TTC</th>
                    <th className="w-[9%] px-3 py-3">TVA %</th>
                    <th className="w-[14%] px-3 py-3">Total</th>
                    <th className="w-[10%] px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, index) => {
                    const lineTotal = (Number(line.unitCostTtc || 0) || 0) * (Number(line.quantity || 0) || 0);
                    return (
                      <tr key={index} className="border-t border-white/6 align-top">
                        <td className="px-3 py-3">
                          <div className="flex w-full min-w-0 gap-2">
                            <Input
                              className="min-w-0 flex-1"
                              value={line.productName}
                              placeholder="Choisir ou saisir un article"
                              onChange={(event) => onLineChange(index, { productName: event.target.value, productId: "" })}
                            />
                            <Button
                              variant="secondary"
                              className="!h-10 !px-3 !text-[12px]"
                              type="button"
                              onClick={() => {
                                setPickerIndex(index);
                                setPickerSearch(line.productName);
                              }}
                            >
                              <Search className="mr-1.5 h-3.5 w-3.5" />Rechercher
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-3"><Input type="number" min="1" value={line.quantity} onChange={(event) => onLineChange(index, { quantity: event.target.value })} /></td>
                        <td className="px-3 py-3"><Input type="number" step="0.01" value={line.unitCostHt} onChange={(event) => onLinePriceChange(index, "ht", event.target.value)} /></td>
                        <td className="px-3 py-3"><Input type="number" step="0.01" value={line.unitCostTtc} onChange={(event) => onLinePriceChange(index, "ttc", event.target.value)} /></td>
                        <td className="px-3 py-3"><Input type="number" step="0.01" value={line.taxRate} onChange={(event) => onLineTaxRateChange(index, event.target.value)} /></td>
                        <td className="px-3 py-3 align-middle"><span className="inline-flex min-h-[40px] items-center text-nowrap text-[#f6c588]">{formatCurrency(lineTotal)}</span></td>
                        <td className="px-3 py-3 align-middle"><Button variant="secondary" className="!h-10 !px-3 !text-[12px]" type="button" onClick={() => onRemoveLine(index)}>Retirer</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <div className="flex justify-end">
            <div className="w-full max-w-[320px] rounded-[22px] border border-white/10 bg-black/20 p-4">
              <div className="space-y-3 text-sm text-[#eadfd5]">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#bfae9d]">Total Achat HT</span>
                  <span className="font-semibold text-white">{formatCurrency(totals.totalHt)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#bfae9d]">TVA %</span>
                  <span className="font-semibold text-white">{formatCurrency(taxAmount)}</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-4 border-t border-white/10 pt-5 text-[15px]">
                  <span className="leading-none text-[#f1dfcf]">Total Achat TTC</span>
                  <span className="inline-flex items-end pt-1 leading-none font-semibold text-[#f6c588]">{formatCurrency(totals.totalTtc)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-4">
            <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={onAddLine}>Ajouter une ligne</Button>
            <div className="flex gap-3">
              <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={onClose}>Annuler</Button>
              <Button type="submit" className="!h-9 !px-3.5 !text-[12px]">{saving ? "Enregistrement..." : "Enregistrer"}</Button>
            </div>
          </div>
        </form>
      </div>

      {pickerIndex !== null ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px]" onMouseDown={() => setPickerIndex(null)}>
          <div className="w-full max-w-[760px] rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300/75">Articles</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Choisir un article</h3>
              </div>
              <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={() => setPickerIndex(null)} aria-label="Fermer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <Input autoFocus value={pickerSearch} placeholder="Rechercher par reference, nom, code-barres ou prix..." onChange={(event) => setPickerSearch(event.target.value)} />
            <div className="mt-4 max-h-[360px] overflow-y-auto rounded-[16px] border border-white/10 bg-black/10">
              {filteredProducts.length === 0 ? (
                <div className="p-4">
                  <EmptyState compact title="Aucun article" description="Tu peux fermer cette liste et saisir le nom manuellement." />
                </div>
              ) : (
                <div className="divide-y divide-white/6">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="grid w-full grid-cols-[minmax(0,1fr)_260px] items-center gap-4 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                      onClick={() => {
                        onProductPick(pickerIndex, product);
                        setPickerIndex(null);
                        setPickerSearch("");
                      }}
                    >
                      <div className="min-w-0">
                        <span className="block truncate font-medium text-white">{product.name}</span>
                        <span className="mt-1 block truncate text-[11px] text-[#a99685]">Reference: {product.reference}</span>
                      </div>
                      <span className="text-xs text-[#bea993]">HT {formatCurrency(product.purchasePriceHt)} / TTC {formatCurrency(product.purchasePriceTtc)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PurchaseOrderDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [item, setItem] = useState<Purchase | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [companySettings, setCompanySettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PurchaseForm>({ number: "", supplierId: "", warehouseId: "", status: "ORDERED", lines: [blankLine()] });

  async function loadPurchase() {
    if (!id) {
      setError("Bon de commande introuvable.");
      setLoading(false);
      return;
    }

    const [purchase, bootstrap] = await Promise.all([
      api<Purchase>(`/purchases/${id}`),
      api<BootstrapPayload>("/purchases/bootstrap")
    ]);
    setItem(purchase);
    setSuppliers(bootstrap.suppliers);
    setProducts(bootstrap.products);
    setWarehouses(bootstrap.warehouses);
    setCompanySettings(bootstrap.companySettings ?? {});
    setForm(purchaseToForm(purchase));
  }

  useEffect(() => {
    loadPurchase()
      .catch((err) => setError(err instanceof Error ? err.message : "Impossible de charger le bon de commande."))
      .finally(() => setLoading(false));
  }, [id]);

  const createdLabel = useMemo(() => (item ? formatDate(item.createdAt) : "-"), [item]);
  const editable = item ? item.status !== "RECEIVED" && item.status !== "INVOICED" : false;

  function previewDocument(shouldPrint = false) {
    if (!item) return;
    const popup = window.open("", "_blank", "width=1180,height=860");
    if (!popup) return;
    popup.document.write(buildPurchaseDocumentsHtml([item], normalizeCompanySettings(companySettings)));
    popup.document.close();
    if (shouldPrint) {
      popup.focus();
      popup.print();
    }
  }

  function patch<K extends keyof PurchaseForm>(key: K, value: PurchaseForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patchValue: Partial<OrderLine>) {
    setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patchValue } : line)) }));
  }

  function parseMoney(value: string) {
    const normalized = Number(value.replace(",", ".").trim());
    return Number.isFinite(normalized) ? normalized : null;
  }

  function formatMoney(value: number) {
    return value.toFixed(2);
  }

  function syncLinePrice(index: number, source: "ht" | "ttc", rawValue: string) {
    setForm((current) => {
      const lines = current.lines.map((line, lineIndex) => {
        if (lineIndex !== index) return line;

        const rate = parseMoney(line.taxRate) ?? 0;
        const parsedValue = parseMoney(rawValue);

        if (source === "ht") {
          return {
            ...line,
            unitCostHt: rawValue,
            unitCostTtc: parsedValue === null ? "" : formatMoney(parsedValue * (1 + rate / 100))
          };
        }

        return {
          ...line,
          unitCostTtc: rawValue,
          unitCostHt: parsedValue === null ? "" : formatMoney(parsedValue / (1 + rate / 100))
        };
      });

      return { ...current, lines };
    });
  }

  function handleLineTaxRateChange(index: number, rawValue: string) {
    setForm((current) => {
      const lines = current.lines.map((line, lineIndex) => {
        if (lineIndex !== index) return line;

        const rate = parseMoney(rawValue) ?? 0;
        if (line.unitCostHt.trim()) {
          const parsedHt = parseMoney(line.unitCostHt);
          return {
            ...line,
            taxRate: rawValue,
            unitCostTtc: parsedHt === null ? "" : formatMoney(parsedHt * (1 + rate / 100))
          };
        }

        if (line.unitCostTtc.trim()) {
          const parsedTtc = parseMoney(line.unitCostTtc);
          return {
            ...line,
            taxRate: rawValue,
            unitCostHt: parsedTtc === null ? "" : formatMoney(parsedTtc / (1 + rate / 100))
          };
        }

        return { ...line, taxRate: rawValue };
      });

      return { ...current, lines };
    });
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;

    const preparedLines = form.lines.filter((line) => line.productId || line.productName.trim());
    if (!form.supplierId || !form.warehouseId || preparedLines.length === 0) {
      setError("Choisis le fournisseur, le depot et au moins un article.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api(`/purchases/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          number: form.number,
          supplierId: form.supplierId,
          warehouseId: form.warehouseId,
          status: form.status,
          items: preparedLines.map((line) => ({
            productId: line.productId || null,
            productName: line.productName.trim(),
            quantity: Number(line.quantity),
            unitCostHt: Number(line.unitCostHt),
            unitCostTtc: Number(line.unitCostTtc),
            taxRate: Number(line.taxRate)
          }))
        })
      });
      await loadPurchase();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function removePurchase() {
    if (!item) return;
    if (!window.confirm("Supprimer ce bon de commande ?")) return;
    try {
      setError(null);
      await api(`/purchases/${item.id}`, { method: "DELETE" });
      navigate("/achat/bon-de-commande");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  async function receivePurchase() {
    if (!item) return;
    if (!window.confirm("Transformer ce BC en BR ?")) return;
    try {
      setError(null);
      await api(`/purchases/${item.id}/receive`, { method: "POST", body: JSON.stringify({}) });
      await loadPurchase();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transformation impossible.");
    }
  }

  if (loading) return <LoadingBlock label="Chargement du bon de commande..." />;
  if (error || !item) return <EmptyState title="Bon de commande indisponible" description={error ?? "Impossible de trouver ce document."} action={<Link to="/achat/bon-de-commande" className="btn-secondary">Retour a la liste</Link>} />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Achats"
          title={item.number}
          titleClassName="text-[1.7rem] md:text-[1.95rem]"
          description={`Cree le ${createdLabel}`}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => previewDocument(false)}>Visualiser (PDF)</Button>
              <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => previewDocument(true)}>Imprimer</Button>
              {editable ? <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => setModalOpen(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Modifier</Button> : null}
              {editable ? <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => void removePurchase()}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Supprimer</Button> : null}
              {(item.status === "ORDERED" || item.status === "DRAFT") ? <Button className="!h-8 !px-3 !text-[12px]" onClick={() => void receivePurchase()}>Transformer en BR</Button> : null}
              <Link to="/achat/bon-de-commande" className="btn-secondary !h-8 !px-3 !text-[12px]">Retour a la liste</Link>
            </div>
          }
        />

        {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <SectionCard title="Information">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Fournisseur</p><p className="mt-0.5 text-[10px] font-semibold text-white">{item.supplier.name}</p></div>
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Depot</p><p className="mt-0.5 text-[10px] font-semibold text-white">{item.warehouse.name}</p></div>
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Statut</p><p className="mt-1"><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></p></div>
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Createur</p><p className="mt-0.5 text-[10px] font-semibold text-white">{item.createdBy?.fullName ?? "-"}</p></div>
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Date commande</p><p className="mt-0.5 text-[10px] font-semibold text-white">{item.orderedAt ? formatDate(item.orderedAt) : "-"}</p></div>
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Date reception</p><p className="mt-0.5 text-[10px] font-semibold text-white">{item.receivedAt ? formatDate(item.receivedAt) : "-"}</p></div>
          </div>
        </SectionCard>

        <SectionCard title="Details">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Quantite</th>
                  <th>PU HT</th>
                  <th>PU TTC</th>
                  <th>TVA</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {item.items.map((line) => (
                  <tr key={line.id}>
                    <td>{line.product.name}</td>
                    <td>{formatNumber(line.quantity)}</td>
                    <td>{formatCurrency(Number(line.unitCostHt ?? 0))}</td>
                    <td>{formatCurrency(Number(line.unitCostTtc))}</td>
                    <td>{Number(line.taxRate ?? 0)}%</td>
                    <td>{formatCurrency(Number(line.unitCostTtc) * Number(line.quantity))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <SectionCard title="" className="w-full max-w-[340px]">
            <div className="flex flex-col gap-4">
              <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Sous-total</p><p className="mt-0.5 text-[10px] font-semibold text-white">{formatCurrency(Number(item.subtotal ?? 0))}</p></div>
              <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Taxes</p><p className="mt-0.5 text-[10px] font-semibold text-white">{formatCurrency(Number(item.taxAmount ?? 0))}</p></div>
              <div className="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5"><p className="text-[7px] uppercase tracking-[0.12em] text-[#bdaa98]">Montant total</p><p className="mt-0.5 text-[10px] font-semibold text-white">{formatCurrency(Number(item.totalAmount))}</p></div>
            </div>
          </SectionCard>
        </div>
      </div>

      <PurchaseModal
        open={modalOpen}
        title="Modifier le bon de commande"
        form={form}
        suppliers={suppliers}
        products={products}
        warehouses={warehouses}
        saving={saving}
        error={error}
        onClose={closeModal}
        onSubmit={submit}
        onChange={patch}
        onLineChange={setLine}
        onLinePriceChange={syncLinePrice}
        onLineTaxRateChange={handleLineTaxRateChange}
        onAddLine={() => setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }))}
        onRemoveLine={(index) => setForm((current) => ({ ...current, lines: current.lines.length === 1 ? [blankLine()] : current.lines.filter((_, lineIndex) => lineIndex !== index) }))}
        onProductPick={(index, product) => setLine(index, {
          productId: product.id,
          productName: product.name,
          unitCostHt: String(product.purchasePriceHt),
          unitCostTtc: String(product.purchasePriceTtc),
          taxRate: String(product.taxRate)
        })}
      />
    </>
  );
}