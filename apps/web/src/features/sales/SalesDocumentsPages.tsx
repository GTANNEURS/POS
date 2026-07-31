import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../../lib/api";
import { formatCurrency, formatDate, formatNumber } from "../../lib/format";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select } from "../../components/ui/primitives";

type ProductRow = {
  id: string;
  name: string;
  reference?: string | null;
  salePriceTtc?: number | null;
  taxRate?: number | null;
};

type CustomerRow = {
  id: string;
  fullName: string;
  phone?: string | null;
};

type WarehouseRow = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  managerName?: string;
};

type CompanySettings = {
  companyName: string;
  companyCurrency: string;
  defaultTaxRate: number;
  ticketFooter: string;
  companyLogoUrl: string;
  companyAddress: string;
  companyEmail: string;
  companyWebsite: string;
  companyPatente: string;
  companyIce: string;
  companyRc: string;
  companyCnss: string;
};

type SaleRow = {
  id: string;
  number: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  createdAt: string;
  sellerName?: string | null;
  note?: string | null;
  customer?: { id?: string; fullName: string } | null;
  warehouse: { id?: string; name: string };
  items: Array<{
    id: string;
    quantity: number;
    unitPriceTtc?: number;
    lineTotal: number;
    product: { id: string; name: string; reference?: string | null };
  }>;
};

type SalesBootstrap = {
  products: ProductRow[];
  customers: CustomerRow[];
  warehouses: WarehouseRow[];
  documents: SalesDocumentsStore;
  company: CompanySettings;
  vouchers: CreditVoucherRow[];
};

type CreditVoucherRow = {
  id: string;
  number: string;
  initialAmount: number;
  balanceAmount: number;
  customerName: string;
  customerPhone: string;
  warehouseId?: string | null;
  warehouseName: string;
  origin: string;
  sourceDocumentId?: string | null;
  sourceDocumentNumber?: string | null;
  createdByUserId?: string | null;
  isActive: boolean;
  createdAt: string;
};

type SalesLine = {
  id: string;
  productId: string;
  productName: string;
  reference: string;
  quantity: string;
  unitPriceTtc: string;
};

type QuoteStatus = "DRAFT" | "VALIDATED" | "TRANSFORMED" | "CANCELLED";
type DeliveryStatus = "DRAFT" | "INVOICED" | "CANCELLED";

type Quote = {
  id: string;
  number: string;
  status: QuoteStatus;
  createdAt: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  note: string;
  totalAmount: number;
  lines: SalesLine[];
};

type DeliveryNote = {
  id: string;
  number: string;
  status: DeliveryStatus;
  createdAt: string;
  validatedAt?: string | null;
  invoiceNumber?: string | null;
  sourceQuoteId?: string | null;
  sourceQuoteNumber?: string | null;
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  note: string;
  totalAmount: number;
  lines: SalesLine[];
};

type CustomerInvoice = {
  id: string;
  number: string;
  createdAt: string;
  sourceDeliveryId: string;
  sourceDeliveryNumber: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  amount: number;
  lines: SalesLine[];
};

type CustomerCreditNote = {
  id: string;
  number: string;
  createdAt: string;
  sourceType: "INVOICE" | "TICKET";
  sourceId: string;
  sourceNumber: string;
  customerName: string;
  customerPhone?: string;
  warehouseId?: string | null;
  warehouseName: string;
  origin?: "ADMIN" | "POS";
  createdByName?: string;
  voucherNumber?: string;
  voucherInitialAmount?: number;
  voucherBalanceAmount?: number;
  reason: string;
  amount: number;
  items: Array<{
    id: string;
    productId?: string | null;
    sourceSaleItemId?: string | null;
    productName: string;
    reference: string;
    quantity: number;
    unitPriceTtc: number;
    lineTotal: number;
  }>;
};

type SalesDocumentsStore = {
  quotes: Quote[];
  deliveries: DeliveryNote[];
  invoices: CustomerInvoice[];
  credits: CustomerCreditNote[];
};

type SalesDocumentForm = {
  number: string;
  customerId: string;
  warehouseId: string;
  status: QuoteStatus | DeliveryStatus;
  note: string;
  lines: SalesLine[];
};

type CreditForm = {
  number: string;
  sourceType: "INVOICE" | "TICKET";
  sourceId: string;
  lineId: string;
  quantity: string;
  reason: string;
};

type SelectableDocument = {
  id: string;
  number: string;
  customerName: string;
  createdAt: string;
  warehouseId?: string | null;
  warehouseName?: string;
  lines: Array<{
    id: string;
    productId?: string | null;
    productName: string;
    reference: string;
    quantity: number;
    unitPriceTtc: number;
    lineTotal: number;
  }>;
};

const emptyStore = (): SalesDocumentsStore => ({
  quotes: [],
  deliveries: [],
  invoices: [],
  credits: []
});

const defaultCompanySettings = (): CompanySettings => ({
  companyName: "Galerie des Tanneurs",
  companyCurrency: "MAD",
  defaultTaxRate: 20,
  ticketFooter: "",
  companyLogoUrl: "",
  companyAddress: "",
  companyEmail: "",
  companyWebsite: "",
  companyPatente: "",
  companyIce: "",
  companyRc: "",
  companyCnss: ""
});

