import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard } from "../../components/ui/primitives";

type Transporter = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  createdAt: string;
};

type TransporterForm = {
  name: string;
  phone: string;
  email: string;
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

export function TransportersPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Transporter[]>([]);
  const [form, setForm] = useState<TransporterForm>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function load(searchValue = "") {
    setLoading(true);
    setError(null);
    try {
      setItems(await api<Transporter[]>(`/transporters${searchValue ? `?search=${encodeURIComponent(searchValue)}` : ""}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function patch<K extends keyof TransporterForm>(key: K, value: TransporterForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateModal() {
    setForm(defaultForm);
    setError(null);
    setModalOpen(true);
  }

  function openDetails(id: string) {
    navigate(`/gestion/transporteurs/${id}`);
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
      email: form.email || null
    };

    try {
      await api("/transporters", { method: "POST", body: JSON.stringify(payload) });
      closeModal();
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && items.length === 0) return <LoadingBlock label="Chargement des transporteurs..." />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Gestion des Transporteurs"
          title=""
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void load(search)}>Actualiser</Button>
              <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>
                <Plus className="mr-2 h-4 w-4" />
                Nouveau transporteur
              </Button>
            </>
          }
        />

        <SectionCard
          title="Liste"
          actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher un transporteur..." value={search} onChange={(event) => { const value = event.target.value; setSearch(value); void load(value); }} />}
        >
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          {items.length === 0 ? (
            <EmptyState title="Aucun transporteur" description="Ajoute un premier transporteur pour structurer les livraisons." compact action={<Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>Nouveau transporteur</Button>} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Transporteur</th>
                    <th>Telephone</th>
                    <th>Email</th>
                    <th>Creation</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((transporter) => (
                    <tr
                      key={transporter.id}
                      className="cursor-pointer"
                      tabIndex={0}
                      onClick={() => openDetails(transporter.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, transporter.id)}
                    >
                      <td><div className="font-medium text-white">{transporter.name}</div></td>
                      <td>{transporter.phone || "-"}</td>
                      <td>{transporter.email || "-"}</td>
                      <td>{formatDate(transporter.createdAt)}</td>
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
        title="Nouveau transporteur"
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