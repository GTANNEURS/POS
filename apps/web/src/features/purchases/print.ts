import { formatCurrency, formatDate } from "../../lib/format";

type SupplierLike = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
};

type ProductLike = {
  reference?: string | null;
  name: string;
  description?: string | null;
  dimensions?: string | null;
};

type PurchaseItemLike = {
  quantity: number;
  unitCostHt?: number | null;
  unitCostTtc: number;
  taxRate?: number | null;
  product: ProductLike;
};

export type PurchasePrintDocument = {
  number: string;
  status?: string;
  createdAt: string;
  orderedAt?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  totalAmount: number;
  supplier: SupplierLike;
  warehouse?: { name?: string | null } | null;
  items: PurchaseItemLike[];
};

export type CompanyPrintSettings = {
  companyName: string;
  currency: string;
  logoUrl: string;
  address: string;
  email: string;
  website: string;
  patente: string;
  ice: string;
  rc: string;
  cnss: string;
  footer: string;
};

const defaults: CompanyPrintSettings = {
  companyName: "Galerie des Tanneurs",
  currency: "MAD",
  logoUrl: "",
  address: "Adresse a renseigner",
  email: "Email a renseigner",
  website: "Site web a renseigner",
  patente: "Patente a renseigner",
  ice: "ICE a renseigner",
  rc: "RC a renseigner",
  cnss: "CNSS a renseigner",
  footer: ""
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function valueOrFallback(value?: string | null, fallback = "-") {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function money(value: number | null | undefined) {
  return formatCurrency(Number(value ?? 0));
}

function buildPurchaseArticleLabel(product: ProductLike) {
  const parts = [
    product.name?.trim() || "",
    product.description?.trim() || "",
    product.dimensions?.trim() || ""
  ].filter(Boolean);

  return parts.join(" - ") || product.name || "-";
}

function documentLabel(status?: string) {
  if (status === "RECEIVED" || status === "INVOICED") return "BON DE RECEPTION";
  return "BON DE COMMANDE";
}

function renderCompanyLogo(company: CompanyPrintSettings) {
  if (company.logoUrl) {
    return `<img src="${escapeHtml(company.logoUrl)}" alt="Logo" class="logo-image" />`;
  }

  return `<div class="logo-fallback">GDT</div>`;
}

function renderDocument(item: PurchasePrintDocument, company: CompanyPrintSettings) {
  const orderedAt = item.orderedAt || item.createdAt;
  const subtotal = Number(item.subtotal ?? item.items.reduce((sum, line) => sum + Number(line.unitCostHt ?? 0) * Number(line.quantity ?? 0), 0));
  const totalAmount = Number(item.totalAmount ?? 0);
  const taxAmount = Number(item.taxAmount ?? (totalAmount - subtotal));

  const rows = item.items.map((line) => {
    const quantity = Number(line.quantity ?? 0);
    const unitHt = Number(line.unitCostHt ?? 0);

    return `
      <tr>
        <td>${escapeHtml(valueOrFallback(line.product.reference))}</td>
        <td colspan="3">${escapeHtml(buildPurchaseArticleLabel(line.product))}</td>
        <td class="num">${escapeHtml(String(quantity))}</td>
        <td class="num">${escapeHtml(money(unitHt))}</td>
      </tr>`;
  }).join("");

  return `
    <section class="print-page">
      <header class="top-grid">
        <div class="company-panel">
          <div class="brand-row">
            ${renderCompanyLogo(company)}
            <div>
              <div class="company-name">${escapeHtml(company.companyName)}</div>
              <div class="company-meta">${escapeHtml(company.address)}</div>
              <div class="company-meta">${escapeHtml(company.email)} | ${escapeHtml(company.website)}</div>
            </div>
          </div>
        </div>
        <div class="supplier-panel">
          <div class="panel-title">Fournisseur</div>
          <div class="supplier-name">${escapeHtml(item.supplier.name)}</div>
          <div class="supplier-meta">${escapeHtml(valueOrFallback(item.supplier.address, "Aucune adresse"))}</div>
          <div class="supplier-meta">${escapeHtml(valueOrFallback(item.supplier.city, "-"))}</div>
          <div class="supplier-meta">${escapeHtml(valueOrFallback(item.supplier.phone, "-"))}</div>
          <div class="supplier-meta">${escapeHtml(valueOrFallback(item.supplier.email, "-"))}</div>
        </div>
      </header>

      <div class="document-strip">
        <div>
          <div class="doc-eyebrow">${escapeHtml(documentLabel(item.status))}</div>
          <div class="doc-number">${escapeHtml(item.number)}</div>
        </div>
        <div class="doc-meta-block">
          <div><span>Numero :</span> ${escapeHtml(item.number)}</div>
          <div><span>Date :</span> ${escapeHtml(formatDate(orderedAt))}</div>
          <div><span>Depot :</span> ${escapeHtml(valueOrFallback(item.warehouse?.name, "-"))}</div>
        </div>
      </div>

      <table class="lines-table">
        <thead>
          <tr>
            <th>Reference</th>
            <th colspan="3">Article</th>
            <th>Qte</th>
            <th>Achat HT</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="totals-wrap">
        <div class="totals-card">
          <div class="total-row"><span>Montant HT</span><strong>${escapeHtml(money(subtotal))}</strong></div>
          <div class="total-row"><span>TVA</span><strong>${escapeHtml(money(taxAmount))}</strong></div>
          <div class="total-row grand"><span>Montant TTC</span><strong>${escapeHtml(money(totalAmount))}</strong></div>
        </div>
      </div>

      <footer class="footer-panel">
        <div>${escapeHtml(company.companyName)}</div>
        <div>Patente : ${escapeHtml(company.patente)} | ICE : ${escapeHtml(company.ice)} | RC : ${escapeHtml(company.rc)} | CNSS : ${escapeHtml(company.cnss)}</div>
        <div>${escapeHtml(company.address)} | ${escapeHtml(company.email)} | ${escapeHtml(company.website)}</div>
        ${company.footer ? `<div>${escapeHtml(company.footer)}</div>` : ""}
      </footer>
    </section>`;
}

export function normalizeCompanySettings(raw?: Record<string, string> | null): CompanyPrintSettings {
  return {
    companyName: raw?.company_name?.trim() || defaults.companyName,
    currency: raw?.company_currency?.trim() || defaults.currency,
    logoUrl: raw?.company_logo_url?.trim() || defaults.logoUrl,
    address: raw?.company_address?.trim() || defaults.address,
    email: raw?.company_email?.trim() || defaults.email,
    website: raw?.company_website?.trim() || defaults.website,
    patente: raw?.company_patente?.trim() || defaults.patente,
    ice: raw?.company_ice?.trim() || defaults.ice,
    rc: raw?.company_rc?.trim() || defaults.rc,
    cnss: raw?.company_cnss?.trim() || defaults.cnss,
    footer: raw?.ticket_footer?.trim() || defaults.footer
  };
}

export function buildPurchaseDocumentsHtml(items: PurchasePrintDocument[], company: CompanyPrintSettings) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(items.length > 1 ? "Impression achats" : items[0]?.number || "Bon d'achat")}</title>
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
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: auto; }
  .totals-card { width: 320px; border: 1px solid #d8c9ba; border-radius: 18px; overflow: hidden; }
  .total-row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; background: #faf6f1; border-bottom: 1px solid #e4d6c7; font-size: 13px; }
  .total-row.grand { background: linear-gradient(135deg, #231a15, #5b3b24); color: #fff; font-size: 15px; }
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
${items.map((item) => renderDocument(item, company)).join('<div class="page-break"></div>')}
</body>
</html>`;
}