const blankLine = (): SalesLine => ({
  id: `line-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  productId: "",
  productName: "",
  reference: "",
  quantity: "1",
  unitPriceTtc: "0"
});

const defaultSalesForm = (status: QuoteStatus | DeliveryStatus): SalesDocumentForm => ({
  number: "",
  customerId: "",
  warehouseId: "",
  status,
  note: "",
  lines: [blankLine()]
});

const defaultCreditForm = (): CreditForm => ({
  number: "",
  sourceType: "INVOICE",
  sourceId: "",
  lineId: "",
  quantity: "1",
  reason: ""
});

function nextNumber(prefix: string, numbers: string[]) {
  const year = new Date().getFullYear();
  const count = numbers.filter((value) => value.includes(`${prefix}-${year}`)).length + 1;
  return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
}

function computeTotal(lines: SalesLine[]) {
  return lines.reduce((sum, line) => sum + (Number(line.quantity || 0) || 0) * (Number(line.unitPriceTtc || 0) || 0), 0);
}

function formatPercent(value: number) {
  return `${formatNumber(value)}%`;
}

function cloneLines(lines: SalesLine[]) {
  return lines.map((line) => ({ ...line, id: `line-${Date.now()}-${Math.round(Math.random() * 1000)}` }));
}

function quoteTone(status: QuoteStatus) {
  if (status === "TRANSFORMED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

function deliveryTone(status: DeliveryStatus) {
  if (status === "INVOICED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

type PrintLine = {
  reference: string;
  productName: string;
  quantity: number;
  unitPriceHt: number;
  taxRate: number;
  unitPriceTtc: number;
  lineTotalTtc: number;
};

type PrintDocument = {
  title: string;
  eyebrow: string;
  number: string;
  createdAt: string;
  customerName: string;
  warehouseName: string;
  warehouseAddress?: string;
  note?: string;
  lines: PrintLine[];
  dueDate?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  stampLabel?: string;
  documentCode?: string;
  copyLabel?: string;
  kind?: "QUOTE" | "DELIVERY" | "INVOICE" | "CREDIT";
  sellerName?: string;
};

function buildDocumentsHtml(company: CompanySettings, document: PrintDocument) {
  const escapeHtml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const totals = document.lines.reduce((acc, line) => {
    acc.totalHt += line.unitPriceHt * line.quantity;
    acc.taxAmount += (line.unitPriceTtc - line.unitPriceHt) * line.quantity;
    acc.totalTtc += line.lineTotalTtc;
    return acc;
  }, { totalHt: 0, taxAmount: 0, totalTtc: 0 });

  const rowsHtml = document.lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.reference || "-")}</td>
      <td>${escapeHtml(line.productName)}</td>
      <td class="text-center">${escapeHtml(formatNumber(line.quantity))}</td>
      <td class="text-right">${escapeHtml(formatCurrency(line.unitPriceHt))}</td>
      <td class="text-center">${escapeHtml(formatPercent(line.taxRate))}</td>
      <td class="text-right">${escapeHtml(formatCurrency(line.unitPriceTtc))}</td>
      <td class="text-right">${escapeHtml(formatCurrency(line.lineTotalTtc))}</td>
    </tr>
  `).join("");

  const footerMeta = [
    company.companyPatente ? `Patente: ${company.companyPatente}` : "",
    company.companyIce ? `ICE: ${company.companyIce}` : "",
    company.companyRc ? `RC: ${company.companyRc}` : "",
    company.companyCnss ? `CNSS: ${company.companyCnss}` : ""
  ].filter(Boolean).join(" | ");
  const conditionsText = company.ticketFooter || "50% a la commande et 50% a la livraison";
  const copyLabel = document.copyLabel || "Original";
  const stampLabel = document.stampLabel || document.title.toUpperCase();
  const documentCode = document.documentCode || document.number;
  const footerContact = [company.companyAddress, company.companyEmail, company.companyWebsite].filter(Boolean).join(" | ");

  if (document.kind === "QUOTE") {
    const validityDate = new Date(document.createdAt);
    validityDate.setDate(validityDate.getDate() + 15);
    const validityLabel = formatDate(validityDate.toISOString());
    const paymentTerms = document.paymentMethod || "Reglement selon accord client";
    const quoteRowsHtml = document.lines.map((line, index) => `
      <tr>
        <td class="text-center">${index + 1}</td>
        <td>${escapeHtml(line.reference || "-")}</td>
        <td>${escapeHtml(line.productName)}</td>
        <td class="text-center">${escapeHtml(formatNumber(line.quantity))}</td>
        <td class="text-right">${escapeHtml(formatCurrency(line.unitPriceHt))}</td>
        <td class="text-center">${escapeHtml(formatPercent(line.taxRate))}</td>
        <td class="text-right">${escapeHtml(formatCurrency(line.lineTotalTtc))}</td>
      </tr>
    `).join("");

    return `<!doctype html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(document.title)} - ${escapeHtml(document.number)}</title>
        <style>
          @page { size: A4 portrait; margin: 14mm 14mm 16mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; color: #23170f; font-size: 12px; background: #fff; }
          .sheet { width: 100%; min-height: 258mm; display: flex; flex-direction: column; }
          .header { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr); gap: 18px; align-items: stretch; }
          .brand-card, .doc-card, .block, .totals-card, .conditions, .note, .signature-box { border: 1px solid #e7d6c6; border-radius: 18px; background: #fff; }
          .brand-card { padding: 15px 16px; }
          .brand-top { display: flex; gap: 16px; align-items: flex-start; }
          .logo { width: 78px; height: 78px; object-fit: contain; border-radius: 16px; border: 1px solid #e7d6c6; padding: 8px; background: #fffaf5; }
          h1 { margin: 0 0 8px; font-size: 19px; line-height: 1.25; }
          .meta { color: #6f5948; line-height: 1.55; }
          .doc-card { display: flex; flex-direction: column; justify-content: space-between; padding: 18px; }
          .copy-pill { align-self: flex-end; display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid #dcc7b3; background: #fbf5ef; color: #7d5c43; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
          .doc-meta-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
          .doc-meta-item { min-width: 0; border: 1px solid #eadbce; border-radius: 12px; padding: 8px 11px; background: #fffaf5; }
          .doc-meta-label { display: block; margin-bottom: 3px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: #8a725e; }
          .doc-meta-value { font-size: 11px; font-weight: 700; color: #241911; line-height: 1.35; }
          .info-grid { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 18px; align-items: start; }
          .block { padding: 16px 18px; }
          .block-title { margin: 0 0 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.22em; color: #a35f22; }
          .block-strong { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
          .doc-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
          .doc-info-item { min-width: 0; }
          .doc-info-label { display: block; margin-bottom: 3px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: #8a725e; }
          .doc-info-value { font-size: 12px; font-weight: 700; color: #241911; }
          .doc-line { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; }
          .doc-line-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #8a725e; }
          .doc-line-value { font-size: 13px; font-weight: 700; color: #241911; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border-bottom: 1px solid #eadbce; padding: 10px 8px; vertical-align: top; }
          thead th { background: #fbf5ef; color: #7d5c43; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
          tbody td { color: #2a1e16; }
          .col-index { width: 34px; }
          .col-ref { width: 120px; }
          .col-qty { width: 64px; }
          .col-price { width: 110px; }
          .col-tax { width: 72px; }
          .col-total { width: 122px; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .summary-row { display: grid; grid-template-columns: minmax(0, 1fr) 248px; gap: 14px; margin-top: 18px; align-items: start; }
          .note { padding: 14px 16px; }
          .note strong { display: block; margin-bottom: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #7d5c43; }
          .muted { color: #6f5948; line-height: 1.6; }
          .totals-card { padding: 12px 14px; background: #fffaf5; border-radius: 16px; }
          .totals-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 11px; }
          .totals-row.total { margin-top: 5px; padding-top: 9px; border-top: 1px solid #e6d2bf; font-size: 14px; font-weight: 700; }
          .conditions { margin-top: 18px; padding: 14px 16px; background: #fbf5ef; }
          .conditions-title { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #7d5c43; }
          .bottom-stack { margin-top: auto; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
          .signature-box { min-height: 118px; padding: 14px 16px; }
          .signature-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #7d5c43; margin-bottom: 8px; }
          .signature-line { margin-top: 54px; padding-top: 8px; border-top: 1px solid #d8c5b2; font-size: 11px; color: #7d5c43; }
          .footer { margin-top: 22px; padding-top: 14px; border-top: 1px solid #eadbce; color: #6f5948; font-size: 10.5px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="header">
            <div class="brand-card">
              <div class="brand-top">
                ${company.companyLogoUrl ? `<img class="logo" src="${escapeHtml(company.companyLogoUrl)}" alt="Logo" />` : ""}
                <div>
                  <h1>${escapeHtml(company.companyName)}</h1>
                  <div class="meta">${escapeHtml(company.companyAddress || "")}</div>
                  ${company.companyEmail ? `<div class="meta">${escapeHtml(company.companyEmail)}</div>` : ""}
                  ${company.companyWebsite ? `<div class="meta">${escapeHtml(company.companyWebsite)}</div>` : ""}
                  ${company.companyIce || company.companyRc ? `<div class="meta">${escapeHtml([company.companyIce ? `ICE: ${company.companyIce}` : "", company.companyRc ? `RC: ${company.companyRc}` : ""].filter(Boolean).join(" | "))}</div>` : ""}
                </div>
              </div>
            </div>
            <div class="doc-card">
              <div class="copy-pill">${escapeHtml(copyLabel)}</div>
              <div class="block-title">Informations devis</div>
              <div class="doc-line"><span class="doc-line-label">Numero :</span><span class="doc-line-value">${escapeHtml(document.number)}</span></div>
              <div class="doc-line"><span class="doc-line-label">Boutique :</span><span class="doc-line-value">${escapeHtml(document.warehouseName)}</span></div>
            </div>
          </div>

          <div class="info-grid">
            <div class="block">
              <div class="block-title">Client</div>
              <div class="block-strong">${escapeHtml(document.customerName)}</div>
              <div class="meta">Informations client disponibles sur ce devis.</div>
            </div>
          </div>

          <div class="doc-meta-strip">
            <div class="doc-meta-item">
              <span class="doc-meta-label">Date du devis</span>
              <span class="doc-meta-value">${escapeHtml(formatDate(document.createdAt))}</span>
            </div>
            <div class="doc-meta-item">
              <span class="doc-meta-label">Validite</span>
              <span class="doc-meta-value">${escapeHtml(validityLabel)}</span>
            </div>
            <div class="doc-meta-item">
              <span class="doc-meta-label">Reglement</span>
              <span class="doc-meta-value">${escapeHtml(paymentTerms)}</span>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th class="col-index text-center">#</th>
                <th class="col-ref">Reference</th>
                <th>Article</th>
                <th class="col-qty text-center">Qte</th>
                <th class="col-price text-right">PU HT</th>
                <th class="col-tax text-center">TVA</th>
                <th class="col-total text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody>${quoteRowsHtml}</tbody>
          </table>

          <div class="summary-row">
            ${document.note ? `<div class="note"><strong>Note</strong><div class="muted">${escapeHtml(document.note)}</div></div>` : `<div></div>`}
            <div class="totals-card">
              <div class="totals-row"><span>Total HT</span><strong>${escapeHtml(formatCurrency(totals.totalHt))}</strong></div>
              <div class="totals-row"><span>TVA</span><strong>${escapeHtml(formatCurrency(totals.taxAmount))}</strong></div>
              <div class="totals-row total"><span>Total TTC</span><strong>${escapeHtml(formatCurrency(totals.totalTtc))}</strong></div>
            </div>
          </div>

          <div class="bottom-stack">
            <div class="conditions">
              <div class="conditions-title">Conditions</div>
              <div class="muted">${escapeHtml(conditionsText)}</div>
            </div>

            <div class="signatures">
              <div class="signature-box">
                <div class="signature-title">Signature et cachet boutique</div>
                <div class="muted">${escapeHtml(document.warehouseName)}</div>
                <div class="signature-line">Nom / Signature</div>
              </div>
              <div class="signature-box">
                <div class="signature-title">Accord client</div>
                <div class="muted">${escapeHtml(document.customerName)}</div>
                <div class="signature-line">Bon pour accord</div>
              </div>
            </div>

            <div class="footer">
              <div>${escapeHtml(company.companyName)}</div>
              <div>${escapeHtml(footerMeta)}</div>
              <div>${escapeHtml(footerContact)}</div>
            </div>
          </div>
        </div>
      </body>
    </html>`;
  }

  if (document.kind === "DELIVERY") {
    const deliveryRowsHtml = document.lines.map((line, index) => `
      <tr>
        <td class="text-center">${index + 1}</td>
        <td>${escapeHtml(line.reference || "-")}</td>
        <td>${escapeHtml(line.productName)}</td>
        <td class="text-center">${escapeHtml(formatNumber(line.quantity))}</td>
        <td class="text-right">${escapeHtml(formatCurrency(line.unitPriceHt))}</td>
        <td class="text-center">${escapeHtml(formatPercent(line.taxRate))}</td>
        <td class="text-right">${escapeHtml(formatCurrency(line.lineTotalTtc))}</td>
      </tr>
    `).join("");

    const deliveryConditions = company.ticketFooter || "Marchandise recue conforme sous reserve de verification detaillee a la livraison.";

    return `<!doctype html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(document.title)} - ${escapeHtml(document.number)}</title>
        <style>
          @page { size: A4 portrait; margin: 14mm 14mm 16mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; color: #23170f; font-size: 12px; background: #fff; }
          .sheet { width: 100%; min-height: 258mm; display: flex; flex-direction: column; }
          .header { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr); gap: 18px; align-items: stretch; }
          .brand-card, .doc-card, .info-card, .note, .totals-card, .conditions, .signature-box { border: 1px solid #e7d6c6; border-radius: 18px; background: #fff; }
          .brand-card { padding: 15px 16px; }
          .brand-top { display: flex; gap: 16px; align-items: flex-start; }
          .logo { width: 78px; height: 78px; object-fit: contain; border-radius: 16px; border: 1px solid #e7d6c6; padding: 8px; background: #fffaf5; }
          h1 { margin: 0 0 8px; font-size: 19px; line-height: 1.25; }
          .meta { color: #6f5948; line-height: 1.55; }
          .copy-pill { align-self: flex-end; display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid #dcc7b3; background: #fbf5ef; color: #7d5c43; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
          .doc-card { padding: 18px; display: flex; flex-direction: column; justify-content: space-between; }
          .doc-title { margin: 14px 0 12px; font-size: 28px; font-weight: 800; line-height: 1.02; }
          .doc-line { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; }
          .doc-line-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #8a725e; }
          .doc-line-value { font-size: 13px; font-weight: 700; color: #241911; }
          .doc-badge { margin-top: 16px; display: inline-flex; align-items: center; padding: 8px 12px; border-radius: 999px; background: #fff4e6; color: #a35f22; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; }
          .info-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 18px; }
          .info-card { padding: 14px 16px; }
          .info-title { margin: 0 0 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #a35f22; }
          .info-strong { font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #241911; }
          .info-muted { color: #6f5948; line-height: 1.55; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border-bottom: 1px solid #eadbce; padding: 10px 8px; vertical-align: top; }
          thead th { background: #fbf5ef; color: #7d5c43; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
          tbody td { color: #2a1e16; }
          .col-index { width: 34px; }
          .col-ref { width: 120px; }
          .col-qty { width: 64px; }
          .col-price { width: 110px; }
          .col-tax { width: 72px; }
          .col-total { width: 122px; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .summary-row { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 14px; margin-top: 18px; align-items: start; }
          .note { padding: 14px 16px; }
          .note strong { display: block; margin-bottom: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #7d5c43; }
          .muted { color: #6f5948; line-height: 1.6; }
          .totals-card { padding: 12px 14px; background: #fffaf5; border-radius: 16px; }
          .totals-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 11px; }
          .totals-row.total { margin-top: 5px; padding-top: 9px; border-top: 1px solid #e6d2bf; font-size: 14px; font-weight: 700; }
          .bottom-stack { margin-top: auto; }
          .conditions { margin-top: 18px; padding: 14px 16px; background: #fbf5ef; }
          .conditions-title { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #7d5c43; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
          .signature-box { min-height: 118px; padding: 14px 16px; }
          .signature-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #7d5c43; margin-bottom: 8px; }
          .signature-line { margin-top: 54px; padding-top: 8px; border-top: 1px solid #d8c5b2; font-size: 11px; color: #7d5c43; }
          .footer { margin-top: 22px; padding-top: 14px; border-top: 1px solid #eadbce; color: #6f5948; font-size: 10.5px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="header">
            <div class="brand-card">
              <div class="brand-top">
                ${company.companyLogoUrl ? `<img class="logo" src="${escapeHtml(company.companyLogoUrl)}" alt="Logo" />` : ""}
                <div>
                  <h1>${escapeHtml(company.companyName)}</h1>
                  <div class="meta">${escapeHtml(company.companyAddress || "")}</div>
                  ${company.companyEmail ? `<div class="meta">${escapeHtml(company.companyEmail)}</div>` : ""}
                  ${company.companyWebsite ? `<div class="meta">${escapeHtml(company.companyWebsite)}</div>` : ""}
                  ${company.companyIce || company.companyRc ? `<div class="meta">${escapeHtml([company.companyIce ? `ICE: ${company.companyIce}` : "", company.companyRc ? `RC: ${company.companyRc}` : ""].filter(Boolean).join(" | "))}</div>` : ""}
                </div>
              </div>
            </div>

            <div class="doc-card">
              <div class="copy-pill">${escapeHtml(copyLabel)}</div>
              <div>
                <div class="doc-title">Bon de livraison</div>
                <div class="doc-line"><span class="doc-line-label">Numero :</span><span class="doc-line-value">${escapeHtml(document.number)}</span></div>
                <div class="doc-line"><span class="doc-line-label">Boutique :</span><span class="doc-line-value">${escapeHtml(document.warehouseName)}</span></div>
                <div class="doc-line"><span class="doc-line-label">Date :</span><span class="doc-line-value">${escapeHtml(formatDate(document.createdAt))}</span></div>
              </div>
              <div class="doc-badge">${escapeHtml(stampLabel)} · ${escapeHtml(documentCode)}</div>
            </div>
          </div>

          <div class="info-grid">
            <div class="info-card">
              <div class="info-title">Client</div>
              <div class="info-strong">${escapeHtml(document.customerName)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th class="col-index text-center">#</th>
                <th class="col-ref">Reference</th>
                <th>Article</th>
                <th class="col-qty text-center">Qte</th>
                <th class="col-price text-right">PU HT</th>
                <th class="col-tax text-center">TVA</th>
                <th class="col-total text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody>${deliveryRowsHtml}</tbody>
          </table>

          <div class="summary-row">
            ${document.note ? `<div class="note"><strong>Details</strong><div class="muted">${escapeHtml(document.note)}</div></div>` : `<div></div>`}
            <div class="totals-card">
              <div class="totals-row"><span>Total HT</span><strong>${escapeHtml(formatCurrency(totals.totalHt))}</strong></div>
              <div class="totals-row"><span>TVA</span><strong>${escapeHtml(formatCurrency(totals.taxAmount))}</strong></div>
              <div class="totals-row total"><span>Total TTC</span><strong>${escapeHtml(formatCurrency(totals.totalTtc))}</strong></div>
            </div>
          </div>

          <div class="bottom-stack">
            <div class="conditions">
              <div class="conditions-title">Conditions de livraison</div>
              <div class="muted">${escapeHtml(deliveryConditions)}</div>
            </div>

            <div class="signatures">
              <div class="signature-box">
                <div class="signature-title">Signature et cachet boutique</div>
                <div class="muted">${escapeHtml(document.warehouseName)}</div>
                <div class="signature-line">Nom / Signature</div>
              </div>
              <div class="signature-box">
                <div class="signature-title">Reception client</div>
                <div class="muted">${escapeHtml(document.customerName)}</div>
                <div class="signature-line">Nom / Signature</div>
              </div>
            </div>

            <div class="footer">
              <div>${escapeHtml(company.companyName)}</div>
              <div>${escapeHtml(footerMeta)}</div>
              <div>${escapeHtml(footerContact)}</div>
            </div>
          </div>
        </div>
      </body>
    </html>`;
  }

  if (document.kind === "CREDIT") {
    const creditRowsHtml = document.lines.map((line, index) => `
      <tr>
        <td class="text-center">${index + 1}</td>
        <td>${escapeHtml(line.reference || "-")}</td>
        <td>${escapeHtml(line.productName)}</td>
        <td class="text-center">${escapeHtml(formatNumber(line.quantity))}</td>
        <td class="text-right">${escapeHtml(formatCurrency(line.unitPriceHt))}</td>
        <td class="text-center">${escapeHtml(formatPercent(line.taxRate))}</td>
        <td class="text-right">${escapeHtml(formatCurrency(line.lineTotalTtc))}</td>
      </tr>
    `).join("");

    return `<!doctype html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(document.title)} - ${escapeHtml(document.number)}</title>
        <style>
          @page { size: A4 portrait; margin: 14mm 14mm 16mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; color: #23170f; font-size: 12px; background: #fff; }
          .sheet { width: 100%; min-height: 258mm; display: flex; flex-direction: column; }
          .header { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr); gap: 18px; align-items: stretch; }
          .brand-card, .doc-card, .info-card, .note, .totals-card, .conditions, .signature-box { border: 1px solid #e7d6c6; border-radius: 18px; background: #fff; }
          .brand-card { padding: 15px 16px; }
          .brand-top { display: flex; gap: 16px; align-items: flex-start; }
          .logo { width: 78px; height: 78px; object-fit: contain; border-radius: 16px; border: 1px solid #e7d6c6; padding: 8px; background: #fffaf5; }
          h1 { margin: 0 0 8px; font-size: 19px; line-height: 1.25; }
          .meta { color: #6f5948; line-height: 1.55; }
          .copy-pill { align-self: flex-end; display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid #dcc7b3; background: #fbf5ef; color: #7d5c43; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
          .doc-card { padding: 18px; display: flex; flex-direction: column; justify-content: space-between; }
          .doc-title { margin: 14px 0 12px; font-size: 28px; font-weight: 800; line-height: 1.02; }
          .doc-line { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; }
          .doc-line-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #8a725e; }
          .doc-line-value { font-size: 13px; font-weight: 700; color: #241911; }
          .doc-badge { margin-top: 16px; display: inline-flex; align-items: center; padding: 8px 12px; border-radius: 999px; background: #fff4e6; color: #a35f22; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
          .info-card { padding: 14px 16px; }
          .info-title { margin: 0 0 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #a35f22; }
          .info-strong { font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #241911; }
          .info-muted { color: #6f5948; line-height: 1.55; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border-bottom: 1px solid #eadbce; padding: 10px 8px; vertical-align: top; }
          thead th { background: #fbf5ef; color: #7d5c43; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
          tbody td { color: #2a1e16; }
          .col-index { width: 34px; }
          .col-ref { width: 120px; }
          .col-qty { width: 64px; }
          .col-price { width: 110px; }
          .col-tax { width: 72px; }
          .col-total { width: 122px; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .summary-row { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 14px; margin-top: 18px; align-items: start; }
          .note { padding: 14px 16px; }
          .note strong { display: block; margin-bottom: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #7d5c43; }
          .muted { color: #6f5948; line-height: 1.6; }
          .totals-card { padding: 12px 14px; background: #fffaf5; border-radius: 16px; }
          .totals-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 11px; }
          .totals-row.total { margin-top: 5px; padding-top: 9px; border-top: 1px solid #e6d2bf; font-size: 14px; font-weight: 700; }
          .bottom-stack { margin-top: auto; }
          .conditions { margin-top: 18px; padding: 14px 16px; background: #fbf5ef; }
          .conditions-title { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #7d5c43; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
          .signature-box { min-height: 118px; padding: 14px 16px; }
          .signature-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #7d5c43; margin-bottom: 8px; }
          .signature-line { margin-top: 54px; padding-top: 8px; border-top: 1px solid #d8c5b2; font-size: 11px; color: #7d5c43; }
          .footer { margin-top: 22px; padding-top: 14px; border-top: 1px solid #eadbce; color: #6f5948; font-size: 10.5px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="header">
            <div class="brand-card">
              <div class="brand-top">
                ${company.companyLogoUrl ? `<img class="logo" src="${escapeHtml(company.companyLogoUrl)}" alt="Logo" />` : ""}
                <div>
                  <h1>${escapeHtml(company.companyName)}</h1>
                  <div class="meta">${escapeHtml(company.companyAddress || "")}</div>
                  ${company.companyEmail ? `<div class="meta">${escapeHtml(company.companyEmail)}</div>` : ""}
                  ${company.companyWebsite ? `<div class="meta">${escapeHtml(company.companyWebsite)}</div>` : ""}
                  ${company.companyIce || company.companyRc ? `<div class="meta">${escapeHtml([company.companyIce ? `ICE: ${company.companyIce}` : "", company.companyRc ? `RC: ${company.companyRc}` : ""].filter(Boolean).join(" | "))}</div>` : ""}
                </div>
              </div>
            </div>

            <div class="doc-card">
              <div class="copy-pill">${escapeHtml(copyLabel)}</div>
              <div>
                <div class="doc-title">Bon d'avoir</div>
                <div class="doc-line"><span class="doc-line-label">Numero :</span><span class="doc-line-value">${escapeHtml(document.number)}</span></div>
                <div class="doc-line"><span class="doc-line-label">Source :</span><span class="doc-line-value">${escapeHtml(document.documentCode || document.number)}</span></div>
                <div class="doc-line"><span class="doc-line-label">Date :</span><span class="doc-line-value">${escapeHtml(formatDate(document.createdAt))}</span></div>
                <div class="doc-line"><span class="doc-line-label">Vendeur :</span><span class="doc-line-value">${escapeHtml(document.sellerName || "Non renseigne")}</span></div>
              </div>
              <div class="doc-badge">${escapeHtml(stampLabel)} · ${escapeHtml(document.number)}</div>
            </div>
          </div>

          <div class="info-grid">
            <div class="info-card">
              <div class="info-title">Client</div>
              <div class="info-strong">${escapeHtml(document.customerName)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th class="col-index text-center">#</th>
                <th class="col-ref">Reference</th>
                <th>Article</th>
                <th class="col-qty text-center">Qte</th>
                <th class="col-price text-right">PU HT</th>
                <th class="col-tax text-center">TVA</th>
                <th class="col-total text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody>${creditRowsHtml}</tbody>
          </table>

          <div class="summary-row">
            ${document.note ? `<div class="note"><strong>Motif</strong><div class="muted">${escapeHtml(document.note)}</div></div>` : `<div></div>`}
            <div class="totals-card">
              <div class="totals-row"><span>Total HT</span><strong>${escapeHtml(formatCurrency(totals.totalHt))}</strong></div>
              <div class="totals-row"><span>TVA</span><strong>${escapeHtml(formatCurrency(totals.taxAmount))}</strong></div>
              <div class="totals-row total"><span>Total TTC</span><strong>${escapeHtml(formatCurrency(totals.totalTtc))}</strong></div>
            </div>
          </div>

          <div class="bottom-stack">
            <div class="conditions">
              <div class="conditions-title">Conditions</div>
              <div class="muted">Presence du client lui meme - Validite du bon d'avoir un an a partir de la date de creation du bon.</div>
            </div>

            <div class="signatures">
              <div class="signature-box">
                <div class="signature-title">Signature et cachet boutique</div>
                <div class="muted">${escapeHtml(document.warehouseName || "-")}</div>
                <div class="signature-line">Nom / Signature</div>
              </div>
              <div class="signature-box">
                <div class="signature-title">Accord client</div>
                <div class="muted">${escapeHtml(document.customerName)}</div>
                <div class="signature-line">Bon pour accord</div>
              </div>
            </div>

            <div class="footer">
              <div>${escapeHtml(company.companyName)}</div>
              <div>${escapeHtml(footerMeta)}</div>
              <div>${escapeHtml(footerContact)}</div>
            </div>
          </div>
        </div>
      </body>
    </html>`;
  }

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(document.title)} - ${escapeHtml(document.number)}</title>
      <style>
        @page { size: A4 portrait; margin: 18mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #221810; margin: 0; font-size: 13px; }
        .sheet { width: 100%; }
        .header { display:flex; justify-content:space-between; gap:28px; align-items:flex-start; }
        .company, .customer { width:48%; }
        .company-top { display:flex; gap:18px; align-items:flex-start; }
        .logo { width:84px; height:84px; object-fit:contain; border:1px solid #e5d6c7; border-radius:18px; padding:8px; }
        .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:0.22em; color:#9a5b1f; margin-bottom:8px; }
        h1 { margin:0; font-size:28px; }
        h2 { margin:0 0 10px; font-size:18px; }
        .meta, .muted { color:#6a5443; line-height:1.6; }
        .copy-pill { display:inline-flex; align-items:center; justify-content:center; min-height:36px; border:1px solid #d6c1ad; border-radius:999px; padding:0 16px; font-size:11px; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#7b5c43; background:#fbf6f1; }
        .header-right { display:flex; flex-direction:column; gap:14px; }
        .top-meta { display:grid; grid-template-columns: 1fr 150px; gap:14px; }
        .stamp-box { position:relative; border:1px dashed #d59d6c; border-radius:18px; min-height:118px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fffaf5; }
        .stamp-box::before { content:""; position:absolute; inset:10px; border:1px dashed #edc8a5; border-radius:14px; }
        .stamp-label { position:relative; transform:rotate(-12deg); font-size:22px; font-weight:800; letter-spacing:0.16em; color:#b76b21; opacity:0.72; text-transform:uppercase; text-align:center; }
        .qr-card { display:grid; grid-template-columns:72px 1fr; gap:12px; align-items:center; }
        .qr-box { width:72px; height:72px; border:1px solid #d7c2ae; border-radius:12px; background:
          linear-gradient(90deg,#2f241b 8px,transparent 8px) 0 0/24px 24px,
          linear-gradient(#2f241b 8px,transparent 8px) 0 0/24px 24px,
          linear-gradient(90deg,transparent 16px,#2f241b 16px,#2f241b 24px) 0 0/24px 24px,
          linear-gradient(transparent 16px,#2f241b 16px,#2f241b 24px) 0 0/24px 24px,
          #fff; }
        .qr-title { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#7b5c43; }
        .qr-value { font-size:12px; font-weight:700; color:#241a12; line-height:1.5; word-break:break-word; }
        .doc-grid { display:grid; grid-template-columns: 1fr 1fr; gap:18px; margin-top:22px; }
        .card { border:1px solid #ead8c7; border-radius:18px; padding:16px; background:#fff; }
        .doc-number { font-size:15px; font-weight:700; }
        table { width:100%; border-collapse:collapse; margin-top:24px; }
        th, td { border-bottom:1px solid #ead8c7; padding:10px 8px; vertical-align:top; }
        th { text-align:left; text-transform:uppercase; letter-spacing:0.08em; font-size:11px; color:#7b5c43; background:#fbf6f1; }
        .text-right { text-align:right; }
        .text-center { text-align:center; }
        .totals { width:340px; margin-left:auto; margin-top:20px; border:1px solid #ead8c7; border-radius:18px; padding:18px; }
        .totals-row { display:flex; justify-content:space-between; gap:16px; padding:6px 0; }
        .totals-row.total { margin-top:6px; padding-top:12px; border-top:1px solid #ead8c7; font-size:17px; font-weight:700; }
        .note { margin-top:18px; border:1px solid #ead8c7; border-radius:18px; padding:14px 16px; }
        .conditions { margin-top:18px; border:1px solid #ead8c7; border-radius:18px; padding:14px 16px; background:#fbf6f1; }
        .conditions-title { margin:0 0 8px; font-size:12px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#7b5c43; }
        .signatures { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:20px; }
        .signature-box { min-height:110px; border:1px solid #ead8c7; border-radius:18px; padding:14px 16px; }
        .signature-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.12em; color:#7b5c43; margin-bottom:8px; }
        .signature-line { margin-top:52px; border-top:1px solid #d8c5b2; padding-top:8px; font-size:11px; color:#7b5c43; }
        .footer { margin-top:28px; padding-top:16px; border-top:1px solid #ead8c7; color:#6a5443; font-size:11px; line-height:1.6; }
      </style>
    </head>
    <body>
      <div class="sheet">
        <div class="header">
          <div class="company">
            <div class="company-top">
              ${company.companyLogoUrl ? `<img class="logo" src="${escapeHtml(company.companyLogoUrl)}" alt="Logo" />` : ""}
              <div>
                <div class="eyebrow">${escapeHtml(document.eyebrow)}</div>
                <h1>${escapeHtml(document.title)}</h1>
                <div class="meta">${escapeHtml(company.companyName)}</div>
                <div class="meta">${escapeHtml(company.companyAddress || "")}</div>
                <div class="meta">${escapeHtml([company.companyEmail, company.companyWebsite].filter(Boolean).join(" | "))}</div>
              </div>
            </div>
          </div>
          <div class="header-right customer">
            <div style="display:flex; justify-content:flex-end;">
              <div class="copy-pill">${escapeHtml(copyLabel)}</div>
            </div>
            <div class="top-meta">
              <div class="card qr-card">
                <div class="qr-box" aria-hidden="true"></div>
                <div>
                  <div class="qr-title">Code facture</div>
                  <div class="qr-value">${escapeHtml(documentCode)}</div>
                </div>
              </div>
              <div class="stamp-box">
                <div class="stamp-label">${escapeHtml(stampLabel)}</div>
              </div>
            </div>
            <div class="customer card">
            <h2>Client</h2>
            <div class="doc-number">${escapeHtml(document.customerName)}</div>
            <div class="meta">Document: ${escapeHtml(document.number)}</div>
            <div class="meta">Date: ${escapeHtml(formatDate(document.createdAt))}</div>
            </div>
          </div>
        </div>

        <div class="doc-grid">
          <div class="card">
            <h2>Informations document</h2>
            <div class="meta">Numero: ${escapeHtml(document.number)}</div>
            <div class="meta">Date: ${escapeHtml(formatDate(document.createdAt))}</div>
            <div class="meta">TVA: ${escapeHtml(formatPercent(company.defaultTaxRate))}</div>
            ${document.dueDate ? `<div class="meta">Echeance: ${escapeHtml(formatDate(document.dueDate))}</div>` : ""}
            ${document.paymentMethod ? `<div class="meta">Mode de reglement: ${escapeHtml(document.paymentMethod)}</div>` : ""}
            ${document.paymentStatus ? `<div class="meta">Statut reglement: ${escapeHtml(document.paymentStatus)}</div>` : ""}
          </div>
          <div class="card">
            <h2>Boutique emettrice</h2>
            <div class="doc-number">${escapeHtml(document.warehouseName)}</div>
            <div class="meta">${escapeHtml(document.warehouseAddress || "")}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Article</th>
              <th class="text-center">Qte</th>
              <th class="text-right">PU HT</th>
              <th class="text-center">TVA</th>
              <th class="text-right">PU TTC</th>
              <th class="text-right">Total TTC</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <div class="totals">
          <div class="totals-row"><span>Total HT</span><strong>${escapeHtml(formatCurrency(totals.totalHt))}</strong></div>
          <div class="totals-row"><span>TVA</span><strong>${escapeHtml(formatCurrency(totals.taxAmount))}</strong></div>
          <div class="totals-row total"><span>Total TTC</span><strong>${escapeHtml(formatCurrency(totals.totalTtc))}</strong></div>
        </div>

        ${document.note ? `<div class="note"><strong>Note</strong><div class="muted">${escapeHtml(document.note)}</div></div>` : ""}
        <div class="conditions">
          <div class="conditions-title">Conditions</div>
          <div class="muted">${escapeHtml(conditionsText)}</div>
        </div>

        <div class="signatures">
          <div class="signature-box">
            <div class="signature-title">Signature et cachet boutique</div>
            <div class="muted">${escapeHtml(document.warehouseName)}</div>
            <div class="signature-line">Nom / Signature</div>
          </div>
          <div class="signature-box">
            <div class="signature-title">Signature client</div>
            <div class="muted">${escapeHtml(document.customerName)}</div>
            <div class="signature-line">Bon pour accord</div>
          </div>
        </div>

        <div class="footer">
          <div>${escapeHtml(company.companyName)}</div>
          <div>${escapeHtml(footerMeta)}</div>
          <div>${escapeHtml(footerContact)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

function buildDocumentsBundleHtml(company: CompanySettings, documents: PrintDocument[]) {
  if (documents.length === 1) return buildDocumentsHtml(company, documents[0]);
  const firstHtml = buildDocumentsHtml(company, documents[0]);
  const styleMatch = firstHtml.match(/<style>([\s\S]*)<\/style>/i);
  const pages = documents.map((document) => {
    const html = buildDocumentsHtml(company, document);
    const match = html.match(/<body>([\s\S]*)<\/body>/i);
    return `<section class="bundle-page">${match?.[1] ?? ""}</section>`;
  }).join("");

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <title>Documents ventes</title>
      <style>
        ${styleMatch?.[1] ?? ""}
        @page { size: A4 portrait; margin: 0; }
        body { margin: 0; background: #fff; }
        .bundle-page { page-break-after: always; }
        .bundle-page:last-child { page-break-after: auto; }
      </style>
    </head>
    <body>${pages}</body>
  </html>`;
}

function previewHtml(html: string, shouldPrint = false) {
  const popup = window.open("", "_blank", "width=1180,height=860");
  if (!popup) return;
  popup.document.write(html);
  popup.document.close();
  if (shouldPrint) {
    popup.focus();
    popup.print();
  }
}

function buildPrintLines(lines: SalesLine[], products: ProductRow[], defaultTaxRate: number): PrintLine[] {
  return lines.map((line) => {
    const product = products.find((entry) => entry.id === line.productId);
    const taxRate = Number(product?.taxRate ?? defaultTaxRate) || 0;
    const unitPriceTtc = Number(line.unitPriceTtc || 0) || 0;
    const quantity = Number(line.quantity || 0) || 0;
    const unitPriceHt = taxRate > 0 ? unitPriceTtc / (1 + taxRate / 100) : unitPriceTtc;
    return {
      reference: line.reference || product?.reference || "",
      productName: line.productName,
      quantity,
      unitPriceHt,
      taxRate,
      unitPriceTtc,
      lineTotalTtc: unitPriceTtc * quantity
    };
  });
}

function findWarehouseMeta(warehouses: WarehouseRow[], warehouseId: string, warehouseName: string) {
  const warehouse = warehouses.find((entry) => entry.id === warehouseId);
  return {
    warehouseName: warehouse?.name || warehouseName,
    warehouseAddress: warehouse?.address || ""
  };
}

function SelectionToolbar({
  count,
  onClear,
  onTransform,
  onValidate,
  onPrint,
  onShare,
  onPreview
}: {
  count: number;
  onClear: () => void;
  onTransform?: () => void;
  onValidate?: () => void;
  onPrint: () => void;
  onShare: () => void;
  onPreview: () => void;
}) {
  if (!count) return null;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-[22px] border border-orange-300/15 bg-orange-400/5 px-4 py-3">
      <span className="text-sm text-[#f4e8db]">{count} selection{count > 1 ? "s" : ""}</span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {onTransform ? <Button className="!h-8 !px-3 !text-[12px]" onClick={onTransform}>Transformer en BL</Button> : null}
        {onValidate ? <Button className="!h-8 !px-3 !text-[12px]" onClick={onValidate}>Valider et facturer</Button> : null}
        <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={onPrint}>Imprimer</Button>
        <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={onShare}>Partager</Button>
        <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={onPreview}>Visualiser (PDF)</Button>
        <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={onClear}>Deselectionner</Button>
      </div>
    </div>
  );
}

function useSalesDocumentsModule() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [store, setStoreState] = useState<SalesDocumentsStore>(emptyStore);
  const [company, setCompany] = useState<CompanySettings>(defaultCompanySettings);
  const [vouchers, setVouchers] = useState<CreditVoucherRow[]>([]);
  const storeRef = useRef<SalesDocumentsStore>(emptyStore());

  function replaceStore(nextStore: SalesDocumentsStore) {
    storeRef.current = nextStore;
    setStoreState(nextStore);
  }

  async function saveStore(updater: SalesDocumentsStore | ((current: SalesDocumentsStore) => SalesDocumentsStore)) {
    const nextStore = typeof updater === "function" ? updater(storeRef.current) : updater;
    const savedStore = await api<SalesDocumentsStore>("/sales/documents", {
      method: "PUT",
      body: JSON.stringify(nextStore)
    });
    replaceStore(savedStore);
    return savedStore;
  }

  async function transformQuotes(ids: string[]) {
    const nextStore = await api<SalesDocumentsStore>("/sales/quotes/transform", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
    replaceStore(nextStore);
    return nextStore;
  }

  async function validateDeliveryNotes(ids: string[]) {
    const nextStore = await api<SalesDocumentsStore>("/sales/delivery-notes/validate", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
    replaceStore(nextStore);
    return nextStore;
  }

  async function createCreditNote(payload: Omit<CustomerCreditNote, "id" | "createdAt">) {
    const nextStore = await api<SalesDocumentsStore>("/sales/credits", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    replaceStore(nextStore);
    return nextStore;
  }

  async function load() {
    setLoading(true);
    try {
      const [bootstrap, saleRows] = await Promise.all([
        api<SalesBootstrap>("/sales/bootstrap"),
        api<SaleRow[]>("/sales").catch(() => [])
      ]);
      setProducts(bootstrap.products ?? []);
      setCustomers(bootstrap.customers ?? []);
      setWarehouses(bootstrap.warehouses ?? []);
      setCompany(bootstrap.company ?? defaultCompanySettings());
      setVouchers(bootstrap.vouchers ?? []);
      setSales(saleRows);
      replaceStore(bootstrap.documents ?? emptyStore());
    } catch {
      setProducts([]);
      setCustomers([]);
      setWarehouses([]);
      setCompany(defaultCompanySettings());
      setVouchers([]);
      setSales([]);
      replaceStore(emptyStore());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return { loading, products, customers, warehouses, sales, store, company, vouchers, saveStore, transformQuotes, validateDeliveryNotes, createCreditNote, reload: load };
}

function patchFormLine(lines: SalesLine[], index: number, patch: Partial<SalesLine>) {
  return lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line);
}

function SalesDocumentModal({
  open,
  title,
  eyebrow,
  form,
  customers,
  warehouses,
  products,
  saving,
  error,
  readOnly,
  statusOptions,
  onClose,
  onSubmit,
  onChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onProductPick
}: {
  open: boolean;
  title: string;
  eyebrow: string;
  form: SalesDocumentForm;
  customers: CustomerRow[];
  warehouses: WarehouseRow[];
  products: ProductRow[];
  saving: boolean;
  error: string | null;
  readOnly?: boolean;
  statusOptions: Array<{ value: QuoteStatus | DeliveryStatus; label: string }>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: <K extends keyof SalesDocumentForm>(key: K, value: SalesDocumentForm[K]) => void;
  onLineChange: (index: number, patch: Partial<SalesLine>) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onProductPick: (index: number, productId: string) => void;
}) {
  if (!open) return null;
  const totalAmount = computeTotal(form.lines);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="h-[88vh] w-[1180px] max-w-[1180px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">{eyebrow}</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="h-[calc(88vh-82px)] space-y-4 overflow-y-auto bg-black/[0.18] px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Numero"><Input disabled={readOnly} value={form.number} onChange={(event) => onChange("number", event.target.value)} /></Field>
            <Field label="Client">
              <Select disabled={readOnly} value={form.customerId} onChange={(event) => onChange("customerId", event.target.value)}>
                <option value="">Choisir</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.fullName}</option>)}
              </Select>
            </Field>
            <Field label="Boutique">
              <Select disabled={readOnly} value={form.warehouseId} onChange={(event) => onChange("warehouseId", event.target.value)}>
                <option value="">Choisir</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </Select>
            </Field>
            <Field label="Statut">
              <Select disabled={readOnly} value={form.status} onChange={(event) => onChange("status", event.target.value as SalesDocumentForm["status"])}>
                {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Note interne">
            <Input disabled={readOnly} value={form.note} onChange={(event) => onChange("note", event.target.value)} placeholder="Note, condition de vente, remarque..." />
          </Field>

          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/15">
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed text-sm text-[#eadfd5]">
                <thead className="bg-white/[0.04] text-left text-[12px] uppercase tracking-[0.16em] text-[#ccbcae]">
                  <tr>
                    <th className="w-[42%] px-3 py-3">Article</th>
                    <th className="w-[12%] px-3 py-3">Qte</th>
                    <th className="w-[16%] px-3 py-3">PU TTC</th>
                    <th className="w-[18%] px-3 py-3">Total</th>
                    <th className="w-[12%] px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, index) => {
                    const lineTotal = (Number(line.quantity || 0) || 0) * (Number(line.unitPriceTtc || 0) || 0);
                    return (
                      <tr key={line.id} className="border-t border-white/6 align-top">
                        <td className="px-3 py-3">
                          <div className="space-y-2">
                            <Select disabled={readOnly} value={line.productId} onChange={(event) => onProductPick(index, event.target.value)}>
                              <option value="">Choisir un article</option>
                              {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.reference ? ` - ${product.reference}` : ""}</option>)}
                            </Select>
                            <Input disabled={readOnly} value={line.productName} onChange={(event) => onLineChange(index, { productName: event.target.value, productId: "", reference: "" })} placeholder="Article libre si absent de la liste" />
                          </div>
                        </td>
                        <td className="px-3 py-3"><Input disabled={readOnly} type="number" min="1" value={line.quantity} onChange={(event) => onLineChange(index, { quantity: event.target.value })} /></td>
                        <td className="px-3 py-3"><Input disabled={readOnly} type="number" step="0.01" min="0" value={line.unitPriceTtc} onChange={(event) => onLineChange(index, { unitPriceTtc: event.target.value })} /></td>
                        <td className="px-3 py-3 align-middle"><span className="inline-flex min-h-[40px] items-center text-nowrap text-[#f6c588]">{formatCurrency(lineTotal)}</span></td>
                        <td className="px-3 py-3 text-right">
                          {!readOnly ? <Button variant="secondary" className="!h-10 !px-3 !text-[12px]" type="button" onClick={() => onRemoveLine(index)}>Retirer</Button> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {!readOnly ? <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" type="button" onClick={onAddLine}>Ajouter une ligne</Button> : null}

          {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-orange-300/15 bg-orange-400/5 p-4">
            <div className="text-sm text-[#e8ddcf]">Document client avec logique de transformation documentaire.</div>
            <div className="rounded-[18px] border border-orange-300/20 bg-orange-300/10 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-orange-200/80">Total document</p>
              <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(totalAmount)}</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <Button variant="secondary" type="button" className="!h-9 !px-3.5 !text-[12px]" onClick={onClose}>Annuler</Button>
            {!readOnly ? <Button type="submit" className="!h-9 !px-3.5 !text-[12px]">{saving ? "Enregistrement..." : "Enregistrer"}</Button> : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function CreditNoteModal({
  open,
  form,
  sources,
  saving,
  error,
  onClose,
  onChange,
  onSubmit
}: {
  open: boolean;
  form: CreditForm;
  sources: { invoices: SelectableDocument[]; tickets: SelectableDocument[] };
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onChange: <K extends keyof CreditForm>(key: K, value: CreditForm[K]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) return null;
  const documents = form.sourceType === "INVOICE" ? sources.invoices : sources.tickets;
  const selectedDocument = documents.find((item) => item.id === form.sourceId) ?? null;
  const selectedLine = selectedDocument?.lines.find((line) => line.id === form.lineId) ?? null;
  const quantity = Math.max(1, Number(form.quantity || 1));
  const computedAmount = selectedLine ? Math.min(quantity, selectedLine.quantity) * selectedLine.unitPriceTtc : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[780px] rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Ventes</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Nouvel avoir client</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Numero"><Input value={form.number} onChange={(event) => onChange("number", event.target.value)} /></Field>
            <Field label="Source">
              <Select value={form.sourceType} onChange={(event) => { onChange("sourceType", event.target.value as CreditForm["sourceType"]); onChange("sourceId", ""); onChange("lineId", ""); }}>
                <option value="INVOICE">Facture client</option>
                <option value="TICKET">Ticket de caisse</option>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={form.sourceType === "INVOICE" ? "Facture" : "Ticket"}>
              <Select value={form.sourceId} onChange={(event) => { onChange("sourceId", event.target.value); onChange("lineId", ""); }}>
                <option value="">Choisir</option>
                {documents.map((document) => <option key={document.id} value={document.id}>{document.number} - {document.customerName}</option>)}
              </Select>
            </Field>
            <Field label="Article source">
              <Select value={form.lineId} onChange={(event) => onChange("lineId", event.target.value)} disabled={!selectedDocument}>
                <option value="">Choisir</option>
                {selectedDocument?.lines.map((line) => <option key={line.id} value={line.id}>{line.productName} - {line.reference || "Sans ref"}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
            <Field label="Quantite">
              <Input type="number" min="1" value={form.quantity} onChange={(event) => onChange("quantity", event.target.value)} />
            </Field>
            <Field label="Motif">
              <Input value={form.reason} onChange={(event) => onChange("reason", event.target.value)} placeholder="Retour article, geste commercial, erreur de saisie..." />
            </Field>
          </div>

          <div className="rounded-[22px] border border-orange-300/15 bg-orange-400/5 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">Document source</p>
                <p className="mt-2 font-semibold text-white">{selectedDocument?.number ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#cdbfaf]">Montant avoir</p>
                <p className="mt-2 text-lg font-semibold text-white">{formatCurrency(computedAmount)}</p>
              </div>
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

function QuoteTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  onOpen
}: {
  items: Quote[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (item: Quote) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-[48px]"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.id))} onChange={onToggleAll} /></th>
            <th>Numero</th>
            <th>Client</th>
            <th>Boutique</th>
            <th>Statut</th>
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
                <div className="mt-1 text-xs text-[#b9aa9b]">{item.lines.length} ligne(s)</div>
              </td>
              <td>{item.customerName}</td>
              <td>{item.warehouseName}</td>
              <td><Badge tone={quoteTone(item.status)}>{item.status}</Badge></td>
              <td>{formatDate(item.createdAt)}</td>
              <td>{formatCurrency(item.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  onOpen
}: {
  items: DeliveryNote[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (item: DeliveryNote) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-[48px]"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.id))} onChange={onToggleAll} /></th>
            <th>Numero</th>
            <th>Client</th>
            <th>Boutique</th>
            <th>Statut</th>
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
                <div className="mt-1 text-xs text-[#b9aa9b]">{item.sourceQuoteNumber ? `Depuis ${item.sourceQuoteNumber}` : "BL direct"}</div>
              </td>
              <td>{item.customerName}</td>
              <td>{item.warehouseName}</td>
              <td><Badge tone={deliveryTone(item.status)}>{item.status}</Badge></td>
              <td>{formatDate(item.createdAt)}</td>
              <td>{formatCurrency(item.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTable({
  items,
  selected,
  onToggle,
  onToggleAll
}: {
  items: CustomerInvoice[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-[48px]"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.id))} onChange={onToggleAll} /></th>
            <th>Numero</th>
            <th>Client</th>
            <th>Source</th>
            <th>Date</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} /></td>
              <td>
                <div className="font-medium text-white">{item.number}</div>
                <div className="mt-1 text-xs text-[#b9aa9b]">{item.lines.length} ligne(s)</div>
              </td>
              <td>{item.customerName}</td>
              <td>{item.sourceDeliveryNumber}</td>
              <td>{formatDate(item.createdAt)}</td>
              <td>{formatCurrency(item.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreditTable({
  items,
  vouchers,
  selected,
  onToggle,
  onToggleAll
}: {
  items: CustomerCreditNote[];
  vouchers: CreditVoucherRow[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const voucherMap = new Map(vouchers.map((voucher) => [voucher.number, voucher]));
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-[48px]"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.id))} onChange={onToggleAll} /></th>
            <th>Numero</th>
            <th>Bon</th>
            <th>Source</th>
            <th>Client</th>
            <th>Origine</th>
            <th>Motif</th>
            <th>Date</th>
            <th>Montant</th>
            <th>Solde</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const voucher = voucherMap.get(String(item.voucherNumber || item.number));
            const balance = Number(voucher?.balanceAmount ?? item.voucherBalanceAmount ?? 0);
            const initial = Number(voucher?.initialAmount ?? item.voucherInitialAmount ?? item.amount ?? 0);
            const status = balance <= 0 ? "Solde" : balance < initial ? "Partiel" : "Actif";
            return (
            <tr key={item.id}>
              <td><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} /></td>
              <td className="font-medium text-white">{item.number}</td>
              <td>
                <div className="font-medium text-white">{voucher?.number || item.voucherNumber || "-"}</div>
                <div className="mt-1 text-xs text-[#b9aa9b]">{status}</div>
              </td>
              <td>{item.sourceNumber}</td>
              <td>
                <div>{item.customerName}</div>
                <div className="mt-1 text-xs text-[#b9aa9b]">{item.customerPhone || voucher?.customerPhone || "-"}</div>
              </td>
              <td>{item.origin === "POS" ? "Caisse" : "Admin"}{item.createdByName ? ` - ${item.createdByName}` : ""}</td>
              <td>{item.reason || "-"}</td>
              <td>{formatDate(item.createdAt)}</td>
              <td>{formatCurrency(item.amount)}</td>
              <td>{formatCurrency(balance)}</td>
            </tr>
          );})}
        </tbody>
      </table>
    </div>
  );
}

export function SalesQuotesPage() {
  const { loading, products, customers, warehouses, store, company, saveStore, transformQuotes, reload } = useSalesDocumentsModule();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SalesDocumentForm>(defaultSalesForm("DRAFT"));

  const filtered = useMemo(() => store.quotes.filter((item) => {
    const haystack = `${item.number} ${item.customerName} ${item.warehouseName} ${item.status} ${item.totalAmount}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [search, store.quotes]);

  const stats = useMemo(() => ({
    total: store.quotes.length,
    validated: store.quotes.filter((item) => item.status === "VALIDATED").length,
    transformed: store.quotes.filter((item) => item.status === "TRANSFORMED").length,
    amount: store.quotes.reduce((sum, item) => sum + item.totalAmount, 0)
  }), [store.quotes]);

  function patch<K extends keyof SalesDocumentForm>(key: K, value: SalesDocumentForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patchValue: Partial<SalesLine>) {
    setForm((current) => ({ ...current, lines: patchFormLine(current.lines, index, patchValue) }));
  }

  function applyProduct(index: number, productId: string) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    setLine(index, {
      productId: product.id,
      productName: product.name,
      reference: product.reference ?? "",
      unitPriceTtc: String(Number(product.salePriceTtc || 0))
    });
  }

  function openCreate() {
    setEditingId(null);
    setError(null);
    setForm({ ...defaultSalesForm("DRAFT"), number: nextNumber("DEV", store.quotes.map((item) => item.number)) });
    setModalOpen(true);
  }

  function openEdit(item: Quote) {
    setEditingId(item.id);
    setError(null);
    setForm({
      number: item.number,
      customerId: item.customerId,
      warehouseId: item.warehouseId,
      status: item.status,
      note: item.note,
      lines: cloneLines(item.lines)
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setError(null);
  }

  function toggleSelect(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    setSelected((current) => visibleIds.every((id) => current.includes(id)) ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.number.trim() || !form.customerId || !form.warehouseId || !form.lines.some((line) => line.productName.trim())) {
      setError("Renseigne le numero, le client, la boutique et au moins une ligne article.");
      return;
    }

    setSaving(true);
    setError(null);
    const customer = customers.find((entry) => entry.id === form.customerId);
    const warehouse = warehouses.find((entry) => entry.id === form.warehouseId);
    const payload: Quote = {
      id: editingId ?? `quote-${Date.now()}`,
      number: form.number.trim(),
      status: form.status as QuoteStatus,
      createdAt: editingId ? store.quotes.find((item) => item.id === editingId)?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
      customerId: form.customerId,
      customerName: customer?.fullName ?? "Client",
      warehouseId: form.warehouseId,
      warehouseName: warehouse?.name ?? "Boutique",
      note: form.note.trim(),
      totalAmount: computeTotal(form.lines),
      lines: form.lines.filter((line) => line.productName.trim()).map((line) => ({ ...line }))
    };

    try {
      await saveStore((current) => ({
        ...current,
        quotes: editingId ? current.quotes.map((item) => item.id === editingId ? payload : item) : [payload, ...current.quotes]
      }));
      setModalOpen(false);
      setEditingId(null);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Erreur API");
    } finally {
      setSaving(false);
    }
  }

  async function transformSelection() {
    const rows = store.quotes.filter((item) => selected.includes(item.id) && item.status !== "CANCELLED" && item.status !== "TRANSFORMED");
    if (!rows.length) return;
    setError(null);
    try {
      await transformQuotes(rows.map((item) => item.id));
      setSelected([]);
    } catch (transformError) {
      setError(transformError instanceof Error ? transformError.message : "Erreur API");
    }
  }

  function previewSelection(shouldPrint = false) {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    previewHtml(buildDocumentsBundleHtml(company, rows.map((item) => {
      const warehouseMeta = findWarehouseMeta(warehouses, item.warehouseId, item.warehouseName);
        return {
          title: "Devis client",
          eyebrow: "Ventes / Devis",
          kind: "QUOTE",
          number: item.number,
          createdAt: item.createdAt,
          customerName: item.customerName,
        warehouseName: warehouseMeta.warehouseName,
        warehouseAddress: warehouseMeta.warehouseAddress,
        note: item.note,
        lines: buildPrintLines(item.lines, products, company.defaultTaxRate)
      };
    })), shouldPrint);
  }

  function shareSelection() {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const body = rows.map((item) => `${item.number} - ${item.customerName} - ${formatCurrency(item.totalAmount)}`).join("%0D%0A");
    window.location.href = `mailto:?subject=${encodeURIComponent("Devis clients")}&body=${body}`;
  }

  if (loading) return <LoadingBlock label="Chargement des devis..." />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Ventes"
          title="Devis"
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void reload()}>Actualiser</Button>
              <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Nouveau devis</Button>
            </>
          }
        />

        <SectionCard title="Liste" actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher un devis..." value={search} onChange={(event) => setSearch(event.target.value)} />}>
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <SelectionToolbar
            count={selected.length}
            onClear={() => setSelected([])}
            onTransform={selected.length ? () => void transformSelection() : undefined}
            onPrint={() => previewSelection(true)}
            onShare={shareSelection}
            onPreview={() => previewSelection(false)}
          />

          {filtered.length === 0 ? (
            <EmptyState compact title="Aucun devis" description="Cree un premier devis pour demarrer le cycle commercial." action={<Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreate}>Nouveau devis</Button>} />
          ) : (
            <QuoteTable items={filtered} selected={selected} onToggle={toggleSelect} onToggleAll={toggleAllVisible} onOpen={openEdit} />
          )}
        </SectionCard>
      </div>

      <SalesDocumentModal
        open={modalOpen}
        title={editingId ? "Modifier le devis" : "Nouveau devis"}
        eyebrow="Ventes / Devis"
        form={form}
        customers={customers}
        warehouses={warehouses}
        products={products}
        saving={saving}
        error={error}
        readOnly={Boolean(editingId && store.quotes.find((item) => item.id === editingId)?.status === "TRANSFORMED")}
        statusOptions={[
          { value: "DRAFT", label: "Brouillon" },
          { value: "VALIDATED", label: "Valide" },
          { value: "CANCELLED", label: "Annule" }
        ]}
        onClose={closeModal}
        onSubmit={submit}
        onChange={patch}
        onLineChange={setLine}
        onAddLine={() => setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }))}
        onRemoveLine={(index) => setForm((current) => ({ ...current, lines: current.lines.length > 1 ? current.lines.filter((_, lineIndex) => lineIndex !== index) : [blankLine()] }))}
        onProductPick={applyProduct}
      />
    </>
  );
}

export function DeliveryNotesPage() {
  const { loading, products, customers, warehouses, store, company, saveStore, validateDeliveryNotes, reload } = useSalesDocumentsModule();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SalesDocumentForm>(defaultSalesForm("DRAFT"));

  const filtered = useMemo(() => store.deliveries.filter((item) => {
    const haystack = `${item.number} ${item.customerName} ${item.warehouseName} ${item.status} ${item.totalAmount}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [search, store.deliveries]);

  const stats = useMemo(() => ({
    total: store.deliveries.length,
    draft: store.deliveries.filter((item) => item.status === "DRAFT").length,
    invoiced: store.deliveries.filter((item) => item.status === "INVOICED").length,
    amount: store.deliveries.reduce((sum, item) => sum + item.totalAmount, 0)
  }), [store.deliveries]);

  function patch<K extends keyof SalesDocumentForm>(key: K, value: SalesDocumentForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patchValue: Partial<SalesLine>) {
    setForm((current) => ({ ...current, lines: patchFormLine(current.lines, index, patchValue) }));
  }

  function applyProduct(index: number, productId: string) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    setLine(index, {
      productId: product.id,
      productName: product.name,
      reference: product.reference ?? "",
      unitPriceTtc: String(Number(product.salePriceTtc || 0))
    });
  }

  function openCreate() {
    setEditingId(null);
    setError(null);
    setForm({ ...defaultSalesForm("DRAFT"), number: nextNumber("BLC", store.deliveries.map((item) => item.number)) });
    setModalOpen(true);
  }

  function openEdit(item: DeliveryNote) {
    setEditingId(item.id);
    setError(null);
    setForm({
      number: item.number,
      customerId: item.customerId,
      warehouseId: item.warehouseId,
      status: item.status,
      note: item.note,
      lines: cloneLines(item.lines)
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setError(null);
  }

  function toggleSelect(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    setSelected((current) => visibleIds.every((id) => current.includes(id)) ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.number.trim() || !form.customerId || !form.warehouseId || !form.lines.some((line) => line.productName.trim())) {
      setError("Renseigne le numero, le client, la boutique et au moins une ligne article.");
      return;
    }

    setSaving(true);
    setError(null);
    const customer = customers.find((entry) => entry.id === form.customerId);
    const warehouse = warehouses.find((entry) => entry.id === form.warehouseId);
    const currentDocument = store.deliveries.find((item) => item.id === editingId);
    const payload: DeliveryNote = {
      id: editingId ?? `delivery-${Date.now()}`,
      number: form.number.trim(),
      status: form.status as DeliveryStatus,
      createdAt: currentDocument?.createdAt ?? new Date().toISOString(),
      validatedAt: currentDocument?.validatedAt ?? null,
      invoiceNumber: currentDocument?.invoiceNumber ?? null,
      sourceQuoteId: currentDocument?.sourceQuoteId ?? null,
      sourceQuoteNumber: currentDocument?.sourceQuoteNumber ?? null,
      customerId: form.customerId,
      customerName: customer?.fullName ?? "Client",
      warehouseId: form.warehouseId,
      warehouseName: warehouse?.name ?? "Boutique",
      note: form.note.trim(),
      totalAmount: computeTotal(form.lines),
      lines: form.lines.filter((line) => line.productName.trim()).map((line) => ({ ...line }))
    };

    try {
      await saveStore((current) => ({
        ...current,
        deliveries: editingId ? current.deliveries.map((item) => item.id === editingId ? payload : item) : [payload, ...current.deliveries]
      }));
      setModalOpen(false);
      setEditingId(null);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Erreur API");
    } finally {
      setSaving(false);
    }
  }

  async function validateSelection() {
    const rows = store.deliveries.filter((item) => selected.includes(item.id) && item.status === "DRAFT");
    if (!rows.length) return;
    setError(null);
    try {
      await validateDeliveryNotes(rows.map((item) => item.id));
      setSelected([]);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Erreur API");
    }
  }

  function previewSelection(shouldPrint = false) {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    previewHtml(buildDocumentsBundleHtml(company, rows.map((item) => {
      const warehouseMeta = findWarehouseMeta(warehouses, item.warehouseId, item.warehouseName);
      return {
        title: "Bon de livraison",
        eyebrow: "Ventes / Livraison",
        kind: "DELIVERY",
        number: item.number,
        createdAt: item.createdAt,
        customerName: item.customerName,
        warehouseName: warehouseMeta.warehouseName,
        warehouseAddress: warehouseMeta.warehouseAddress,
        note: [item.sourceQuoteNumber ? `Source devis : ${item.sourceQuoteNumber}` : "", item.note].filter(Boolean).join(" | "),
        lines: buildPrintLines(item.lines, products, company.defaultTaxRate)
      };
    })), shouldPrint);
  }

  function shareSelection() {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const body = rows.map((item) => `${item.number} - ${item.customerName} - ${formatCurrency(item.totalAmount)}`).join("%0D%0A");
    window.location.href = `mailto:?subject=${encodeURIComponent("Bons de livraison")}&body=${body}`;
  }

  if (loading) return <LoadingBlock label="Chargement des bons de livraison..." />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Ventes"
          title="Bon de Livraison"
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void reload()}>Actualiser</Button>
              <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Nouveau BL</Button>
            </>
          }
        />

        <SectionCard title="Liste" actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher un BL..." value={search} onChange={(event) => setSearch(event.target.value)} />}>
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <SelectionToolbar
            count={selected.length}
            onClear={() => setSelected([])}
            onValidate={selected.length ? () => void validateSelection() : undefined}
            onPrint={() => previewSelection(true)}
            onShare={shareSelection}
            onPreview={() => previewSelection(false)}
          />

          {filtered.length === 0 ? (
            <EmptyState compact title="Aucun bon de livraison" description="Transforme un devis ou cree un BL direct pour demarrer." action={<Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreate}>Nouveau BL</Button>} />
          ) : (
            <DeliveryTable items={filtered} selected={selected} onToggle={toggleSelect} onToggleAll={toggleAllVisible} onOpen={openEdit} />
          )}
        </SectionCard>
      </div>

      <SalesDocumentModal
        open={modalOpen}
        title={editingId ? "Modifier le bon de livraison" : "Nouveau bon de livraison"}
        eyebrow="Ventes / Livraison"
        form={form}
        customers={customers}
        warehouses={warehouses}
        products={products}
        saving={saving}
        error={error}
        readOnly={Boolean(editingId && store.deliveries.find((item) => item.id === editingId)?.status !== "DRAFT")}
        statusOptions={[
          { value: "DRAFT", label: "Brouillon" },
          { value: "CANCELLED", label: "Annule" }
        ]}
        onClose={closeModal}
        onSubmit={submit}
        onChange={patch}
        onLineChange={setLine}
        onAddLine={() => setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }))}
        onRemoveLine={(index) => setForm((current) => ({ ...current, lines: current.lines.length > 1 ? current.lines.filter((_, lineIndex) => lineIndex !== index) : [blankLine()] }))}
        onProductPick={applyProduct}
      />
    </>
  );
}

export function CustomerInvoicesPage() {
  const { loading, store, warehouses, products, company, reload } = useSalesDocumentsModule();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => store.invoices.filter((item) => {
    const haystack = `${item.number} ${item.customerName} ${item.sourceDeliveryNumber} ${item.amount}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [search, store.invoices]);

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
    previewHtml(buildDocumentsBundleHtml(company, rows.map((item) => {
      const warehouseMeta = findWarehouseMeta(warehouses, item.warehouseId, item.warehouseName);
      return {
        title: "Facture commerciale",
        eyebrow: "Ventes / Facturation",
        number: item.number,
        createdAt: item.createdAt,
        customerName: item.customerName,
        warehouseName: warehouseMeta.warehouseName,
        warehouseAddress: warehouseMeta.warehouseAddress,
        note: `Source: ${item.sourceDeliveryNumber}`,
        lines: buildPrintLines(item.lines, products, company.defaultTaxRate),
        dueDate: item.createdAt,
        paymentMethod: "A definir",
        paymentStatus: "Non reglee",
        stampLabel: "Facture",
        documentCode: `${item.number} / ${warehouseMeta.warehouseName}`,
        copyLabel: "Copie client"
      };
    })), shouldPrint);
  }

  function shareSelection() {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const body = rows.map((item) => `${item.number} - ${item.customerName} - ${formatCurrency(item.amount)}`).join("%0D%0A");
    window.location.href = `mailto:?subject=${encodeURIComponent("Factures clients")}&body=${body}`;
  }

  if (loading) return <LoadingBlock label="Chargement des factures clients..." />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ventes" title="Factures Client" actions={<Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void reload()}>Actualiser</Button>} />

      <SectionCard title="Liste" actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher une facture client..." value={search} onChange={(event) => setSearch(event.target.value)} />}>
        <SelectionToolbar count={selected.length} onClear={() => setSelected([])} onPrint={() => previewSelection(true)} onShare={shareSelection} onPreview={() => previewSelection(false)} />
        {filtered.length === 0 ? (
          <EmptyState compact title="Aucune facture client" description="" />
        ) : (
          <InvoiceTable items={filtered} selected={selected} onToggle={toggleSelect} onToggleAll={toggleAllVisible} />
        )}
      </SectionCard>
    </div>
  );
}

export function CustomerCreditNotesPage() {
  const { loading, store, sales, products, company, vouchers, customers, createCreditNote, reload } = useSalesDocumentsModule();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreditForm>(defaultCreditForm());

  const invoiceSources = useMemo<SelectableDocument[]>(() => store.invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    customerName: invoice.customerName,
    createdAt: invoice.createdAt,
    warehouseId: invoice.warehouseId,
    warehouseName: invoice.warehouseName,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: line.productName,
      reference: line.reference,
      quantity: Number(line.quantity || 0),
      unitPriceTtc: Number(line.unitPriceTtc || 0),
      lineTotal: (Number(line.quantity || 0) || 0) * (Number(line.unitPriceTtc || 0) || 0)
    }))
  })), [store.invoices]);

  const ticketSources = useMemo<SelectableDocument[]>(() => sales.map((sale) => ({
    id: sale.id,
    number: sale.number,
    customerName: sale.customer?.fullName ?? "Client comptoir",
    createdAt: sale.createdAt,
    warehouseId: sale.warehouse.id,
    warehouseName: sale.warehouse.name,
    lines: sale.items.map((item) => ({
      id: item.id,
      productId: item.product.id,
      productName: item.product.name,
      reference: item.product.reference ?? "",
      quantity: item.quantity,
      unitPriceTtc: Number(item.unitPriceTtc || (item.quantity ? item.lineTotal / item.quantity : 0)),
      lineTotal: Number(item.lineTotal || 0)
    }))
  })), [sales]);

  const filtered = useMemo(() => store.credits.filter((item) => {
    const haystack = `${item.number} ${item.voucherNumber || ""} ${item.sourceNumber} ${item.customerName} ${item.customerPhone || ""} ${item.reason} ${item.amount} ${item.origin || ""} ${item.createdByName || ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [search, store.credits]);

  function openCreate() {
    setError(null);
    setForm({ ...defaultCreditForm(), number: nextNumber("AVC", store.credits.map((item) => item.number)) });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setError(null);
  }

  function patch<K extends keyof CreditForm>(key: K, value: CreditForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleSelect(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    setSelected((current) => visibleIds.every((id) => current.includes(id)) ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sources = form.sourceType === "INVOICE" ? invoiceSources : ticketSources;
    const source = sources.find((item) => item.id === form.sourceId);
    const line = source?.lines.find((item) => item.id === form.lineId);
    const quantity = Number(form.quantity || 0);

    if (!form.number.trim() || !source || !line || quantity <= 0 || !form.reason.trim()) {
      setError("Choisis une source, un article, une quantite et un motif valides.");
      return;
    }

    setSaving(true);
    setError(null);
    const finalQuantity = Math.min(quantity, line.quantity);
    const amount = finalQuantity * line.unitPriceTtc;

    const payload: CustomerCreditNote = {
      id: "",
      number: form.number.trim(),
      createdAt: "",
      sourceType: form.sourceType,
      sourceId: source.id,
      sourceNumber: source.number,
      customerName: source.customerName,
      customerPhone: customers.find((customer) => customer.fullName === source.customerName)?.phone || "",
      warehouseId: source.warehouseId ?? null,
      warehouseName: source.warehouseName ?? "",
      origin: "ADMIN",
      createdByName: "",
      voucherNumber: form.number.trim(),
      voucherInitialAmount: amount,
      voucherBalanceAmount: amount,
      reason: form.reason.trim(),
      amount,
      items: [{
        id: line.id,
        productId: line.productId ?? null,
        sourceSaleItemId: form.sourceType === "TICKET" ? line.id : null,
        productName: line.productName,
        reference: line.reference,
        quantity: finalQuantity,
        unitPriceTtc: line.unitPriceTtc,
        lineTotal: amount
      }]
    };

    try {
      await createCreditNote({
        number: payload.number,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        sourceNumber: payload.sourceNumber,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone || "",
        warehouseId: payload.warehouseId ?? null,
        warehouseName: payload.warehouseName,
        origin: payload.origin || "ADMIN",
        createdByName: payload.createdByName || "",
        voucherNumber: payload.voucherNumber || payload.number,
        voucherInitialAmount: payload.voucherInitialAmount || payload.amount,
        voucherBalanceAmount: payload.voucherBalanceAmount || payload.amount,
        reason: payload.reason,
        amount: payload.amount,
        items: payload.items
      });
      setModalOpen(false);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Erreur API");
    } finally {
      setSaving(false);
    }
  }

  function previewSelection(shouldPrint = false) {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    previewHtml(buildDocumentsBundleHtml(company, rows.map((item) => {
      const saleSource = item.sourceType === "TICKET" ? sales.find((sale) => sale.id === item.sourceId) : null;
      return {
        title: "Avoir client",
        eyebrow: "Ventes / Avoir",
        kind: "CREDIT",
        number: item.number,
        createdAt: item.createdAt,
        customerName: item.customerName,
        warehouseName: item.warehouseName || "-",
        warehouseAddress: "",
        note: item.reason,
        sellerName: saleSource?.sellerName || "",
        documentCode: item.sourceNumber,
        lines: item.items.map((creditItem) => {
          const product = products.find((entry) => entry.id === creditItem.productId);
          const taxRate = Number(product?.taxRate ?? company.defaultTaxRate) || 0;
          const unitPriceHt = taxRate > 0 ? creditItem.unitPriceTtc / (1 + taxRate / 100) : creditItem.unitPriceTtc;
          return {
            reference: creditItem.reference,
            productName: creditItem.productName,
            quantity: creditItem.quantity,
            unitPriceHt,
            taxRate,
            unitPriceTtc: creditItem.unitPriceTtc,
            lineTotalTtc: creditItem.lineTotal
          };
        })
      };
    })), shouldPrint);
  }

  function shareSelection() {
    const rows = filtered.filter((item) => selected.includes(item.id));
    if (!rows.length) return;
    const body = rows.map((item) => `${item.number} - ${item.customerName} - ${formatCurrency(item.amount)}`).join("%0D%0A");
    window.location.href = `mailto:?subject=${encodeURIComponent("Avoirs clients")}&body=${body}`;
  }

  if (loading) return <LoadingBlock label="Chargement des avoirs clients..." />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Ventes"
          title="Avoirs Clients"
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void reload()}>Actualiser</Button>
              <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Nouvel avoir</Button>
            </>
          }
        />

        <SectionCard title="Liste" actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher un avoir client..." value={search} onChange={(event) => setSearch(event.target.value)} />}>
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <SelectionToolbar count={selected.length} onClear={() => setSelected([])} onPrint={() => previewSelection(true)} onShare={shareSelection} onPreview={() => previewSelection(false)} />

          {filtered.length === 0 ? (
            <EmptyState compact title="Aucun avoir client" description="" action={<Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreate}>Nouvel avoir</Button>} />
          ) : (
            <CreditTable items={filtered} vouchers={vouchers} selected={selected} onToggle={toggleSelect} onToggleAll={toggleAllVisible} />
          )}
        </SectionCard>
      </div>

      <CreditNoteModal
        open={modalOpen}
        form={form}
        sources={{ invoices: invoiceSources, tickets: ticketSources }}
        saving={saving}
        error={error}
        onClose={closeModal}
        onChange={patch}
        onSubmit={submit}
      />
    </>
  );
}
