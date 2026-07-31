import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { api } from "../../lib/api";
import { formatCurrency, formatDateTime, formatNumber } from "../../lib/format";
import { EmptyState, LoadingBlock, PageHeader, SectionCard, StatCard } from "../../components/ui/primitives";

type DashboardData = {
  kpis: {
    todayRevenue: number;
    monthRevenue: number;
    ticketsCount: number;
    outOfStockCount: number;
    lowStockCount: number;
  };
  byStore: Array<{ id: string; name: string; todayRevenue: number; monthRevenue: number; ticketsCount: number }>;
  topProducts: Array<{ label: string; quantity: number; revenue: number }>;
  topCustomers: Array<{ label: string; revenue: number }>;
  recentActivity: Array<{ id: string; number: string; customer: string; warehouse: string; total: number; createdAt: string }>;
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardData>("/dashboard/overview")
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Impossible de charger le dashboard."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingBlock label="Chargement du tableau de bord..." />;
  if (error || !data) return <EmptyState title="Dashboard indisponible" description={error ?? "Aucune donnée disponible pour le moment."} />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pilotage"
        title="Tableau de bord multi-boutiques"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="CA du jour" value={formatCurrency(data.kpis.todayRevenue)} hint="Toutes boutiques" accent="orange" />
        <StatCard label="Ventes du mois" value={formatCurrency(data.kpis.monthRevenue)} accent="blue" />
        <StatCard label="Tickets" value={formatNumber(data.kpis.ticketsCount)} hint="Total ventes" accent="green" />
        <StatCard label="Ruptures" value={formatNumber(data.kpis.outOfStockCount)} accent="red" />
        <StatCard label="Stock faible" value={formatNumber(data.kpis.lowStockCount)} hint="Alerte proactive" accent="orange" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_.95fr]">
        <SectionCard title="Performances par boutique" description="CA du jour et du mois pour chaque magasin.">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.byStore}>
                <defs>
                  <linearGradient id="storeRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff9f45" stopOpacity={0.75} />
                    <stop offset="100%" stopColor="#ff9f45" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="name" stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 12 }} />
                <YAxis stroke="#cdbdae" tickFormatter={(value) => formatNumber(Number(value))} tick={{ fill: "#d8cabd", fontSize: 12 }} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }} />
                <Area type="monotone" dataKey="monthRevenue" stroke="#ff9f45" fill="url(#storeRevenue)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Vue boutiques">
          <div className="space-y-3">
            {data.byStore.map((store) => (
              <div key={store.id} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{store.name}</h3>
                    <p className="mt-1 text-sm text-[#bdaa98]">{formatNumber(store.ticketsCount)} tickets</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-[#cdbdae]">Jour: <span className="font-semibold text-white">{formatCurrency(store.todayRevenue)}</span></div>
                    <div className="mt-1 text-sm text-[#cdbdae]">Mois: <span className="font-semibold text-orange-100">{formatCurrency(store.monthRevenue)}</span></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Top articles" description="Articles les plus vendus">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topProducts} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
                <XAxis type="number" stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 12 }} />
                <YAxis type="category" dataKey="label" width={140} stroke="#cdbdae" tick={{ fill: "#d8cabd", fontSize: 12 }} />
                <Tooltip formatter={(value: number) => formatNumber(value)} contentStyle={{ background: "#171310", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18 }} />
                <Bar dataKey="quantity" fill="#ff8e34" radius={[10, 10, 10, 10]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Derniere Ventes" description="Suivi instantane des tickets recents.">
          <div className="space-y-3">
            {data.recentActivity.map((activity) => (
              <div key={activity.id} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white">{activity.number}</h3>
                    <p className="mt-1 text-sm text-[#c3b3a4]">{activity.customer} • {activity.warehouse}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold text-orange-100">{formatCurrency(activity.total)}</div>
                    <div className="mt-1 text-xs text-[#b19f90]">{formatDateTime(activity.createdAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
