import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard } from "../../components/ui/primitives";
import { api } from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/format";

type TransporterForm = {
  name: string;
  phone: string;
  email: string;
};

type TransporterDetail = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  createdAt: string;
  monthlyShippingFees: number;
  ticketsCount: number;
  sales: Array<{
    id: string;
    number: string;
    shippingFee: number;
    totalAmount: number;
    paidAmount: number;
    createdAt: string;
    customer?: { fullName: string } | null;
    warehouse: { id: string; name: string };
    payments: Array<{ amount: number; method: string }>;
  }>;
};

const defaultForm: TransporterForm = {
  name: "",
  phone: "",
  email: ""
};

function TransporterModal({
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
  form: TransporterForm;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: <K extends keyof TransporterForm>(key: K, value: TransporterForm[K]) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[700px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Transporteurs</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 bg-black/[0.18] px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <Field label="Nom"><Input value={form.name} onChange={(event) => onChange("name", event.target.value)} autoFocus /></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Telephone"><Input value={form.phone} onChange={(event) => onChange("phone", event.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} /></Field>
          </div>

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

export function TransporterDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [item, setItem] = useState<TransporterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TransporterForm>(defaultForm);

  async function loadTransporter() {
    if (!id) {
      setError("Transporteur introuvable.");
      setLoading(false);
      return;
    }

    const transporter = await api<TransporterDetail>(`/transporters/${id}`);
    setItem(transporter);
    setForm({
      name: transporter.name,
      phone: transporter.phone ?? "",
      email: transporter.email ?? ""
    });
  }

  useEffect(() => {
    loadTransporter()
      .catch((err) => setError(err instanceof Error ? err.message : "Impossible de charger la fiche transporteur."))
      .finally(() => setLoading(false));
  }, [id]);

  const transporterSince = useMemo(() => (item ? formatDate(item.createdAt) : "-"), [item]);

  function patch<K extends keyof TransporterForm>(key: K, value: TransporterForm[K]) {
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
      email: form.email || null
    };

    try {
      await api(`/transporters/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
      await loadTransporter();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function removeTransporter() {
    if (!item) return;
    if (!window.confirm("Supprimer ce transporteur ?")) return;

    try {
      setError(null);
      await api(`/transporters/${item.id}`, { method: "DELETE" });
      navigate("/gestion/transporteurs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  if (loading) return <LoadingBlock label="Chargement de la fiche transporteur..." />;
  if (error || !item) {
    return <EmptyState title="Fiche transporteur indisponible" description={error ?? "Impossible de trouver ce transporteur."} action={<Link to="/gestion/transporteurs" className="btn-secondary">Retour a la liste</Link>} />;
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Transporteurs"
          title={item.name}
          description={`Actif depuis ${transporterSince}`}
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => setModalOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Modifier
              </Button>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void removeTransporter()}>
                <Trash2 className="mr-2 h-4 w-4" />
                Supprimer
              </Button>
              <Link to="/gestion/transporteurs" className="btn-secondary">Retour a la liste</Link>
            </>
          }
        />

        <SectionCard title="Fiche transporteur">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Telephone</p><p className="mt-1 text-[13px] font-semibold text-white">{item.phone || "-"}</p></div>
            <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Email</p><p className="mt-1 text-[13px] font-semibold text-white">{item.email || "-"}</p></div>
            <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Tickets</p><p className="mt-1 text-[13px] font-semibold text-white">{item.ticketsCount}</p></div>
            <div className="rounded-[18px] border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-[#bdaa98]">Frais de port collecte</p><p className="mt-1 text-[13px] font-semibold text-white">{formatCurrency(item.monthlyShippingFees)}</p></div>
          </div>
        </SectionCard>

        <SectionCard title="Tickets avec frais de port">
          {item.sales.length === 0 ? (
            <EmptyState title="Aucun ticket" description="Aucun ticket avec frais de port n'est encore lie a ce transporteur." compact />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Boutique</th>
                    <th>Client</th>
                    <th>Frais de port</th>
                    <th>Total</th>
                    <th>Paiement</th>
                  </tr>
                </thead>
                <tbody>
                  {item.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td><div className="font-medium text-white">{sale.number}</div><div className="mt-1 text-xs text-[#b9aa9b]">{formatDate(sale.createdAt)}</div></td>
                      <td>{sale.warehouse.name}</td>
                      <td>{sale.customer?.fullName ?? "Client comptoir"}</td>
                      <td>{formatCurrency(Number(sale.shippingFee))}</td>
                      <td>{formatCurrency(Number(sale.totalAmount))}</td>
                      <td>{sale.payments.map((payment) => payment.method).join(" - ") || formatCurrency(Number(sale.paidAmount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <TransporterModal
        open={modalOpen}
        title="Modifier le transporteur"
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