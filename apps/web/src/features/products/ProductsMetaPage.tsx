import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";
import { Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select } from "../../components/ui/primitives";

type EntityName = "types" | "categories" | "brands" | "transporters";

type MetaItem = { id: string; name: string };
type CategoryItem = MetaItem & { typeId?: string | null; type?: { id: string; name: string } | null };

type MetaPayload = {
  types: Array<MetaItem>;
  categories: Array<CategoryItem>;
  brands: Array<MetaItem>;
  units: Array<MetaItem>;
  warehouses: Array<MetaItem>;
  transporters: Array<MetaItem>;
};

const entityConfig = {
  types: { singular: "Type article", plural: "Types article", button: "Nouveau type" },
  categories: { singular: "Categorie", plural: "Categories", button: "Nouvelle categorie" },
  brands: { singular: "Marque", plural: "Marques", button: "Nouvelle marque" },
  transporters: { singular: "Transporteur", plural: "Transporteurs", button: "Nouveau transporteur" }
} as const;

function MetaModal({
  open,
  title,
  value,
  typeId,
  types,
  showTypeField,
  saving,
  error,
  onClose,
  onChange,
  onTypeChange,
  onSubmit
}: {
  open: boolean;
  title: string;
  value: string;
  typeId: string;
  types: Array<MetaItem>;
  showTypeField: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[640px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Referentiel</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 bg-black/[0.18] px-5 py-5 md:px-6" onSubmit={onSubmit}>
          {showTypeField ? (
            <Field label="Type d'article">
              <Select value={typeId} onChange={(event) => onTypeChange(event.target.value)}>
                <option value="">Choisir</option>
                {types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
          ) : null}

          <Field label="Nom">
            <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Saisir un nom" autoFocus />
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

export function ProductsMetaPage({ entity, title }: { entity: EntityName; title: string }) {
  const config = entityConfig[entity];
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setMeta(await api<MetaPayload>("/products/meta"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const current = useMemo(() => meta?.[entity] ?? [], [entity, meta]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return current;
    return current.filter((item) => item.name.toLowerCase().includes(query));
  }, [current, search]);

  function openCreateModal() {
    setEditingId(null);
    setName("");
    setSelectedTypeId("");
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(item: MetaItem | CategoryItem) {
    setEditingId(item.id);
    setName(item.name);
    setSelectedTypeId("typeId" in item ? item.typeId ?? "" : "");
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setName("");
    setSelectedTypeId("");
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const payload = entity === "categories" ? { name, typeId: selectedTypeId || null } : { name };
    try {
      if (editingId) {
        await api(`/products/meta/${entity}/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api(`/products/meta/${entity}`, { method: "POST", body: JSON.stringify(payload) });
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(`Supprimer ${config.singular.toLowerCase()} ?`)) return;
    try {
      setError(null);
      await api(`/products/meta/${entity}/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  if (loading && !meta) return <LoadingBlock label={`Chargement ${title.toLowerCase()}...`} />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow={entity === "types" ? "Gestion type d'article" : entity === "categories" ? "Gestion categorie" : entity === "brands" ? "Gestion marques" : "Gestion"}
          title={entity === "types" || entity === "categories" || entity === "brands" ? "" : title}
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void load()}>Actualiser</Button>
              <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>
                <Plus className="mr-2 h-4 w-4" />
                {config.button}
              </Button>
            </>
          }
        />

        <SectionCard
          title={entity === "types" || entity === "categories" || entity === "brands" ? "Liste" : `Liste des ${config.plural.toLowerCase()}`}
          actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder={`Rechercher ${config.singular.toLowerCase()}...`} value={search} onChange={(event) => setSearch(event.target.value)} />}
        >
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          {filtered.length === 0 ? (
            <EmptyState
              title={`Aucun ${config.singular.toLowerCase()}`}
              description={`Ajoute un premier ${config.singular.toLowerCase()} pour enrichir le referentiel.`}
              compact
              action={<Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>{config.button}</Button>}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    {entity === "categories" ? <th>Type</th> : null}
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="font-medium text-white">{item.name}</div>
                      </td>
                      {entity === "categories" ? <td>{((item as CategoryItem).type?.name) || "-"}</td> : null}
                      <td>
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" className="px-3 py-2 text-sm" onClick={() => openEditModal(item)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="secondary" className="px-3 py-2 text-sm" onClick={() => void remove(item.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <MetaModal
        open={modalOpen}
        title={editingId ? `Modifier ${config.singular.toLowerCase()}` : config.button}
        value={name}
        typeId={selectedTypeId}
        types={meta?.types ?? []}
        showTypeField={entity === "categories"}
        saving={saving}
        error={error}
        onClose={closeModal}
        onChange={setName}
        onTypeChange={setSelectedTypeId}
        onSubmit={submit}
      />
    </>
  );
}
