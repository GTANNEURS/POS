import { Component, Suspense, lazy, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Button, LoadingBlock } from "../components/ui/primitives";
import { getOfflineQueueCount, syncOfflineQueue } from "../lib/offline";
import { AuthProvider, useAuth } from "../providers/AuthProvider";

const LoginPage = lazy(() => import("../features/auth/LoginPage").then((module) => ({ default: module.LoginPage })));
const CustomerDetailPage = lazy(() => import("../features/customers/CustomerDetailPage").then((module) => ({ default: module.CustomerDetailPage })));
const CustomersPage = lazy(() => import("../features/customers/CustomersPage").then((module) => ({ default: module.CustomersPage })));
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const InventorySuitePage = lazy(() => import("../features/inventory/InventorySuitePage").then((module) => ({ default: module.InventorySuitePage })));
const PosPage = lazy(() => import("../features/pos/PosPage").then((module) => ({ default: module.PosPage })));
const ProductDetailPage = lazy(() => import("../features/products/ProductDetailPage").then((module) => ({ default: module.ProductDetailPage })));
const ProductsMetaPage = lazy(() => import("../features/products/ProductsMetaPage").then((module) => ({ default: module.ProductsMetaPage })));
const ProductsPage = lazy(() => import("../features/products/ProductsPage").then((module) => ({ default: module.ProductsPage })));
const GoodsReceiptsPage = lazy(() => import("../features/purchases/PurchasesPages").then((module) => ({ default: module.GoodsReceiptsPage })));
const PurchaseOrdersPage = lazy(() => import("../features/purchases/PurchasesPages").then((module) => ({ default: module.PurchaseOrdersPage })));
const SupplierCreditNotesPage = lazy(() => import("../features/purchases/PurchasesPages").then((module) => ({ default: module.SupplierCreditNotesPage })));
const SupplierInvoicesPage = lazy(() => import("../features/purchases/PurchasesPages").then((module) => ({ default: module.SupplierInvoicesPage })));
const PurchaseOrderDetailPage = lazy(() => import("../features/purchases/PurchaseOrderDetailPage").then((module) => ({ default: module.PurchaseOrderDetailPage })));
const ReportsPage = lazy(() => import("../features/reports/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const SalesPage = lazy(() => import("../features/sales/SalesPage").then((module) => ({ default: module.SalesPage })));
const CustomerCreditNotesPage = lazy(() => import("../features/sales/SalesDocumentsPages").then((module) => ({ default: module.CustomerCreditNotesPage })));
const CustomerInvoicesPage = lazy(() => import("../features/sales/SalesDocumentsPages").then((module) => ({ default: module.CustomerInvoicesPage })));
const DeliveryNotesPage = lazy(() => import("../features/sales/SalesDocumentsPages").then((module) => ({ default: module.DeliveryNotesPage })));
const SalesQuotesPage = lazy(() => import("../features/sales/SalesDocumentsPages").then((module) => ({ default: module.SalesQuotesPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const SupplierDetailPage = lazy(() => import("../features/suppliers/SupplierDetailPage").then((module) => ({ default: module.SupplierDetailPage })));
const SuppliersPage = lazy(() => import("../features/suppliers/SuppliersPage").then((module) => ({ default: module.SuppliersPage })));
const TransporterDetailPage = lazy(() => import("../features/transporters/TransporterDetailPage").then((module) => ({ default: module.TransporterDetailPage })));
const TransportersPage = lazy(() => import("../features/transporters/TransportersPage").then((module) => ({ default: module.TransportersPage })));
const UsersPage = lazy(() => import("../features/users/UsersPage").then((module) => ({ default: module.UsersPage })));

function hasCashierRole(roles: string[] = []) {
  return roles.some((role) => role.toLowerCase() === "caissier");
}

function RouteLoader() {
  return <LoadingBlock label="Chargement de la page..." />;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || "Une erreur inattendue a bloque l'ouverture de l'application."
    };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error("App runtime error:", error);
  }

  resetAppState = () => {
    localStorage.removeItem("gdt_access_token");
    window.location.assign("/login");
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#120c08] px-6 py-10 text-white">
          <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
            <div className="w-full rounded-[28px] border border-orange-300/20 bg-[#1b130d]/95 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-300/80">Ouverture de session</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">L'ecran s'est bloque au chargement</h1>
              <p className="mt-3 text-sm text-[#d0c0b0]">
                {this.state.message || "Une erreur bloque l'ouverture de cette page. La session va etre reinitialisee proprement."}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button className="px-6 py-3" onClick={this.resetAppState}>
                  Retour a la connexion
                </Button>
                <Button variant="secondary" className="px-6 py-3" onClick={() => window.location.reload()}>
                  Recharger la page
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function ProtectedApp() {
  const { ready, token, user, sessionScope } = useAuth();

  if (!ready) {
    return <LoadingBlock label="Initialisation de la plateforme..." />;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (hasCashierRole(user?.roles ?? [])) {
    return (
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/pos" element={<PosPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    );
  }

  if (sessionScope === "command_validation") {
    return (
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/commandes" element={<Navigate to="/commandes/non-validee" replace />} />
          <Route path="/commandes/non-validee" element={<SalesPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/commandes/non-validee" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/gestion/produits" element={<ProductsPage />} />
        <Route path="/gestion/produits/:id" element={<ProductDetailPage />} />
        <Route path="/gestion/produits/types" element={<ProductsMetaPage entity="types" title="Type article" />} />
        <Route path="/gestion/produits/categories" element={<ProductsMetaPage entity="categories" title="Categorie article" />} />
        <Route path="/gestion/fournisseurs" element={<SuppliersPage />} />
        <Route path="/gestion/fournisseurs/:id" element={<SupplierDetailPage />} />
        <Route path="/gestion/clients" element={<CustomersPage />} />
        <Route path="/gestion/clients/:id" element={<CustomerDetailPage />} />
        <Route path="/gestion/transporteurs" element={<TransportersPage />} />
        <Route path="/gestion/transporteurs/:id" element={<TransporterDetailPage />} />
        <Route path="/achat/bon-de-commande" element={<PurchaseOrdersPage />} />
        <Route path="/achat/bon-de-commande/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="/achat/bon-de-reception" element={<GoodsReceiptsPage />} />
        <Route path="/achat/avoir-fournisseur" element={<SupplierCreditNotesPage />} />
        <Route path="/achat/facture-fournisseur" element={<SupplierInvoicesPage />} />
        <Route path="/stock" element={<InventorySuitePage />} />
        <Route path="/commandes" element={<Navigate to="/commandes/non-validee" replace />} />
        <Route path="/commandes/non-validee" element={<SalesPage />} />
        <Route path="/commandes/validee" element={<SalesPage />} />
        <Route path="/commandes/sacs" element={<SalesPage />} />
        <Route path="/commandes/vetements" element={<SalesPage />} />
        <Route path="/commandes/chaussures" element={<SalesPage />} />
        <Route path="/commandes/iraqi" element={<SalesPage />} />
        <Route path="/commandes/mobiliers" element={<SalesPage />} />
        <Route path="/commandes/verifier" element={<SalesPage />} />
        <Route path="/ventes" element={<Navigate to="/ventes/devis" replace />} />
        <Route path="/ventes/devis" element={<SalesQuotesPage />} />
        <Route path="/ventes/bon-de-livraison" element={<DeliveryNotesPage />} />
        <Route path="/ventes/avoir-client" element={<CustomerCreditNotesPage />} />
        <Route path="/ventes/facture-client" element={<CustomerInvoicesPage />} />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/rapports" element={<ReportsPage />} />
        <Route path="/utilisateurs" element={<UsersPage />} />
        <Route path="/parametres" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PublicApp() {
  const { ready, token, user, sessionScope } = useAuth();

  if (!ready) {
    return <LoadingBlock label="Chargement de la session..." />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={token ? <Navigate to={hasCashierRole(user?.roles ?? []) ? "/pos" : sessionScope === "command_validation" ? "/commandes/non-validee" : "/"} replace /> : <LoginPage />}
      />
      <Route path="*" element={<ProtectedApp />} />
    </Routes>
  );
}

function OfflineSyncBadge() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(() => getOfflineQueueCount());
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(0);
  const syncingRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function runSync() {
      setOnline(navigator.onLine);
      setPending(getOfflineQueueCount());
      if (!navigator.onLine || getOfflineQueueCount() === 0 || syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      const result = await syncOfflineQueue().catch(() => ({ synced: 0, pending: getOfflineQueueCount() }));
      if (!active) return;
      setPending(result.pending);
      if (result.synced > 0) setLastSynced(result.synced);
      syncingRef.current = false;
      setSyncing(false);
    }

    const refresh = () => {
      setOnline(navigator.onLine);
      setPending(getOfflineQueueCount());
      void runSync();
    };

    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("gdt-offline-queue-changed", refresh);
    void runSync();
    const interval = window.setInterval(refresh, 45000);

    return () => {
      active = false;
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("gdt-offline-queue-changed", refresh);
      window.clearInterval(interval);
    };
  }, []);

  if (online && pending === 0 && lastSynced === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-full border border-white/15 bg-[#17110d]/95 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur">
      {!online ? "Mode hors ligne actif" : syncing ? "Synchronisation en cours..." : pending > 0 ? `${pending} ticket(s) en attente de synchronisation` : `${lastSynced} ticket(s) synchronise(s)`}
    </div>
  );
}

export function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <OfflineSyncBadge />
        <Suspense fallback={<RouteLoader />}>
          <PublicApp />
        </Suspense>
      </AuthProvider>
    </AppErrorBoundary>
  );
}
