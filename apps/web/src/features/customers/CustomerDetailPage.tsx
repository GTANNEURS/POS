import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select, Textarea } from "../../components/ui/primitives";
import { api } from "../../lib/api";
import { formatCurrency, formatDate, formatNumber } from "../../lib/format";

type CustomerForm = {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  notes: string;
  loyaltyPoints: string;
  discountRate: string;
  level: string;
};

type CustomerDetail = {
  id: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  loyaltyPoints: number;
  discountRate: number;
  level: string;
  balanceDue: number;
  createdAt: string;
  purchasesCount: number;
  totalSpent: number;
  totalPaid: number;
  returnsCount: number;
  totalReturns: number;
  sales: Array<{
    id: string;
    number: string;
    status: "PAID" | "PARTIAL" | "UNPAID" | "CANCELLED" | "REFUNDED";
    totalAmount: number;
    paidAmount: number;
    createdAt: string;
    warehouse: { id: string; name: string };
    items: Array<{ id: string; quantity: number; product: { id: string; name: string; reference: string } }>;
  }>;
  loyaltyTransactions: Array<{
    id: string;
    points: number;
    reason: string;
    createdAt: string;
  }>;
  returns: Array<{
    id: string;
    number: string;
    amount: number;
    reason?: string | null;
    createdAt: string;
    sale: { id: string; number: string };
  }>;
};

const defaultForm: CustomerForm = {
  fullName: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  notes: "",
  loyaltyPoints: "0",
  discountRate: "0",
  level: "Standard"
};

