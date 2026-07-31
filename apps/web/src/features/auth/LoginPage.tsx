import { LockKeyhole, Mail, ScanLine, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "../../components/ui/primitives";
import { useAuth } from "../../providers/AuthProvider";

type LoginMode = "admin" | "manager" | "caissier";

function normalizeScanValue(value: string) {
  const trimmed = value.trim();
  if (/^MGR[-:]/i.test(trimmed)) {
    return { mode: "manager" as const, value: trimmed.replace(/^MGR[-:]/i, "") };
  }
  if (/^CSH[-:]/i.test(trimmed)) {
    return { mode: "caissier" as const, value: trimmed.replace(/^CSH[-:]/i, "") };
  }
  return { mode: null, value: trimmed };
}

export function LoginPage() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>("admin");
  const [email, setEmail] = useState("admin@gdt.local");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("Admin123!");
  const [code, setCode] = useState("");
  const [cashierScannedCode, setCashierScannedCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandAccessOpen, setCommandAccessOpen] = useState(false);
  const [commandIdentifier, setCommandIdentifier] = useState("");
  const [commandPassword, setCommandPassword] = useState("");
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const title = useMemo(() => {
    if (mode === "admin") return "Acces administrateur";
    if (mode === "manager") return "Acces manager boutique";
    return "Acces caisse rapide";
  }, [mode]);

  function appendCashierDigit(value: string) {
    setCashierScannedCode(false);
    setCode((current) => `${current}${value}`.slice(0, 12));
  }

  function clearCashierCode() {
    setCashierScannedCode(false);
    setCode("");
  }

  function backspaceCashierCode() {
    setCashierScannedCode(false);
    setCode((current) => current.slice(0, -1));
  }

  async function submitLogin() {
    setLoading(true);
    setError(null);

    try {
      if (mode === "manager" && username.includes("@")) {
        throw new Error("Pour le profil manager, utilise l'identifiant manager et non l'adresse mail.");
      }
      if (mode === "caissier" && code.trim().length < 4) {
        throw new Error("Le code confidentiel doit contenir au moins 4 chiffres.");
      }
      const user = await login(
        mode === "admin"
          ? { loginType: "admin", email, password }
          : mode === "manager"
            ? { loginType: "manager", username, password }
            : { loginType: "caissier", code }
      );
      const isCashier = (user.roles ?? []).some((role) => role.toLowerCase() === "caissier");
      navigate(isCashier ? "/pos" : "/", { replace: true });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Connexion impossible.";
      if (rawMessage.includes("\"path\":[\"code\"]") && rawMessage.includes("\"minimum\":4")) {
        setError("Le code confidentiel doit contenir au moins 4 chiffres.");
      } else {
        setError(rawMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitLogin();
  }

  async function submitCommandAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCommandLoading(true);
    setCommandError(null);

    try {
      const identifier = commandIdentifier.trim();
      if (!identifier || !commandPassword.trim()) {
        throw new Error("Remplis l'identifiant operateur et le mot de passe.");
      }

      const credentials = identifier.includes("@")
        ? { loginType: "admin" as const, email: identifier, password: commandPassword }
        : { loginType: "manager" as const, username: identifier, password: commandPassword };

      const user = await login(credentials, { scope: "command_validation" });
      if (!(user.permissions ?? []).includes("sales_manage")) {
        await logout();
        throw new Error("Cet operateur n'a pas l'acces requis pour valider les commandes.");
      }

      setCommandAccessOpen(false);
      navigate("/commandes/non-validee", { replace: true });
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : "Identification impossible.");
    } finally {
      setCommandLoading(false);
    }
  }

  useEffect(() => {
    if (mode !== "caissier" || !cashierScannedCode || loading) return;
    if (code.trim().length < 4) return;

    const timeout = window.setTimeout(() => {
      void submitLogin();
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [cashierScannedCode, code, loading, mode]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.15fr_.85fr]">
        <section className="card-shell hidden p-8 lg:block xl:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-200/80">Galerie des Tanneurs</p>
          <h1 className="mt-4 max-w-xl text-[42px] font-semibold leading-tight text-white">
            Bienvenue dans votre espace de gestion.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-8 text-[#ccbeaf]">
            Bienvenue.
            <br />
            <br />
            Veuillez vous identifier pour acceder a votre espace de travail. Chaque profil beneficie d'un acces securise adapte a ses fonctions afin d'assurer une gestion fiable des ventes, des stocks et des operations quotidiennes.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4">
            <button
              type="button"
              className="rounded-[22px] border border-orange-300/20 bg-gradient-to-br from-orange-400/12 to-orange-500/8 p-4 text-left transition hover:border-orange-300/35 hover:bg-orange-400/10"
              onClick={() => {
                setCommandAccessOpen(true);
                setCommandError(null);
              }}
            >
              <p className="text-sm font-semibold text-white">Gestion commandes</p>
            </button>
            {[
              { label: "Manager", detail: "Utilisateur + mot de passe" },
              { label: "Caissier", detail: "Code confidentiel" }
            ].map((item) => (
              <div key={item.label} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white">{item.label}</p>
                <p className="mt-2 text-sm text-[#d7c7b9]">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card-shell p-6 md:p-8">
          <div className="mx-auto max-w-md">
            <div className="mb-8 flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[20px] bg-gradient-to-br from-[#ffb15c] to-[#ff7a00] p-2">
                <img
                  src="/logo-gdt.jpg"
                  alt="Logo GDT"
                  className="h-full w-full object-contain mix-blend-multiply contrast-125"
                />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">GDT Suite</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">{title}</h2>
              </div>
            </div>

            <div className="mb-6 grid grid-cols-3 gap-2 rounded-[22px] border border-white/10 bg-black/20 p-2">
              {[
                { key: "admin" as const, label: "Admin" },
                { key: "manager" as const, label: "Manager" },
                { key: "caissier" as const, label: "Caissier" }
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`rounded-2xl px-3 py-3 text-sm font-semibold transition ${mode === item.key ? "bg-orange-300 text-black" : "text-[#eadccf] hover:bg-white/5"}`}
                  onClick={() => {
                    setMode(item.key);
                    setError(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              {mode === "admin" ? (
                <>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#eadccf]">Adresse mail</span>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#bba995]" />
                      <Input className="pl-11" value={email} onChange={(event) => setEmail(event.target.value)} />
                    </div>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#eadccf]">Mot de passe</span>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#bba995]" />
                      <Input className="pl-11" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                    </div>
                  </label>
                </>
              ) : null}

              {mode === "manager" ? (
                <>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#eadccf]">Identifiant manager</span>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#bba995]" />
                      <Input
                        className="pl-11"
                        value={username}
                        onChange={(event) => {
                          const parsed = normalizeScanValue(event.target.value);
                          if (parsed.mode === "manager") {
                            setMode("manager");
                            setUsername(parsed.value);
                            return;
                          }
                          setUsername(event.target.value);
                        }}
                        placeholder="Scanner ou saisir l'identifiant manager"
                      />
                    </div>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#eadccf]">Mot de passe</span>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#bba995]" />
                      <Input className="pl-11" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                    </div>
                  </label>
                </>
              ) : null}

              {mode === "caissier" ? (
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#eadccf]">Code confidentiel</span>
                    <div className="relative max-w-[280px]">
                      <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#bba995]" />
                      <Input
                        className="pl-11"
                        value={code}
                  onChange={(event) => {
                    const parsed = normalizeScanValue(event.target.value);
                    if (parsed.mode === "caissier") {
                      setMode("caissier");
                      setCode(parsed.value);
                      setCashierScannedCode(true);
                      return;
                    }
                    setCashierScannedCode(false);
                    setCode(event.target.value.replace(/\D+/g, "").slice(0, 12));
                  }}
                        placeholder="Scanner la carte ou saisir le code"
                      />
                    </div>
                  </label>

                  <div className="max-w-[280px] rounded-[22px] border border-white/10 bg-black/20 p-3">
                    <div className="grid grid-cols-3 gap-2">
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Effacer", "0", "Corriger"].map((key) => (
                        <button
                          key={key}
                          type="button"
                          className={`rounded-[16px] border px-2 py-2.5 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition active:scale-[0.98] ${
                            key === "Effacer"
                              ? "border-rose-300/20 bg-gradient-to-b from-rose-400/15 to-rose-500/10 text-rose-100 hover:from-rose-400/20 hover:to-rose-500/15"
                              : key === "Corriger"
                                ? "border-white/10 bg-gradient-to-b from-white/10 to-white/5 text-[#efe2d4] hover:from-white/15 hover:to-white/10"
                                : "border-white/10 bg-gradient-to-b from-[#2c2018] to-[#1a120d] text-white hover:border-orange-300/30 hover:from-[#3a281d] hover:to-[#20160f]"
                          }`}
                          onClick={() => {
                            if (key === "Effacer") {
                              clearCashierCode();
                              return;
                            }
                            if (key === "Corriger") {
                              backspaceCashierCode();
                              return;
                            }
                            appendCashierDigit(key);
                          }}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "Connexion..." : mode === "caissier" ? "Ouvrir la caisse" : "Entrer dans la plateforme"}
              </Button>
            </form>
          </div>
        </section>
      </div>

      {commandAccessOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-[520px] rounded-[28px] border border-orange-300/20 bg-[#17110c] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/80">Gestion commandes</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">Identification operateur</h3>
                <p className="mt-2 text-sm leading-6 text-[#cfbfaf]">
                  Cet acces ouvre uniquement la page <strong className="text-white">Commandes non validees</strong> pour valider les commandes.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 p-2 text-[#d8c8b8] transition hover:bg-white/5"
                onClick={() => setCommandAccessOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-5" onSubmit={submitCommandAccess}>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[#eadccf]">Identifiant operateur</span>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#bba995]" />
                  <Input
                    className="pl-11"
                    value={commandIdentifier}
                    onChange={(event) => setCommandIdentifier(event.target.value)}
                    placeholder="Identifiant operateur"
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[#eadccf]">Mot de passe</span>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#bba995]" />
                  <Input
                    className="pl-11"
                    type="password"
                    value={commandPassword}
                    onChange={(event) => setCommandPassword(event.target.value)}
                  />
                </div>
              </label>

              {commandError ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{commandError}</div> : null}

              <div className="flex justify-end gap-3">
                <Button type="button" variant="secondary" className="!bg-white/5 !text-white" onClick={() => setCommandAccessOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={commandLoading}>
                  {commandLoading ? "Identification..." : "Ouvrir commandes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
