import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Field, Input, LoadingBlock, PageHeader, SectionCard, Select, StatCard } from "../../components/ui/primitives";

type Permission = { id: string; name: string; label: string };
type Role = { id: string; name: string; label: string; rolePermissions: Array<{ permission: Permission }> };
type Warehouse = { id: string; name: string; code: string; type: string };
type User = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  updatedAt?: string;
  defaultWarehouseId?: string | null;
  loginMode?: string;
  loginUsername?: string;
  pinCode?: string;
};
type UsersPayload = { users: User[]; roles: Role[]; permissions: Permission[]; warehouses: Warehouse[] };

type UserFormState = {
  fullName: string;
  email: string;
  password: string;
  roleNames: string[];
  isActive: boolean;
  defaultWarehouseId: string;
  loginUsername: string;
  pinCode: string;
};

type UserTab = "admins" | "managers" | "cashiers" | "operators";

function roleForTab(tab: UserTab) {
  if (tab === "admins") return "admin";
  if (tab === "managers") return "manager";
  if (tab === "cashiers") return "caissier";
  return "operateur_commandes";
}

function defaultForm(tab: UserTab = "operators"): UserFormState {
  return {
    fullName: "",
    email: "",
    password: "ChangeMe123!",
    roleNames: [roleForTab(tab)],
    isActive: true,
    defaultWarehouseId: "",
    loginUsername: "",
    pinCode: ""
  };
}

function normalizeRoleLabel(role: string) {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  if (role === "operateur_commandes") return "Operateur commandes";
  if (role === "caissier") return "Caissier";
  return role;
}

