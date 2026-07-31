import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Plus, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

type SupplierCreditNote = {
  id: string;
  number: string;
  amount: number;
  reason?: string | null;
  createdAt: string;
  supplier: { id: string; name: string };
};

type SupplierInvoice = {
  id: string;
  number: string;
  amount: number;
  dueDate?: string | null;
  isPaid: boolean;
  paidAmount: number;
  remainingAmount: number;
  statusCode: "PAID" | "PARTIAL" | "UNPAID";
  statusLabel: string;
  createdAt: string;
  supplier: { id: string; name: string };
};

type Supplier = { id: string; name: string };
type Warehouse = { id: string; name: string; type?: string };
type Product = { id: string; reference: string; barcode?: string | null; name: string; purchasePriceHt: number; purchasePriceTtc: number; taxRate: number };
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

const defaultForm = (): PurchaseForm => ({
  number: "",
  supplierId: "",
  warehouseId: "",
  status: "ORDERED",
  lines: [blankLine()]
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

function nextPurchaseNumber(items: Purchase[]) {
  const year = new Date().getFullYear();
  const sequence = String(items.filter((item) => item.number.includes(String(year))).length + 1).padStart(4, "0");
  return `BC-${year}-${sequence}`;
}

type SupplierCreditNoteForm = {
  number: string;
  supplierId: string;
  amount: string;
  reason: string;
};

const defaultSupplierCreditNoteForm = (): SupplierCreditNoteForm => ({
  number: "",
  supplierId: "",
  amount: "0",
  reason: ""
});

function nextSupplierCreditNoteNumber(items: SupplierCreditNote[]) {
  const year = new Date().getFullYear();
  const sequence = String(items.filter((item) => item.number.includes(String(year))).length + 1).padStart(4, "0");
  return `AVF-${year}-${sequence}`;
}

function buildSupplierCreditNotesHtml(items: SupplierCreditNote[], companySettings?: Record<string, string>) {
  const settings = normalizeCompanySettings(companySettings);
  const escapeHtml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const rows = items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.number)}</td>
      <td>${escapeHtml(item.supplier.name)}</td>
      <td>${escapeHtml(item.reason || "-")}</td>
      <td>${escapeHtml(formatDate(item.createdAt))}</td>
      <td style="text-align:right">${escapeHtml(formatCurrency(Number(item.amount)))}</td>
    </tr>
  `).join("");

  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const footer = [settings.address, settings.email, settings.website, settings.patente, settings.ice, settings.rc, settings.cnss].filter(Boolean).join(" | ");

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <title>Avoir fournisseur</title>
      <style>
        body { font-family: Arial, sans-serif; color: #241a12; margin: 28px; }
        .head { display:flex; justify-content:space-between; gap:32px; align-items:flex-start; }
        .brand { max-width: 50%; }
        .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:0.18em; color:#9a5b1f; margin-bottom:10px; }
        h1 { margin:0 0 8px; font-size:28px; }
        .muted { color:#705844; font-size:13px; line-height:1.6; }
        table { width:100%; border-collapse:collapse; margin-top:28px; }
        th, td { border-bottom:1px solid #ead8c7; padding:12px 10px; font-size:13px; vertical-align:top; }
        th { text-align:left; text-transform:uppercase; letter-spacing:0.08em; font-size:11px; color:#7b5c43; }
        .totals { width:320px; margin-left:auto; margin-top:22px; border:1px solid #ead8c7; border-radius:16px; padding:18px; }
        .totals-row { display:flex; justify-content:space-between; gap:18px; margin-bottom:10px; }
        .totals-row:last-child { margin-bottom:0; padding-top:10px; border-top:1px solid #ead8c7; font-weight:700; }
        footer { margin-top:36px; padding-top:12px; border-top:1px solid #ead8c7; font-size:11px; color:#705844; }
      </style>
    </head>
    <body>
      <div class="head">
        <div class="brand">
          <div class="eyebrow">Achats</div>
          <h1>Avoir fournisseur</h1>
          <div class="muted">
            <div>${escapeHtml(settings.companyName)}</div>
            <div>${escapeHtml(settings.address || "")}</div>
            <div>${escapeHtml(settings.email || "")}${settings.website ? ` - ${escapeHtml(settings.website)}` : ""}</div>
          </div>
        </div>
        <div class="muted">
          <div><strong>Documents:</strong> ${items.length}</div>
          <div><strong>Date:</strong> ${escapeHtml(formatDate(new Date().toISOString()))}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Numero</th>
            <th>Fournisseur</th>
            <th>Motif</th>
            <th>Date</th>
            <th style="text-align:right">Montant</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="totals">
        <div class="totals-row"><span>Total des avoirs</span><span>${escapeHtml(formatCurrency(total))}</span></div>
      </div>

      <footer>${escapeHtml(footer)}</footer>
    </body>
  </html>`;
}
function buildSupplierInvoicesHtml(items: SupplierInvoice[], companySettings?: Record<string, string>) {
  const settings = normalizeCompanySettings(companySettings);
  const escapeHtml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const renderLogo = () => {
    if (settings.logoUrl) {
      return `<img src="${escapeHtml(settings.logoUrl)}" alt="Logo" class="logo-image" />`;
    }
    return `<div class="logo-fallback">GDT</div>`;
  };

  const renderInvoice = (item: SupplierInvoice) => `
    <section class="print-page">
      <header class="top-grid">
        <div class="company-panel">
          <div class="brand-row">
            ${renderLogo()}
            <div>
              <div class="company-name">${escapeHtml(settings.companyName)}</div>
              <div class="company-meta">${escapeHtml(settings.address || "Adresse a renseigner")}</div>
              <div class="company-meta">${escapeHtml(settings.email || "Email a renseigner")} | ${escapeHtml(settings.website || "Site web a renseigner")}</div>
            </div>
          </div>
        </div>
        <div class="supplier-panel">
          <div class="panel-title">Fournisseur</div>
        <div class="supplier-name">${escapeHtml(item.supplier.name)}</div>
        <div class="supplier-meta">Facture fournisseur</div>
        <div class="supplier-meta">Statut : ${escapeHtml(item.statusLabel)}</div>
      </div>
      </header>

      <div class="document-strip">
        <div>
          <div class="doc-eyebrow">Facture fournisseur</div>
          <div class="doc-number">${escapeHtml(item.number)}</div>
        </div>
        <div class="doc-meta-block">
          <div><span>Numero :</span> ${escapeHtml(item.number)}</div>
          <div><span>Date :</span> ${escapeHtml(formatDate(item.createdAt))}</div>
          <div><span>Echeance :</span> ${escapeHtml(item.dueDate ? formatDate(item.dueDate) : "A definir")}</div>
          <div><span>Statut :</span> ${escapeHtml(item.statusLabel)}</div>
        </div>
      </div>

      <table class="lines-table">
        <thead>
          <tr>
            <th>Reference</th>
            <th colspan="3">Article / Description</th>
            <th>Qte</th>
            <th>Montant HT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(item.number)}</td>
            <td colspan="3">Facture fournisseur - ${escapeHtml(item.supplier.name)}</td>
            <td class="num">1</td>
            <td class="num">${escapeHtml(formatCurrency(Number(item.amount)))}</td>
          </tr>
        </tbody>
      </table>

      <div class="professional-note">
        Document comptable emis pour suivi des achats fournisseur. Merci de verifier le numero, la date, le fournisseur et le montant avant validation.
      </div>

      <div class="totals-wrap">
        <div class="totals-card">
          <div class="total-row"><span>Montant HT</span><strong>${escapeHtml(formatCurrency(Number(item.amount)))}</strong></div>
          <div class="total-row"><span>TVA</span><strong>${escapeHtml(formatCurrency(0))}</strong></div>
          <div class="total-row"><span>Montant paye</span><strong>${escapeHtml(formatCurrency(Number(item.paidAmount || 0)))}</strong></div>
          <div class="total-row"><span>Reste a payer</span><strong>${escapeHtml(formatCurrency(Number(item.remainingAmount || 0)))}</strong></div>
          <div class="total-row grand"><span>Montant TTC</span><strong>${escapeHtml(formatCurrency(Number(item.amount)))}</strong></div>
        </div>
      </div>

      <div class="signature-grid">
        <div class="signature-card">
          <div class="signature-title">Validation achats</div>
          <div class="signature-line"></div>
        </div>
        <div class="signature-card">
          <div class="signature-title">Signature fournisseur</div>
          <div class="signature-line"></div>
        </div>
      </div>

      <footer class="footer-panel">
        <div>${escapeHtml(settings.companyName)}</div>
        <div>Patente : ${escapeHtml(settings.patente || "Patente a renseigner")} | ICE : ${escapeHtml(settings.ice || "ICE a renseigner")} | RC : ${escapeHtml(settings.rc || "RC a renseigner")} | CNSS : ${escapeHtml(settings.cnss || "CNSS a renseigner")}</div>
        <div>${escapeHtml(settings.address || "Adresse a renseigner")} | ${escapeHtml(settings.email || "Email a renseigner")} | ${escapeHtml(settings.website || "Site web a renseigner")}</div>
      </footer>
    </section>
  `;

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <title>Facture fournisseur</title>
      <style>
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #efe7de; color: #201711; }
        .print-page { width: 210mm; min-height: 297mm; margin: 0 auto 18px; background: #fff; padding: 18mm 16mm 14mm; display: flex; flex-direction: column; gap: 18px; }
        .top-grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 14px; align-items: stretch; }
        .company-panel, .supplier-panel { border: 1px solid #d8c9ba; border-radius: 16px; padding: 16px; }
        .brand-row { display: flex; gap: 14px; align-items: center; }
        .logo-image { width: 84px; height: 84px; object-fit: contain; }
        .logo-fallback { width: 84px; height: 84px; border-radius: 22px; background: linear-gradient(135deg, #1d1612, #5b3b24); color: #f4d2a8; display: grid; place-items: center; font-size: 28px; font-weight: 700; letter-spacing: 0.12em; }
        .company-name { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
        .company-meta, .supplier-meta { font-size: 12px; color: #5e5147; line-height: 1.5; }
        .panel-title { font-size: 11px; font-weight: 700; letter-spacing: 0.22em; color: #a86d3d; text-transform: uppercase; margin-bottom: 8px; }
        .supplier-name { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
        .document-strip { display: flex; justify-content: space-between; align-items: end; gap: 16px; border-bottom: 2px solid #e6d7c8; padding-bottom: 12px; }
        .doc-eyebrow { font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: #a86d3d; font-weight: 700; }
        .doc-number { margin-top: 6px; font-size: 26px; font-weight: 800; letter-spacing: 0.04em; }
        .doc-meta-block { min-width: 250px; border: 1px solid #d8c9ba; border-radius: 16px; padding: 12px 14px; background: #faf6f1; font-size: 12px; line-height: 1.7; }
        .doc-meta-block span { color: #7b6553; font-weight: 600; }
        .lines-table { width: 100%; border-collapse: collapse; }
        .lines-table th:first-child, .lines-table td:first-child { width: 17%; }
        .lines-table th[colspan="3"], .lines-table td[colspan="3"] { width: 53%; }
        .lines-table th:nth-last-child(2), .lines-table td:nth-last-child(2) { width: 10%; }
        .lines-table th:last-child, .lines-table td:last-child { width: 20%; }
        .lines-table th { background: #f4ece3; color: #6f5848; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; padding: 10px 8px; border: 1px solid #dbcdbf; }
        .lines-table td { border: 1px solid #e3d8cc; padding: 9px 8px; font-size: 12px; vertical-align: top; }
        .lines-table td:first-child { font-size: 11px; color: #5f5349; }
        .lines-table td.num { text-align: right; white-space: nowrap; }
        .professional-note { border: 1px dashed #d8c9ba; border-radius: 14px; padding: 12px 14px; background: #fbf7f2; font-size: 12px; color: #6b5a4a; }
        .totals-wrap { display: flex; justify-content: flex-end; }
        .totals-card { width: 320px; border: 1px solid #d8c9ba; border-radius: 18px; overflow: hidden; }
        .total-row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; background: #faf6f1; border-bottom: 1px solid #e4d6c7; font-size: 13px; }
        .total-row.grand { background: linear-gradient(135deg, #231a15, #5b3b24); color: #fff; font-size: 15px; }
        .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: auto; }
        .signature-card { border: 1px solid #d8c9ba; border-radius: 16px; padding: 16px; min-height: 110px; }
        .signature-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #8c6847; margin-bottom: 18px; }
        .signature-line { border-bottom: 1px solid #bda792; margin-top: 44px; }
        .footer-panel { border-top: 2px solid #e6d7c8; padding-top: 10px; text-align: center; font-size: 11px; color: #6d5a4b; line-height: 1.6; }
        .page-break { page-break-before: always; }
        @media print {
          body { background: #fff; }
          .print-page { margin: 0; box-shadow: none; page-break-after: always; }
          .print-page:last-child { page-break-after: auto; }
        }
      </style>
    </head>
    <body>
      ${items.map((item) => renderInvoice(item)).join('<div class="page-break"></div>')}
    </body>
  </html>`;
}

function SelectionToolbar({
  count,
  canTransform,
  canInvoice,
  onClear,
  onTransform,
  onInvoice,
  onPrint,
  onShare,
  onPreview
}: {
  count: number;
  canTransform?: boolean;
  canInvoice?: boolean;
  onClear: () => void;
  onTransform?: () => void;
  onInvoice?: () => void;
  onPrint: () => void;
  onShare: () => void;
  onPreview: () => void;
}) {
  if (!count) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-[22px] border border-orange-300/15 bg-orange-400/5 px-4 py-3">
      <span className="text-sm text-[#f4e8db]">{count} selection{count > 1 ? "s" : ""}</span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {canTransform ? <Button className="!h-8 !px-3 !text-[12px]" onClick={onTransform}>Transformer en BR</Button> : null}
        {canInvoice ? <Button className="!h-8 !px-3 !text-[12px]" onClick={onInvoice}>Facturer</Button> : null}
        <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={onPrint}>Imprimer</Button>
        <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={onShare}>Partager</Button>
        <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={onPreview}>Visualiser (PDF)</Button>
      </div>
    </div>
  );
}

function PurchaseOrderModal({
  open,
  form,
  suppliers,
  warehouses,
  products,
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
  form: PurchaseForm;
  suppliers: Supplier[];
  warehouses: Warehouse[];
  products: Product[];
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
            <h2 className="mt-1 text-xl font-semibold text-white">Nouveau BC</h2>
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

function PurchasesTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  onOpen
}: {
  items: Purchase[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-[48px]"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.id))} onChange={onToggleAll} /></th>
            <th>Numero</th>
            <th>Fournisseur</th>
            <th>Depot</th>
            <th>Statut</th>
            <th>Date</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="cursor-pointer" tabIndex={0} onClick={() => onOpen(item.id)} onKeyDown={(event: ReactKeyboardEvent<HTMLTableRowElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item.id); } }}>
              <td onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
              </td>
              <td>
                <div className="font-medium text-white">{item.number}</div>
                <div className="mt-1 text-xs text-[#b9aa9b]">{formatNumber(item.items.length)} ligne(s)</div>
              </td>
              <td>{item.supplier.name}</td>
              <td>{item.warehouse.name}</td>
              <td><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></td>
              <td>{formatDate(item.createdAt)}</td>
              <td>{formatCurrency(Number(item.totalAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PurchasesPage({ mode }: { mode: "orders" | "receipts" }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Purchase[]>([]);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PurchaseForm>(defaultForm());

  const visibleStatuses = mode === "orders" ? ["DRAFT", "ORDERED", "CANCELLED"] : ["RECEIVED"];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [purchases, boot] = await Promise.all([
        api<Purchase[]>("/purchases"),
        api<BootstrapPayload>("/purchases/bootstrap")
      ]);
      setItems(purchases);
      setBootstrap(boot);
      setForm((current) => current.number ? current : { ...defaultForm(), number: nextPurchaseNumber(purchases) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => items.filter((item) => {
    if (!visibleStatuses.includes(item.status)) return false;
    const haystack = `${item.number} ${item.supplier.name} ${item.warehouse.name}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [items, search, mode]);

  function patch<K extends keyof PurchaseForm>(key: K, value: PurchaseForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patchValue: Partial<OrderLine>) {
    setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patchValue } : line) }));
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

  function openCreateModal() {
    setError(null);
    setForm({ ...defaultForm(), number: nextPurchaseNumber(items) });
    setModalOpen(true);
  }

  function closeCreateModal() {
    if (saving) return;
    setModalOpen(false);
    setError(null);
  }

  function toggleSelect(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    setSelected((current) => visibleIds.every((id) => current.includes(id)) ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  function clearSelection() {
    setSelected([]);
  }

  function openDetails(id: string) {
    navigate(`/achat/bon-de-commande/${id}`);
  }

  function previewSelection(shouldPrint = false) {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const popup = window.open("", "_blank", "width=1180,height=860");
    if (!popup) return;
    popup.document.write(buildPurchaseDocumentsHtml(rows, normalizeCompanySettings(bootstrap?.companySettings)));
    popup.document.close();
    if (shouldPrint) {
      popup.focus();
      popup.print();
    }
  }

  function shareSelection() {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const body = rows.map((item) => `${item.number} - ${item.supplier.name} - ${formatCurrency(Number(item.totalAmount))}`).join("%0D%0A");
    window.location.href = `mailto:?subject=${encodeURIComponent(mode === "orders" ? "Bons de commande" : "Bons de reception")}&body=${body}`;
  }

  async function transformToReceipt() {
    const rows = filtered.filter((item) => selected.includes(item.id) && (item.status === "DRAFT" || item.status === "ORDERED"));
    if (!rows.length) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(rows.map((item) => api(`/purchases/${item.id}/receive`, { method: "POST", body: JSON.stringify({}) })));
      clearSelection();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transformation impossible.");
    } finally {
      setSaving(false);
    }
  }
  async function convertToInvoice() {
    const rows = filtered.filter((item) => selected.includes(item.id) && item.status === "RECEIVED");
    if (!rows.length) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(rows.map((item) => api(`/purchases/${item.id}/invoice`, { method: "POST", body: JSON.stringify({}) })));
      clearSelection();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Facturation impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preparedLines = form.lines.filter((line) => line.productId || line.productName.trim());
    if (!form.supplierId || !form.warehouseId || preparedLines.length === 0) {
      setError("Choisis le fournisseur, le depot et au moins un article.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api("/purchases", {
        method: "POST",
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
      setModalOpen(false);
      setForm(defaultForm());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !bootstrap) {
    return <LoadingBlock label="Chargement des achats..." />;
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow={mode === "orders" ? "Bons de Commande Fournisseurs" : "Bon de Reception fournisseurs"}
          title=""
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void load()}>Actualiser</Button>
              {mode === "orders" ? <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}><Plus className="mr-2 h-4 w-4" />Nouveau BC</Button> : null}
            </>
          }
        />

        <SectionCard
          title="Liste"
          actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder={mode === "orders" ? "Rechercher un BC..." : "Rechercher un BR..."} value={search} onChange={(event) => setSearch(event.target.value)} />}
        >
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <SelectionToolbar
            count={selected.length}
            canTransform={mode === "orders"}
            canInvoice={mode === "receipts"}
            onClear={clearSelection}
            onTransform={mode === "orders" ? () => void transformToReceipt() : undefined}
            onInvoice={mode === "receipts" ? () => void convertToInvoice() : undefined}
            onPrint={() => previewSelection(true)}
            onShare={shareSelection}
            onPreview={() => previewSelection(false)}
          />

          {filtered.length === 0 ? (
            <EmptyState
              compact
              title={mode === "orders" ? "Aucun bon de commande" : "Aucun bon de reception"}
              description={mode === "orders" ? "Cree un premier BC pour demarrer les achats." : "Aucun BR disponible pour le moment."}
              action={mode === "orders" ? <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>Nouveau BC</Button> : undefined}
            />
          ) : (
            <PurchasesTable items={filtered} selected={selected} onToggle={toggleSelect} onToggleAll={toggleAllVisible} onOpen={openDetails} />
          )}
        </SectionCard>
      </div>

      <PurchaseOrderModal
        open={mode === "orders" && modalOpen}
        form={form}
        suppliers={bootstrap?.suppliers ?? []}
        warehouses={bootstrap?.warehouses ?? []}
        products={bootstrap?.products ?? []}
        saving={saving}
        error={error}
        onClose={closeCreateModal}
        onSubmit={submitCreate}
        onChange={patch}
        onLineChange={setLine}
        onLinePriceChange={syncLinePrice}
        onLineTaxRateChange={handleLineTaxRateChange}
        onAddLine={() => patch("lines", [...form.lines, blankLine()])}
        onRemoveLine={(index) => patch("lines", form.lines.length > 1 ? form.lines.filter((_, lineIndex) => lineIndex !== index) : [blankLine()])}
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

export function PurchaseOrdersPage() {
  return <PurchasesPage mode="orders" />;
}

export function GoodsReceiptsPage() {
  return <PurchasesPage mode="receipts" />;
}

function SupplierCreditNoteModal({
  open,
  form,
  suppliers,
  saving,
  error,
  editing,
  onClose,
  onChange,
  onSubmit,
  onDelete
}: {
  open: boolean;
  form: SupplierCreditNoteForm;
  suppliers: Supplier[];
  saving: boolean;
  error: string | null;
  editing: boolean;
  onClose: () => void;
  onChange: <K extends keyof SupplierCreditNoteForm>(key: K, value: SupplierCreditNoteForm[K]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[760px] rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Achats</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{editing ? "Modifier l'avoir fournisseur" : "Nouvel avoir fournisseur"}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Numero"><Input value={form.number} onChange={(event) => onChange("number", event.target.value)} /></Field>
            <Field label="Fournisseur"><Select value={form.supplierId} onChange={(event) => onChange("supplierId", event.target.value)}><option value="">Choisir</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</Select></Field>
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <Field label="Montant"><Input type="number" step="0.01" value={form.amount} onChange={(event) => onChange("amount", event.target.value)} /></Field>
            <Field label="Motif"><Input value={form.reason} onChange={(event) => onChange("reason", event.target.value)} placeholder="Retour, regularisation, remise..." /></Field>
          </div>

          {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-4">
            <div>
              {editing ? <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={onDelete}>Supprimer</Button> : null}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={onClose}>Annuler</Button>
              <Button type="submit" className="!h-9 !px-3.5 !text-[12px]">{saving ? "Enregistrement..." : "Enregistrer"}</Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function SupplierCreditNotesTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  onOpen
}: {
  items: SupplierCreditNote[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (item: SupplierCreditNote) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-[48px]"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.id))} onChange={onToggleAll} /></th>
            <th>Numero</th>
            <th>Fournisseur</th>
            <th>Motif</th>
            <th>Date</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="cursor-pointer" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={(event: ReactKeyboardEvent<HTMLTableRowElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item); } }}>
              <td onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
              </td>
              <td>
                <div className="font-medium text-white">{item.number}</div>
                <div className="mt-1 text-xs text-[#b9aa9b]">Cree le {formatDate(item.createdAt)}</div>
              </td>
              <td>{item.supplier.name}</td>
              <td>{item.reason || "-"}</td>
              <td>{formatDate(item.createdAt)}</td>
              <td>{formatCurrency(Number(item.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SupplierCreditNotesPage() {
  const [items, setItems] = useState<SupplierCreditNote[]>([]);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierCreditNote | null>(null);
  const [form, setForm] = useState<SupplierCreditNoteForm>(defaultSupplierCreditNoteForm());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [creditNotes, boot] = await Promise.all([
        api<SupplierCreditNote[]>("/purchases/supplier-credit-notes"),
        api<BootstrapPayload>("/purchases/bootstrap")
      ]);
      setItems(creditNotes);
      setBootstrap(boot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => items.filter((item) => {
    const haystack = `${item.number} ${item.supplier.name} ${item.reason || ""} ${item.amount}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [items, search]);

  function patch<K extends keyof SupplierCreditNoteForm>(key: K, value: SupplierCreditNoteForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateModal() {
    setEditing(null);
    setError(null);
    setForm({ ...defaultSupplierCreditNoteForm(), number: nextSupplierCreditNoteNumber(items) });
    setModalOpen(true);
  }

  function openEditModal(item: SupplierCreditNote) {
    setEditing(item);
    setError(null);
    setForm({
      number: item.number,
      supplierId: item.supplier.id,
      amount: String(Number(item.amount)),
      reason: item.reason || ""
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setError(null);
  }

  function toggleSelect(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    setSelected((current) => visibleIds.every((id) => current.includes(id)) ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  function previewSelection(shouldPrint = false) {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const popup = window.open("", "_blank", "width=1180,height=860");
    if (!popup) return;
    popup.document.write(buildSupplierCreditNotesHtml(rows, bootstrap?.companySettings));
    popup.document.close();
    if (shouldPrint) {
      popup.focus();
      popup.print();
    }
  }

  function shareSelection() {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const body = rows.map((item) => `${item.number} - ${item.supplier.name} - ${formatCurrency(Number(item.amount))}`).join("%0D%0A");
    window.location.href = `mailto:?subject=${encodeURIComponent("Avoirs fournisseur")}&body=${body}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.number.trim() || !form.supplierId || Number(form.amount) <= 0) {
      setError("Renseigne le numero, le fournisseur et un montant valide.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api(editing ? `/purchases/supplier-credit-notes/${editing.id}` : "/purchases/supplier-credit-notes", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          number: form.number.trim(),
          supplierId: form.supplierId,
          amount: Number(form.amount),
          reason: form.reason.trim()
        })
      });
      setModalOpen(false);
      setEditing(null);
      setForm(defaultSupplierCreditNoteForm());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCurrent() {
    if (!editing) return;
    if (!window.confirm("Supprimer cet avoir fournisseur ?")) return;

    setSaving(true);
    setError(null);
    try {
      await api(`/purchases/supplier-credit-notes/${editing.id}`, { method: "DELETE" });
      setModalOpen(false);
      setEditing(null);
      setForm(defaultSupplierCreditNoteForm());
      setSelected((current) => current.filter((id) => id !== editing.id));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !bootstrap) {
    return <LoadingBlock label="Chargement des avoirs fournisseur..." />;
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Avoirs Fournisseurs"
          title=""
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void load()}>Actualiser</Button>
              <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}><Plus className="mr-2 h-4 w-4" />Nouvel avoir</Button>
            </>
          }
        />

        <SectionCard
          title="Liste"
          actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher un avoir fournisseur..." value={search} onChange={(event) => setSearch(event.target.value)} />}
        >
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <SelectionToolbar
            count={selected.length}
            onClear={() => setSelected([])}
            onPrint={() => previewSelection(true)}
            onShare={shareSelection}
            onPreview={() => previewSelection(false)}
          />

          {filtered.length === 0 ? (
            <EmptyState compact title="Aucun avoir fournisseur" description="Cree un premier avoir fournisseur pour commencer." action={<Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>Nouvel avoir</Button>} />
          ) : (
            <SupplierCreditNotesTable items={filtered} selected={selected} onToggle={toggleSelect} onToggleAll={toggleAllVisible} onOpen={openEditModal} />
          )}
        </SectionCard>
      </div>

      <SupplierCreditNoteModal
        open={modalOpen}
        form={form}
        suppliers={bootstrap?.suppliers ?? []}
        saving={saving}
        error={error}
        editing={Boolean(editing)}
        onClose={closeModal}
        onChange={patch}
        onSubmit={submit}
        onDelete={() => void deleteCurrent()}
      />
    </>
  );
}

type SupplierInvoiceForm = {
  dueDate: string;
  paidAmount: string;
};

function SupplierInvoiceModal({
  open,
  item,
  form,
  saving,
  error,
  onClose,
  onChange,
  onSubmit
}: {
  open: boolean;
  item: SupplierInvoice | null;
  form: SupplierInvoiceForm;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onChange: <K extends keyof SupplierInvoiceForm>(key: K, value: SupplierInvoiceForm[K]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!open || !item) return null;

  const paidAmount = Number(form.paidAmount || 0);
  const remainingAmount = Math.max(0, Number(item.amount) - paidAmount);
  const statusLabel = paidAmount >= Number(item.amount) ? "Payee" : paidAmount > 0 ? "Partiellement payee" : "Impayee";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[760px] rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Achats</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Modifier la facture fournisseur</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Numero</div>
              <div className="mt-2 text-lg font-semibold text-white">{item.number}</div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Fournisseur</div>
              <div className="mt-2 text-lg font-semibold text-white">{item.supplier.name}</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Date d'echeance">
              <Input type="date" value={form.dueDate} onChange={(event) => onChange("dueDate", event.target.value)} />
            </Field>
            <Field label="Montant paye">
              <Input type="number" step="0.01" min="0" max={String(item.amount)} value={form.paidAmount} onChange={(event) => onChange("paidAmount", event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Montant facture</div>
              <div className="mt-2 text-lg font-semibold text-white">{formatCurrency(Number(item.amount))}</div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Reste a payer</div>
              <div className="mt-2 text-lg font-semibold text-white">{formatCurrency(remainingAmount)}</div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#bdaa98]">Statut</div>
              <div className="mt-2"><Badge tone={statusLabel === "Payee" ? "success" : statusLabel === "Partiellement payee" ? "warning" : "danger"}>{statusLabel}</Badge></div>
            </div>
          </div>

          {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={onClose}>Annuler</Button>
            <Button type="submit" className="!h-9 !px-3.5 !text-[12px]">{saving ? "Enregistrement..." : "Enregistrer"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SupplierInvoicesTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  onOpen
}: {
  items: SupplierInvoice[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (item: SupplierInvoice) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-[48px]"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.id))} onChange={onToggleAll} /></th>
            <th>Numero</th>
            <th>Fournisseur</th>
            <th>Echeance</th>
            <th>Statut</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="cursor-pointer" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={(event: ReactKeyboardEvent<HTMLTableRowElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item); } }}>
              <td onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
              </td>
              <td>
                <div className="font-medium text-white">{item.number}</div>
                <div className="mt-1 text-xs text-[#b9aa9b]">Emise le {formatDate(item.createdAt)}</div>
              </td>
              <td>{item.supplier.name}</td>
              <td>{item.dueDate ? formatDate(item.dueDate) : "-"}</td>
              <td><Badge tone={item.statusCode === "PAID" ? "success" : item.statusCode === "PARTIAL" ? "warning" : "danger"}>{item.statusLabel}</Badge></td>
              <td>{formatCurrency(Number(item.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SupplierInvoicesPage() {
  const [items, setItems] = useState<SupplierInvoice[]>([]);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierInvoice | null>(null);
  const [form, setForm] = useState<SupplierInvoiceForm>({ dueDate: "", paidAmount: "0" });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [invoices, boot] = await Promise.all([
        api<SupplierInvoice[]>("/purchases/supplier-invoices"),
        api<BootstrapPayload>("/purchases/bootstrap")
      ]);
      setItems(invoices);
      setBootstrap(boot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => items.filter((item) => {
    const haystack = `${item.number} ${item.supplier.name} ${item.amount}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [items, search]);

  function toggleSelect(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    setSelected((current) => visibleIds.every((id) => current.includes(id)) ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  function patchForm<K extends keyof SupplierInvoiceForm>(key: K, value: SupplierInvoiceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openEditModal(item: SupplierInvoice) {
    setEditing(item);
    setError(null);
    setForm({
      dueDate: item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : "",
      paidAmount: String(Number(item.paidAmount ?? 0))
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setError(null);
  }

  function previewSelection(shouldPrint = false) {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const popup = window.open("", "_blank", "width=1180,height=860");
    if (!popup) return;
    popup.document.write(buildSupplierInvoicesHtml(rows, bootstrap?.companySettings));
    popup.document.close();
    if (shouldPrint) {
      popup.focus();
      popup.print();
    }
  }

  function shareSelection() {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const body = rows.map((item) => `${item.number} - ${item.supplier.name} - ${formatCurrency(Number(item.amount))}`).join("%0D%0A");
    window.location.href = `mailto:?subject=${encodeURIComponent("Factures fournisseur")}&body=${body}`;
  }

  async function submitInvoiceUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    const paidAmount = Number(form.paidAmount || 0);
    if (paidAmount < 0 || paidAmount > Number(editing.amount)) {
      setError("Le montant paye doit etre compris entre 0 et le montant de la facture.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api(`/purchases/supplier-invoices/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          dueDate: form.dueDate || null,
          paidAmount
        })
      });
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise a jour impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock label="Chargement des factures fournisseur..." />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader eyebrow="Factures Fournisseurs" title="" actions={<Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void load()}>Actualiser</Button>} />
        <SectionCard title="Liste" actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher une facture fournisseur..." value={search} onChange={(event) => setSearch(event.target.value)} />}>
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <SelectionToolbar
            count={selected.length}
            onClear={() => setSelected([])}
            onPrint={() => previewSelection(true)}
            onShare={shareSelection}
            onPreview={() => previewSelection(false)}
          />

          {filtered.length === 0 ? <EmptyState compact title="Aucune facture fournisseur" description="Les factures generees depuis les BR apparaitront ici." /> : <SupplierInvoicesTable items={filtered} selected={selected} onToggle={toggleSelect} onToggleAll={toggleAllVisible} onOpen={openEditModal} />}
        </SectionCard>
      </div>

      <SupplierInvoiceModal
        open={modalOpen}
        item={editing}
        form={form}
        saving={saving}
        error={error}
        onClose={closeModal}
        onChange={patchForm}
        onSubmit={submitInvoiceUpdate}
      />
    </>
  );
}
