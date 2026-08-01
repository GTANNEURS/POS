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
  registerId: string;
  warehouseId: string;
  date: string;
  openedAt: string;
  cachedAt: string;
};
type CachedCashier = {
  user: CachedUser;
  pinHash: string;
  cachedAt: string;
};

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
  localStorage.setItem(OFFLINE_POS_SNAPSHOT_KEY, JSON.stringify({ snapshot, cachedAt: new Date().toISOString() }));
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

export function rememberOpenCashSession(input: { registerId: string; warehouseId: string; openedAt?: string }) {
  if (!input.registerId || !input.warehouseId) return;
  const openedAt = input.openedAt || new Date().toISOString();
  const date = new Date(openedAt).toLocaleDateString("en-CA");
  const nextSession: CachedCashSession = {
    registerId: input.registerId,
    warehouseId: input.warehouseId,
    date,
    openedAt,
    cachedAt: new Date().toISOString()
  };
  const others = readCashSessionCache().filter((item) => !(item.registerId === input.registerId && item.warehouseId === input.warehouseId));
  writeCashSessionCache([...others, nextSession].slice(-20));
}

export function hasCachedOpenCashSession(input: { registerId: string; warehouseId: string; date?: string }) {
  const date = input.date || new Date().toLocaleDateString("en-CA");
  return readCashSessionCache().some((item) => item.registerId === input.registerId && item.warehouseId === input.warehouseId && item.date === date);
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