export function UsersPage() {
  const [data, setData] = useState<UsersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userTab, setUserTab] = useState<UserTab>("operators");
  const [form, setForm] = useState<UserFormState>(defaultForm("operators"));
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  function extractFriendlyPasswordMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error ?? "");
    if (raw.includes("\"path\":[\"password\"]") && raw.includes("\"minimum\":6")) {
      return "Le mot de passe doit contenir au moins 6 caracteres.";
    }
    return raw || "Operation impossible.";
  }

  async function load() {
    setLoading(true);
    try {
      setData(await api<UsersPayload>("/users"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => ({
    users: data?.users.length ?? 0,
    active: data?.users.filter((user) => user.isActive).length ?? 0,
    roles: data?.roles.length ?? 0,
    permissions: data?.permissions.length ?? 0
  }), [data]);
  const adminUsers = useMemo(() => data?.users.filter((user) => user.roles.includes("admin")) ?? [], [data]);
  const managerUsers = useMemo(() => data?.users.filter((user) => user.roles.includes("manager")) ?? [], [data]);
  const cashierUsers = useMemo(() => data?.users.filter((user) => user.roles.includes("caissier")) ?? [], [data]);
  const commandOperators = useMemo(() => data?.users.filter((user) => user.roles.includes("operateur_commandes")) ?? [], [data]);
  const currentTabUsers = useMemo(() => {
    if (userTab === "admins") return adminUsers;
    if (userTab === "managers") return managerUsers;
    if (userTab === "cashiers") return cashierUsers;
    return commandOperators;
  }, [adminUsers, cashierUsers, commandOperators, managerUsers, userTab]);
  const currentTabLabel = userTab === "admins"
    ? "Admins"
    : userTab === "managers"
      ? "Managers"
      : userTab === "cashiers"
        ? "Caissiers"
        : "Operateurs";
  const currentTabDescription = userTab === "admins"
    ? "Comptes administrateurs de la plateforme."
    : userTab === "managers"
      ? "Comptes managers boutiques."
      : userTab === "cashiers"
        ? "Comptes caissiers pour l'acces caisse."
        : "Comptes dedies au portail Gestion commandes.";

  function resetForm() {
    setEditingUserId(null);
    setForm(defaultForm(userTab));
  }

  function startEdit(user: User) {
    setEditingUserId(user.id);
    setForm({
      fullName: user.fullName,
      email: user.email,
      password: "",
      roleNames: user.roles,
      isActive: user.isActive,
      defaultWarehouseId: user.defaultWarehouseId || "",
      loginUsername: user.loginUsername || "",
      pinCode: user.pinCode || ""
    });
    setMessage(null);
  }

  useEffect(() => {
    if (!editingUserId) {
      setForm(defaultForm(userTab));
    }
  }, [editingUserId, userTab]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUserId && form.password.trim().length < 6) {
      setMessage("Le mot de passe est obligatoire et doit contenir au moins 6 caracteres.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        ...form,
        defaultWarehouseId: form.defaultWarehouseId || null
      };
      if (editingUserId) {
        await api(`/users/${editingUserId}`, { method: "PUT", body: JSON.stringify(payload) });
        setMessage("Operateur mis a jour.");
      } else {
        await api("/users", { method: "POST", body: JSON.stringify(payload) });
        setMessage("Operateur cree.");
      }
      resetForm();
      await load();
    } catch (err) {
      setMessage(extractFriendlyPasswordMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: User) {
    setActionLoadingId(user.id);
    setMessage(null);
    try {
      await api(`/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({
          fullName: user.fullName,
          email: user.email,
          password: "",
          roleNames: user.roles,
          isActive: !user.isActive,
          defaultWarehouseId: user.defaultWarehouseId || null,
          loginUsername: user.loginUsername || "",
          pinCode: user.pinCode || ""
        })
      });
      setMessage(!user.isActive ? "Operateur reactive." : "Operateur desactive.");
      await load();
    } catch (err) {
      setMessage(extractFriendlyPasswordMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function removeUser(user: User) {
    setActionLoadingId(user.id);
    setMessage(null);
    try {
      await api(`/users/${user.id}`, { method: "DELETE" });
      setMessage("Operateur supprime.");
      if (editingUserId === user.id) {
        resetForm();
      }
      await load();
    } catch (err) {
      setMessage(extractFriendlyPasswordMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  if (loading || !data) return <LoadingBlock label="Chargement des utilisateurs..." />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Administration" title="Utilisateurs & permissions" description="Gestion securisee des comptes, des profils et des acces commandes." />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Utilisateurs" value={stats.users} hint="Comptes crees" accent="orange" />
        <StatCard label="Actifs" value={stats.active} hint="Acces ouverts" accent="green" />
        <StatCard label="Roles" value={stats.roles} hint="Profils metier" accent="blue" />
        <StatCard label="Permissions" value={stats.permissions} hint="Niveau granulaire" accent="orange" />
      </div>

      <SectionCard
        title="Organisation des comptes"
        description="Chaque profil est maintenant separe dans son propre onglet pour eviter tout melange."
      >
        <div className="flex flex-wrap gap-2">
          {[
            { id: "admins" as const, label: "Admins" },
            { id: "managers" as const, label: "Managers" },
            { id: "cashiers" as const, label: "Caissiers" },
            { id: "operators" as const, label: "Operateurs" }
          ].map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={userTab === tab.id ? "primary" : "secondary"}
              className={userTab === tab.id ? "!h-9 !px-4 !text-[12px]" : "!h-9 !px-4 !bg-white/5 !text-[12px] !text-white"}
              onClick={() => setUserTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <SectionCard
          title={editingUserId ? `Modifier ${currentTabLabel.slice(0, -1).toLowerCase()}` : `Ajouter ${currentTabLabel.slice(0, -1).toLowerCase()}`}
          description={currentTabDescription}
        >
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nom complet">
                <Input value={form.fullName} onChange={(e) => setForm((current) => ({ ...current, fullName: e.target.value }))} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} />
              </Field>
              <Field label="Mot de passe" hint={editingUserId ? "Laisse vide si tu ne veux pas le changer." : "6 caracteres minimum"}>
                <Input type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} />
              </Field>
              <Field label="Boutique par defaut">
                <Select value={form.defaultWarehouseId} onChange={(e) => setForm((current) => ({ ...current, defaultWarehouseId: e.target.value }))}>
                  <option value="">Aucune boutique</option>
                  {data.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {(userTab === "managers" || userTab === "operators") ? (
                <Field label={userTab === "operators" ? "Identifiant operateur" : "Identifiant manager"} hint="Utilise pour la connexion a cet espace.">
                  <Input value={form.loginUsername} onChange={(e) => setForm((current) => ({ ...current, loginUsername: e.target.value }))} />
                </Field>
              ) : null}
              {userTab === "cashiers" ? (
                <Field label="Code confidentiel" hint="Code utilise pour l'ouverture de la session caisse.">
                  <Input value={form.pinCode} onChange={(e) => setForm((current) => ({ ...current, pinCode: e.target.value }))} />
                </Field>
              ) : null}
              <Field label="Profil">
                <div className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3 text-sm text-[#eadccf]">
                  {currentTabLabel.slice(0, -1)}
                </div>
              </Field>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-[#eadccf]">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((current) => ({ ...current, isActive: e.target.checked }))} /> Actif
            </label>

            <div className="flex flex-wrap gap-3">
              <Button type="submit">{saving ? "Enregistrement..." : editingUserId ? "Mettre a jour" : `Creer ${currentTabLabel.slice(0, -1).toLowerCase()}`}</Button>
              {editingUserId ? (
                <Button type="button" variant="secondary" className="!bg-white/5 !text-white" onClick={resetForm}>
                  Annuler
                </Button>
              ) : null}
            </div>
            {message ? <div className="text-sm text-[#e4d8cb]">{message}</div> : null}
          </form>
        </SectionCard>

        <SectionCard
          title={`Liste ${currentTabLabel.toLowerCase()}`}
          description={`Seuls les ${currentTabLabel.toLowerCase()} apparaissent dans cette liste.`}
        >
          <div className="space-y-4">
            {currentTabUsers.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-white/10 bg-black/10 p-6 text-sm text-[#c9bbad]">
                Aucun compte dans l'onglet {currentTabLabel.toLowerCase()}.
              </div>
            ) : (
              currentTabUsers.map((user) => (
                <div key={user.id} className="rounded-[24px] border border-white/10 bg-black/20 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{user.fullName}</h3>
                      <p className="mt-1 text-sm text-[#baa999]">{user.email}</p>
                    </div>
                    <Badge tone={user.isActive ? "success" : "danger"}>{user.isActive ? "Actif" : "Inactif"}</Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ccbcae]">Roles</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {user.roles.map((role) => (
                          <span key={`${user.id}-${role}`} className="badge">
                            {normalizeRoleLabel(role)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ccbcae]">Acces</p>
                      <p className="mt-2 text-sm text-white">
                        {user.loginMode === "manager"
                          ? `Identifiant : ${user.loginUsername || "-"}`
                          : user.loginMode === "caissier"
                            ? `Code : ${user.pinCode || "-"}`
                            : "Connexion par email"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" className="!h-9 !px-3 !text-[12px]" onClick={() => startEdit(user)}>
                      Modifier
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!h-9 !px-3 !text-[12px] !bg-white/5 !text-white"
                      disabled={actionLoadingId === user.id}
                      onClick={() => void toggleActive(user)}
                    >
                      {user.isActive ? "Desactiver" : "Activer"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!h-9 !px-3 !text-[12px] !bg-rose-500/10 !text-rose-100"
                      disabled={actionLoadingId === user.id}
                      onClick={() => void removeUser(user)}
                    >
                      Supprimer
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
