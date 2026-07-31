import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Textarea } from "../../components/ui/primitives";
import { api } from "../../lib/api";
import { formatCurrency, formatDate, formatNumber } from "../../lib/format";

type SupplierForm = {
  name: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  notes: string;
};

type SupplierDetail = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  balanceDue: number;
  createdAt: string;
  purchasesCount: number;
  invoicesCount: number;
  totalPurchased: number;
  totalInvoiced: number;
  totalCreditNotes: number;
  purchases: Array<{
    id: string;
    number: string;
    status: "DRAFT" | "ORDERED" | "RECEIVED" | "INVOICED" | "CANCELLED";
    totalAmount: number;
    amountDue: number;
    createdAt: string;
    warehouse: { id: string; name: string };
    items: Array<{ id: string; quantity: number; product: { id: string; name: string; reference: string } }>;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    amount: number;
    dueDate?: string | null;
    isPaid: boolean;
    createdAt: string;
  }>;
  creditNotes: Array<{
    id: string;
    number: string;
    amount: number;
    reason?: string | null;
    createdAt: string;
  }>;
};

const defaultForm: SupplierForm = {
  name: "",
  phone: "",
  email: "",
  city: "",
  address: "",
  notes: ""
};

function SupplierModal({
  open,
  title,
  form,
  saving,
  error,
  onClose,
  onSubmit,
  onChange
}: {
  open: boolean;
  title: string;
  form: SupplierForm;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: <K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[760px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Fournisseurs</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 bg-black/[0.18] px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom">
              <Input value={form.name} onChange={(event) => onChange("name", event.target.value)} autoFocus />
            </Field>
            <Field label="Telephone">
              <Input value={form.phone} onChange={(event) => onChange("phone", event.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} />
            </Field>
            <Field label="Ville">
              <Input value={form.city} onChange={(event) => onChange("city", event.target.value)} />
            </Field>
          </div>

          <Field label="Adresse">
            <Input value={form.address} onChange={(event) => onChange("address", event.target.value)} />
          </Field>

          <Field label="Notes">
            <Textarea rows={4} value={form.notes} onChange={(event) => onChange("notes", event.target.value)} />
          </Field>

          {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <Button variant="secondary" type="button" onClick={onClose}>Annuler</Button>
            <Button type="submit">{saving ? "Enregistrement..." : "Enregistrer"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function purchaseTone(status: SupplierDetail["purchases"][number]["status"]) {
  if (status === "RECEIVED" || status === "INVOICED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

export function SupplierDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [item, setItem] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SupplierForm>(defaultForm);

  async function loadSupplier() {
    if (!id) {
      setError("Fournisseur introuvable.");
      setLoading(false);
      return;
    }

    const supplier = await api<SupplierDetail>(`/suppliers/${id}`);
    setItem(supplier);
    setForm({
      name: supplier.name,
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      city: supplier.city ?? "",
      address: supplier.address ?? "",
      notes: supplier.notes ?? ""
    });
  }

  useEffect(() => {
    loadSupplier()
      .catch((err) => setError(err instanceof Error ? err.message : "Impossible de charger la fiche fournisseur."))
      .finally(() => setLoading(false));
  }, [id]);

  const supplierSince = useMemo(() => (item ? formatDate(item.createdAt) : "-"), [item]);

  function patch<K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    setSaving(true);
    setError(null);

    const payload = {
      ...form,
      phone: form.phone || null,
      email: form.email || null,
      city: form.city || null,
      address: form.address || null,
      notes: form.notes || null
    };

    try {
      await api(`/suppliers/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
      await loadSupplier();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSupplier() {
    if (!item) return;
    if (!window.confirm("Supprimer ce fournisseur ?")) return;

    try {
      setError(null);
      await api(`/suppliers/${item.id}`, { method: "DELETE" });
      navigate("/gestion/fournisseurs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  if (loading) return <LoadingBlock label="Chargement de la fiche fournisseur..." />;
  if (error || !item) {
    return (
      <EmptyState
        title="Fiche fournisseur indisponible"
        description={error ?? "Impossible de trouver ce fournisseur."}
        action={<Link to="/gestion/fournisseurs" className="btn-secondary">Retour a la liste</Link>}
      />
    );
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Fournisseurs"
          title={item.name}
          description={`Actif depuis ${supplierSince}`}
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => setModalOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Modifier
              </Button>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void removeSupplier()}>
                <Trash2 className="mr-2 h-4 w-4" />
                Supprimer
              </Button>
              <Link to="/gestion/fournisseurs" className="btn-secondary">Retour a la liste</Link>
            </>
          }
        />

        <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
          <SectionCard title="Fiche fournisseur">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Telephone</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{item.phone || "-"}</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Email</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{item.email || "-"}</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Ville</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{item.city || "-"}</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Encours</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(Number(item.balanceDue))}</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3 md:col-span-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Adresse</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{item.address || "Aucune adresse"}</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3 md:col-span-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Notes</p>
                <p className="mt-1 text-[13px] leading-5 text-[#eadfd4]">{item.notes || "Aucune note."}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Synthese achats" className="!p-4 md:!p-4.5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Achats</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{formatNumber(item.purchasesCount)}</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Montant achats</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(item.totalPurchased)}</p>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Montant facture</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(item.totalInvoiced)}</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Avoirs</p>
                <p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(item.totalCreditNotes)}</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Historique des achats">
          {item.purchases.length === 0 ? (
            <EmptyState title="Aucun achat" description="Ce fournisseur n'a encore aucun bon d'achat enregistre." compact />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Depot</th>
                    <th>Lignes</th>
                    <th>Montant</th>
                    <th>Reste du</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {item.purchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td>
                        <div className="font-medium text-white">{purchase.number}</div>
                        <div className="mt-1 text-xs text-[#b9aa9b]">{formatDate(purchase.createdAt)}</div>
                      </td>
                      <td>{purchase.warehouse.name}</td>
                      <td>{formatNumber(purchase.items.length)}</td>
                      <td>{formatCurrency(Number(purchase.totalAmount))}</td>
                      <td>{formatCurrency(Number(purchase.amountDue))}</td>
                      <td><Badge tone={purchaseTone(purchase.status)}>{purchase.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard title="Factures fournisseur">
            {item.invoices.length === 0 ? (
              <EmptyState title="Aucune facture" description="Aucune facture fournisseur n'est encore liee a cette fiche." compact />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Facture</th>
                      <th>Emission</th>
                      <th>Echeance</th>
                      <th>Montant</th>
                      <th>Etat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.number}</td>
                        <td>{formatDate(invoice.createdAt)}</td>
                        <td>{invoice.dueDate ? formatDate(invoice.dueDate) : "-"}</td>
                        <td>{formatCurrency(Number(invoice.amount))}</td>
                        <td><Badge tone={invoice.isPaid ? "success" : "warning"}>{invoice.isPaid ? "Payee" : "Non payee"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Avoirs fournisseur">
            {item.creditNotes.length === 0 ? (
              <EmptyState title="Aucun avoir" description="Aucun avoir fournisseur n'est encore enregistre pour cette fiche." compact />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Avoir</th>
                      <th>Date</th>
                      <th>Montant</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.creditNotes.map((creditNote) => (
                      <tr key={creditNote.id}>
                        <td>{creditNote.number}</td>
                        <td>{formatDate(creditNote.createdAt)}</td>
                        <td>{formatCurrency(Number(creditNote.amount))}</td>
                        <td>{creditNote.reason || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SupplierModal
        open={modalOpen}
        title="Modifier le fournisseur"
        form={form}
        saving={saving}
        error={error}
        onClose={closeModal}
        onSubmit={submit}
        onChange={patch}
      />
    </>
  );
}