import { api } from "./api";

const OFFLINE_QUEUE_KEY = "gdt_offline_queue_v1";
const OFFLINE_CASH_SESSION_KEY = "gdt_offline_cash_sessions_v1";
const OFFLINE_CASHIER_KEY = "gdt_offline_cashiers_v1";
const OFFLINE_POS_SNAPSHOT_KEY = "gdt_offline_pos_snapshot_v1";

type QueuedCheckout = {
  id: string;
  type: "pos.checkout";
  createdAt: string;
  attempts: number;
  payload: unknown;
  receipt: {
    temporaryNumber: string;
    total: number;
    sellerName: string;
    customerName: string;
  };
  lastError?: string;
};

type OfflineQueueItem = QueuedCheckout;
type CachedUser = {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  defaultWarehouse: { id: string; name: string; code: string; type: string } | null;
};
type CachedCashSession = {
  id?: string;
  registerId: string;
  registerName?: string;
  warehouseId: string;
  warehouseName?: string;
  date: string;
  openedAt: string;
  openingAmount?: number;
  openingBreakdown?: Array<{
    currencyCode: string;
    amount: number;
    amountMad: number;
    rateFromMad: number;
  }>;
  cachedAt: string;
};
type CachedCashier = {
  user: CachedUser;
  pinHash: string;
  cachedAt: string;
};
type PosSnapshotLike = {
  productList?: Array<Record<string, unknown>>;
  bootstrap?: {
    customers?: Array<Record<string, unknown>>;
    warehouses?: unknown[];
    sellers?: unknown[];
    registers?: unknown[];
    transporters?: unknown[];
    currencies?: unknown[];
    paymentMethods?: unknown[];
    company?: Record<string, unknown> | null;
  };
};

function trySetLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    try {
      localStorage.removeItem(key);
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

function compactText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return value;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function compactPosSnapshot(snapshot: unknown, aggressive = false) {
  const source = snapshot as PosSnapshotLike;
  if (!source || typeof source !== "object" || !Array.isArray(source.productList) || !source.bootstrap) {
    return snapshot;
  }

  const productLimit = aggressive ? 80 : 120;
  const customerLimit = aggressive ? 120 : 500;
  const productList = source.productList.slice(0, productLimit).map((product) => ({
    id: product.id,
    productId: product.productId,
    variantId: product.variantId ?? null,
    name: product.name,
    reference: product.reference,
    barcode: product.barcode ?? null,
    salePriceTtc: product.salePriceTtc,
    stockOnHand: product.stockOnHand,
    color: product.color ?? null,
    size: product.size ?? null,
    imageUrl: aggressive ? null : (typeof product.imageUrl === "string" && product.imageUrl.length < 280 ? product.imageUrl : null)
  }));
  const bootstrap = source.bootstrap;
  const company = bootstrap.company ? {
    ...bootstrap.company,
    logoUrl: compactText(bootstrap.company.logoUrl, 300),
    cgvTerms: compactText(bootstrap.company.cgvTerms, aggressive ? 1200 : 4000),
    ticketFooter: compactText(bootstrap.company.ticketFooter, aggressive ? 600 : 2000)
  } : null;

  return {
    productList,
    bootstrap: {
      customers: (bootstrap.customers ?? []).slice(0, customerLimit).map((customer) => ({
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone ?? null,
        email: customer.email ?? null
      })),
      warehouses: bootstrap.warehouses ?? [],
      sellers: bootstrap.sellers ?? [],
      registers: bootstrap.registers ?? [],
      transporters: bootstrap.transporters ?? [],
      currencies: bootstrap.currencies ?? [],
      paymentMethods: bootstrap.paymentMethods ?? [],
      company
    }
  };
}

function readQueue(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineQueueItem[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("gdt-offline-queue-changed", { detail: { pending: items.length } }));
}

export function getOfflineQueueCount() {
  return readQueue().length;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizePin(value: string) {
  return value.replace(/^CSH[-:]/i, "").replace(/\D+/g, "").slice(0, 12);
}

function readCashiers(): CachedCashier[] {
  try {
    const raw = localStorage.getItem(OFFLINE_CASHIER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCashiers(items: CachedCashier[]) {
  localStorage.setItem(OFFLINE_CASHIER_KEY, JSON.stringify(items));
}

export function isOfflineToken(token?: string | null) {
  return Boolean(token?.startsWith("offline:"));
}

export async function rememberOfflineCashierLogin(code: string, user: CachedUser) {
  if (!user.roles.some((role) => role.toLowerCase() === "caissier")) return;
  const pin = sanitizePin(code);
  if (pin.length < 4) return;
  const pinHash = await sha256(`${user.id}:${pin}`);
  const others = readCashiers().filter((entry) => entry.user.id !== user.id);
  writeCashiers([...others, { user, pinHash, cachedAt: new Date().toISOString() }].slice(-20));
}

export function forgetOfflineCashier(userId: string) {
  writeCashiers(readCashiers().filter((entry) => entry.user.id !== userId));
}

export async function loginOfflineCashier(code: string) {
  const pin = sanitizePin(code);
  if (pin.length < 4) return null;
  const cashiers = readCashiers();
  for (const entry of cashiers) {
    const pinHash = await sha256(`${entry.user.id}:${pin}`);
    if (pinHash === entry.pinHash) return entry.user;
  }
  return null;
}

export function rememberPosSnapshot(snapshot: unknown) {
  const cachedAt = new Date().toISOString();
  const compactSnapshot = compactPosSnapshot(snapshot);
  if (trySetLocalStorage(OFFLINE_POS_SNAPSHOT_KEY, JSON.stringify({ snapshot: compactSnapshot, cachedAt }))) return;

  const aggressiveSnapshot = compactPosSnapshot(snapshot, true);
  trySetLocalStorage(OFFLINE_POS_SNAPSHOT_KEY, JSON.stringify({ snapshot: aggressiveSnapshot, cachedAt }));
}

export function readPosSnapshot<T>() {
  try {
    const raw = localStorage.getItem(OFFLINE_POS_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.snapshot as T | null;
  } catch {
    return null;
  }
}

function readCashSessionCache(): CachedCashSession[] {
  try {
    const raw = localStorage.getItem(OFFLINE_CASH_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCashSessionCache(items: CachedCashSession[]) {
  localStorage.setItem(OFFLINE_CASH_SESSION_KEY, JSON.stringify(items));
}

export function rememberOpenCashSession(input: {
  id?: string;
  registerId: string;
  registerName?: string;
  warehouseId: string;
  warehouseName?: string;
  openedAt?: string;
  openingAmount?: number;
  openingBreakdown?: CachedCashSession["openingBreakdown"];
}) {
  if (!input.registerId || !input.warehouseId) return;
  const openedAt = input.openedAt || new Date().toISOString();
  const date = new Date(openedAt).toLocaleDateString("en-CA");
  const nextSession: CachedCashSession = {
    id: input.id,
    registerId: input.registerId,
    registerName: input.registerName,
    warehouseId: input.warehouseId,
    warehouseName: input.warehouseName,
    date,
    openedAt,
    openingAmount: input.openingAmount,
    openingBreakdown: input.openingBreakdown,
    cachedAt: new Date().toISOString()
  };
  const others = readCashSessionCache().filter((item) => !(item.registerId === input.registerId && item.warehouseId === input.warehouseId));
  writeCashSessionCache([...others, nextSession].slice(-20));
}

export function hasCachedOpenCashSession(input: { registerId: string; warehouseId: string; date?: string }) {
  const date = input.date || new Date().toLocaleDateString("en-CA");
  return readCashSessionCache().some((item) => item.registerId === input.registerId && item.warehouseId === input.warehouseId && item.date === date);
}

export function readCachedOpenCashSession(input: { registerId?: string; warehouseId?: string; date?: string }) {
  const date = input.date || new Date().toLocaleDateString("en-CA");
  return readCashSessionCache().find((item) => (
    (!input.registerId || item.registerId === input.registerId)
    && (!input.warehouseId || item.warehouseId === input.warehouseId)
    && item.date === date
  )) ?? null;
}

export function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && /failed to fetch|network|fetch/i.test(error.message));
}

export function queueOfflineCheckout(payload: unknown, receipt: Omit<QueuedCheckout["receipt"], "temporaryNumber">) {
  const queue = readQueue();
  const temporaryNumber = `OFF-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${String(queue.length + 1).padStart(4, "0")}`;
  const item: QueuedCheckout = {
    id: `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "pos.checkout",
    createdAt: new Date().toISOString(),
    attempts: 0,
    payload,
    receipt: { ...receipt, temporaryNumber }
  };
  writeQueue([...queue, item]);
  return item;
}

export async function syncOfflineQueue() {
  if (!navigator.onLine) return { synced: 0, pending: getOfflineQueueCount() };

  const queue = readQueue();
  const remaining: OfflineQueueItem[] = [];
  let synced = 0;

  for (const item of queue) {
    try {
      if (item.type === "pos.checkout") {
        await api("/pos/checkout", {
          method: "POST",
          body: JSON.stringify(item.payload)
        });
        synced += 1;
      }
    } catch (error) {
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : "Synchronisation impossible."
      });
    }
  }

  writeQueue(remaining);
  return { synced, pending: remaining.length };
}
