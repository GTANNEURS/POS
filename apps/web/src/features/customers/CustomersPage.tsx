import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { formatCurrency, formatNumber } from "../../lib/format";
import { Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select, Textarea } from "../../components/ui/primitives";

type Customer = {
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
  purchasesCount: number;
  sales: Array<{ totalAmount: number }>;
};

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

export function CustomersPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Customer[]>([]);
  const [form, setForm] = useState<CustomerForm>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function load(searchValue = "") {
    setLoading(true);
    setError(null);
    try {
      setItems(await api<Customer[]>(`/customers${searchValue ? `?search=${encodeURIComponent(searchValue)}` : ""}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function patch<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateModal() {
    setForm(defaultForm);
    setError(null);
    setModalOpen(true);
  }

  function openDetails(id: string) {
    navigate(`/gestion/clients/${id}`);
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails(id);
    }
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setError(null);
    setForm(defaultForm);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      await api("/customers", { method: "POST", body: JSON.stringify(payload) });
      closeModal();
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && items.length === 0) return <LoadingBlock label="Chargement des clients..." />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Gestion des Clients"
          title=""
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void load(search)}>Actualiser</Button>
              <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>
                <Plus className="mr-2 h-4 w-4" />
                Nouveau client
              </Button>
            </>
          }
        />

        <SectionCard
          title="Liste"
          actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher un client..." value={search} onChange={(event) => { const value = event.target.value; setSearch(value); void load(value); }} />}
        >
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          {items.length === 0 ? (
            <EmptyState
              title="Aucun client"
              description="Ajoute un premier client pour activer le CRM et la fidelite."
              compact
              action={<Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>Nouveau client</Button>}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Contact</th>
                    <th>Fidelite</th>
                    <th>Achats</th>
                    <th>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((customer) => {
                    const revenue = customer.sales.reduce((sum, sale) => sum + Number(sale.totalAmount), 0);
                    return (
                      <tr
                        key={customer.id}
                        className="cursor-pointer"
                        tabIndex={0}
                        onClick={() => openDetails(customer.id)}
                        onKeyDown={(event) => handleRowKeyDown(event, customer.id)}
                      >
                        <td>
                          <div className="font-medium text-white">{customer.fullName}</div>
                          <div className="mt-1 text-xs text-[#b9aa9b]">{customer.address || customer.city || "Aucune precision"}</div>
                        </td>
                        <td>
                          <div>{customer.phone || "-"}</div>
                          <div className="mt-1 text-xs text-[#b9aa9b]">{customer.email || "-"}</div>
                        </td>
                        <td>
                          <div>{formatNumber(customer.loyaltyPoints)} pts</div>
                          <div className="mt-1 text-xs text-[#b9aa9b]">{customer.level} - {Number(customer.discountRate)}%</div>
                        </td>
                        <td>{formatNumber(customer.purchasesCount)}</td>
                        <td>{formatCurrency(revenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <CustomerModal
        open={modalOpen}
        title="Nouveau client"
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