function CustomerModal({
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
  form: CustomerForm;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: <K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[820px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Clients</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 bg-black/[0.18] px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom complet"><Input value={form.fullName} onChange={(event) => onChange("fullName", event.target.value)} autoFocus /></Field>
            <Field label="Telephone"><Input value={form.phone} onChange={(event) => onChange("phone", event.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} /></Field>
            <Field label="Ville"><Input value={form.city} onChange={(event) => onChange("city", event.target.value)} /></Field>
            <Field label="Points fidelite"><Input type="number" value={form.loyaltyPoints} onChange={(event) => onChange("loyaltyPoints", event.target.value)} /></Field>
            <Field label="Remise %"><Input type="number" step="0.01" value={form.discountRate} onChange={(event) => onChange("discountRate", event.target.value)} /></Field>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_180px]">
            <Field label="Adresse"><Input value={form.address} onChange={(event) => onChange("address", event.target.value)} /></Field>
            <Field label="Niveau">
              <Select value={form.level} onChange={(event) => onChange("level", event.target.value)}>
                <option value="Standard">Standard</option>
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
                <option value="VIP">VIP</option>
              </Select>
            </Field>
          </div>

          <Field label="Notes"><Textarea rows={4} value={form.notes} onChange={(event) => onChange("notes", event.target.value)} /></Field>

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

function saleTone(status: CustomerDetail["sales"][number]["status"]) {
  if (status === "PAID") return "success" as const;
  if (status === "PARTIAL" || status === "UNPAID") return "warning" as const;
  return "danger" as const;
}

export function CustomerDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [item, setItem] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CustomerForm>(defaultForm);

  async function loadCustomer() {
    if (!id) {
      setError("Client introuvable.");
      setLoading(false);
      return;
    }

    const customer = await api<CustomerDetail>(`/customers/${id}`);
    setItem(customer);
    setForm({
      fullName: customer.fullName,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      city: customer.city ?? "",
      notes: customer.notes ?? "",
      loyaltyPoints: String(customer.loyaltyPoints),
      discountRate: String(customer.discountRate),
      level: customer.level ?? "Standard"
    });
  }

  useEffect(() => {
    loadCustomer()
      .catch((err) => setError(err instanceof Error ? err.message : "Impossible de charger la fiche client."))
      .finally(() => setLoading(false));
  }, [id]);

  const customerSince = useMemo(() => (item ? formatDate(item.createdAt) : "-"), [item]);

  function patch<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
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
      address: form.address || null,
      city: form.city || null,
      notes: form.notes || null
    };

    try {
      await api(`/customers/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
      await loadCustomer();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCustomer() {
    if (!item) return;
    if (!window.confirm("Supprimer ce client ?")) return;

    try {
      setError(null);
      await api(`/customers/${item.id}`, { method: "DELETE" });
      navigate("/gestion/clients");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  if (loading) return <LoadingBlock label="Chargement de la fiche client..." />;
  if (error || !item) {
    return <EmptyState title="Fiche client indisponible" description={error ?? "Impossible de trouver ce client."} action={<Link to="/gestion/clients" className="btn-secondary">Retour a la liste</Link>} />;
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Clients"
          title={item.fullName}
          description={`Actif depuis ${customerSince}`}
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => setModalOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Modifier
              </Button>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void removeCustomer()}>
                <Trash2 className="mr-2 h-4 w-4" />
                Supprimer
              </Button>
              <Link to="/gestion/clients" className="btn-secondary">Retour a la liste</Link>
            </>
          }
        />

        <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
          <SectionCard title="Fiche client">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Telephone</p><p className="mt-1 text-[13px] font-semibold text-white">{item.phone || "-"}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Email</p><p className="mt-1 text-[13px] font-semibold text-white">{item.email || "-"}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Ville</p><p className="mt-1 text-[13px] font-semibold text-white">{item.city || "-"}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Encours</p><p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(Number(item.balanceDue))}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Niveau</p><p className="mt-1 text-[13px] font-semibold text-white">{item.level}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Fidelite</p><p className="mt-1 text-[13px] font-semibold text-white">{formatNumber(item.loyaltyPoints)} pts - {Number(item.discountRate)}%</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3 md:col-span-2"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Adresse</p><p className="mt-1 text-[13px] font-semibold text-white">{item.address || "Aucune adresse"}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3 md:col-span-2"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Notes</p><p className="mt-1 text-[13px] leading-5 text-[#eadfd4]">{item.notes || "Aucune note."}</p></div>
            </div>
          </SectionCard>

          <SectionCard title="Synthese ventes" className="!p-4 md:!p-4.5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Tickets</p><p className="mt-1 text-[13px] font-semibold text-white">{formatNumber(item.purchasesCount)}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Montant achats</p><p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(item.totalSpent)}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Total paye</p><p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(item.totalPaid)}</p></div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Retours</p><p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(item.totalReturns)}</p></div>
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Historique des achats">
          {item.sales.length === 0 ? (
            <EmptyState title="Aucun achat" description="Ce client n'a encore aucun ticket enregistre." compact />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Magasin</th>
                    <th>Lignes</th>
                    <th>Montant</th>
                    <th>Paye</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {item.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td><div className="font-medium text-white">{sale.number}</div><div className="mt-1 text-xs text-[#b9aa9b]">{formatDate(sale.createdAt)}</div></td>
                      <td>{sale.warehouse.name}</td>
                      <td>{formatNumber(sale.items.length)}</td>
                      <td>{formatCurrency(Number(sale.totalAmount))}</td>
                      <td>{formatCurrency(Number(sale.paidAmount))}</td>
                      <td><Badge tone={saleTone(sale.status)}>{sale.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard title="Mouvements fidelite">
            {item.loyaltyTransactions.length === 0 ? (
              <EmptyState title="Aucun mouvement" description="Aucune operation fidelite n'est encore enregistree pour cette fiche." compact />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Points</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.loyaltyTransactions.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDate(entry.createdAt)}</td>
                        <td>{formatNumber(entry.points)}</td>
                        <td>{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Retours client">
            {item.returns.length === 0 ? (
              <EmptyState title="Aucun retour" description="Aucun retour client n'est encore enregistre pour cette fiche." compact />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Avoir</th>
                      <th>Ticket</th>
                      <th>Date</th>
                      <th>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.returns.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.number}</td>
                        <td>{entry.sale.number}</td>
                        <td>{formatDate(entry.createdAt)}</td>
                        <td>{formatCurrency(Number(entry.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <CustomerModal
        open={modalOpen}
        title="Modifier le client"
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